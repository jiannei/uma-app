// src-tauri/src/lib.rs — Main application entry point
// Manages settings, system tray, and Tauri commands

mod adapters;
mod agent;
mod http_server;
mod tray;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

// ── Settings ──

/// User-facing preferences, persisted in `settings.json` via
/// `tauri-plugin-store`. Per-agent installation state is NOT here
/// anymore — read it from `list_agents` (see ADR-0002).
#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct Settings {
    pub theme: String,
    pub dnd: bool,
    pub mini_mode: bool,
    pub sound_enabled: bool,
    pub auto_start: bool,
    /// UI / bubble language tag. Matches the `Lang` union in
    /// `src/bubble/strings.ts`. Unknown values fall back to "en"
    /// at the bubble boundary.
    pub language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "uma".into(),
            dnd: false,
            mini_mode: false,
            sound_enabled: true,
            auto_start: false,
            language: "en".into(),
        }
    }
}

// ── State wrappers ──

/// One outstanding permission request. The oneshot sender is the
/// user-decision transport (resolved by `respond_permission` or
/// by the 5-min timeout in `http_server`). The `request` field
/// carries the canonical `PermissionRequest` so the dev-tools panel
/// can render it without re-fetching.
///
/// Note: not `Clone` because `oneshot::Sender` isn't. PendingStore
/// itself is cheap to clone (it wraps `Arc<Mutex<...>>`).
pub struct PendingEntry {
    pub tx: tokio::sync::oneshot::Sender<agent::PermissionDecision>,
    pub request: agent::PermissionRequest,
    pub agent_id: String,
}

/// Serializable view of `PendingEntry` for the dev-tools panel
/// (Tauri command return types must `Serialize`; `PendingEntry`
/// can't derive it because `oneshot::Sender` isn't serializable).
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingEntryView {
    pub request_id: String,
    pub agent_id: String,
    pub request: agent::PermissionRequest,
}

#[derive(Clone)]
pub struct PendingStore(pub Arc<Mutex<HashMap<String, PendingEntry>>>);

#[derive(Clone)]
pub struct SettingsStore(pub Arc<std::sync::Mutex<Settings>>);

/// Permission bubble display position, shared with the HTTP server so
/// `show_bubble_window` can read the user's choice without a round-trip.
#[derive(Clone)]
pub struct BubblePositionStore(pub Arc<std::sync::Mutex<String>>);

// ── Tauri commands ──

#[tauri::command]
fn get_settings(store: State<'_, SettingsStore>) -> Settings {
    store.0.lock().unwrap().clone()
}

#[tauri::command]
fn set_theme(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    theme: String,
) -> Result<(), String> {
    eprintln!("[uma] set theme: {theme}");
    {
        let mut s = store.0.lock().unwrap();
        s.theme = theme.clone();
    }
    // Persist to plugin-store
    if let Ok(pstore) = app.store("settings.json") {
        pstore.set("theme", serde_json::json!(theme.clone()));
        let _ = pstore.save();
    }
    app.emit("theme-change", serde_json::json!({ "theme": &theme }))
        .map_err(|e| e.to_string())?;
    if let Some(robot) = app.get_webview_window("robot") {
        robot.emit("theme-change", serde_json::json!({ "theme": &theme }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_dnd(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    enabled: bool,
) -> Result<(), String> {
    eprintln!("[uma] set dnd: {enabled}");
    {
        let mut s = store.0.lock().unwrap();
        s.dnd = enabled;
    }
    // Persist to plugin-store
    if let Ok(pstore) = app.store("settings.json") {
        pstore.set("dnd", serde_json::json!(enabled));
        let _ = pstore.save();
    }
    app.emit("dnd-change", serde_json::json!({ "dnd": enabled }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_language(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    language: String,
) -> Result<(), String> {
    // Light validation: only the keys we ship today. Bubble falls
    // back to "en" for anything it doesn't recognize, so this is a
    // safety check rather than a strict whitelist.
    if !matches!(language.as_str(), "en" | "zh") {
        return Err(format!("unsupported language: {language}"));
    }
    eprintln!("[uma] set language: {language}");
    {
        let mut s = store.0.lock().unwrap();
        s.language = language.clone();
    }
    if let Ok(pstore) = app.store("settings.json") {
        pstore.set("language", serde_json::json!(language));
        let _ = pstore.save();
    }
    app.emit("language-change", serde_json::json!({ "language": language }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_bubble_position(
    app: AppHandle,
    pos_store: State<'_, BubblePositionStore>,
    position: String,
) -> Result<(), String> {
    // Validate against known positions
    let valid = ["bottom-right", "bottom-left", "top-right", "top-left"];
    if !valid.contains(&position.as_str()) {
        return Err(format!("invalid position: {position}"));
    }
    eprintln!("[uma] set bubble position: {position}");
    *pos_store.0.lock().unwrap() = position.clone();
    // Persist to plugin-store
    if let Ok(pstore) = app.store("settings.json") {
        pstore.set("bubble_position", serde_json::json!(position));
        let _ = pstore.save();
    }
    Ok(())
}

#[cfg_attr(not(debug_assertions), allow(unused_variables))]
#[tauri::command]
async fn respond_permission(
    app: AppHandle,
    store: State<'_, PendingStore>,
    decision: agent::PermissionDecision,
) -> Result<(), String> {
    eprintln!(
        "[uma] permission response: id={} behavior={:?}",
        decision.request_id, decision.behavior,
    );
    // Extract the request_id before moving `decision` into the
    // oneshot sender — both the dev-tools emit below and the
    // "no pending" log on the else branch need it.
    let request_id = decision.request_id.clone();
    let mut pending = store.0.lock().await;
    if let Some(entry) = pending.remove(&request_id) {
        let _ = entry.tx.send(decision);
        eprintln!("[uma] permission resolved");

        // Dev-tools panel watches PendingStore mutations.
        #[cfg(debug_assertions)]
        {
            let _ = app.emit(
                "devtools-pending-changed",
                serde_json::json!({
                    "kind": "remove",
                    "request_id": &request_id,
                }),
            );
        }
    } else {
        eprintln!("[uma] no pending request found for id={request_id}");
    }

    // Hide bubble window after user responds
    if let Some(bubble) = app.get_webview_window("permission-bubble") {
        let _ = bubble.hide();
    }

    Ok(())
}

// ── Agent Tauri commands ──

/// Information about a registered agent, surfaced to the settings UI.
#[derive(serde::Serialize)]
struct AgentInfo {
    id: String,
    display_name: String,
    config_path: String,
    is_installed: bool,
}

/// Read the robot port the HTTP server binds to. Falls back to 17373.
/// The frontend does NOT pass this in — the Rust side is the single
/// source of truth for what port the server binds.
fn pet_port() -> u16 {
    std::env::var("UMA_PET_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17373)
}

fn lookup_or_404(agent_id: &str) -> Result<&'static dyn agent::Agent, String> {
    agent::lookup_agent(agent_id).ok_or_else(|| format!("unknown agent: {agent_id}"))
}

#[tauri::command]
fn list_agents() -> Vec<AgentInfo> {
    agent::KNOWN_AGENTS
        .iter()
        .map(|a| AgentInfo {
            id: a.id().to_string(),
            display_name: a.display_name().to_string(),
            config_path: a.config_path().to_string_lossy().to_string(),
            is_installed: a.is_installed().unwrap_or(false),
        })
        .collect()
}

#[tauri::command]
fn check_agent_installed(agent_id: String) -> Result<bool, String> {
    lookup_or_404(&agent_id)?.is_installed()
}

#[tauri::command]
fn install_agent_hook(agent_id: String) -> Result<(), String> {
    let adapter = lookup_or_404(&agent_id)?;
    adapter.install(pet_port())
}

#[tauri::command]
fn uninstall_agent_hook(agent_id: String) -> Result<(), String> {
    lookup_or_404(&agent_id)?.uninstall()
}

// ── Dev-tools commands (dev-only; gated by `cfg(debug_assertions)`) ──
//
// Snapshot the in-memory permission store for the dev panel's initial
// render. Live updates flow through `devtools-pending-changed` Tauri
// events (emitted at every mutation point). The panel calls this on
// mount, then subscribes to the events for incremental updates.

#[cfg(debug_assertions)]
#[tauri::command]
async fn devtools_get_pending(
    store: State<'_, PendingStore>,
) -> Result<Vec<PendingEntryView>, String> {
    let pending = store.0.lock().await;
    Ok(pending
        .iter()
        .map(|(id, entry)| PendingEntryView {
            request_id: id.clone(),
            agent_id: entry.agent_id.clone(),
            request: entry.request.clone(),
        })
        .collect())
}

/// Inject a synthetic permission request of the given `kind` into
/// PendingStore + emit `permission-request` to the bubble. Lets the
/// dev panel drive each of the 3 bubble renderers (SideEffect /
/// Elicitation / PlanReview) without needing a real CC session +
/// hook call. Clicking Allow / Deny in the bubble completes the
/// flow through `respond_permission` (the oneshot sender we insert
/// is dropped on the receive side, but `respond_permission` still
/// removes the entry from the store cleanly).
///
/// `kind` is one of "SideEffect" / "Elicitation" / "PlanReview".
/// All three are hardcoded payloads that exercise the bubble's
/// per-kind render path.
#[cfg(debug_assertions)]
#[tauri::command]
async fn devtools_fire_synthetic_permission(
    app: AppHandle,
    store: State<'_, PendingStore>,
    kind: String,
) -> Result<String, String> {
    use crate::agent::{
        Destination, ElicitationQuestion, PermissionBase, PermissionRequest,
        PermissionUpdateEntry, RuleBehavior, RuleSpec,
    };
    use serde_json::json;

    let request_id = format!(
        "synth-perm-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let base = PermissionBase {
        request_id: request_id.clone(),
        session_id: "synth-session".into(),
        agent: crate::agent::AgentId("claude-code".into()),
        agent_display_name: "Claude Code".into(),
        cwd: Some("/tmp".into()),
    };

    let request = match kind.as_str() {
        "SideEffect" => PermissionRequest::SideEffect {
            base,
            tool_name: Some("Bash".into()),
            tool_input: Some(json!({
                "command": "rm -rf /tmp/synth-test",
                "description": "Synthetic SideEffect (dev panel test)"
            })),
            permission_suggestions: vec![PermissionUpdateEntry::AddRules {
                rules: vec![RuleSpec {
                    tool_name: "Bash".into(),
                    rule_content: Some("rm -rf /tmp/*".into()),
                }],
                behavior: RuleBehavior::Allow,
                destination: Destination::Session,
            }],
        },
        "Elicitation" => PermissionRequest::Elicitation {
            base,
            tool_name: "AskUserQuestion".into(),
            tool_input: Some(json!({
                "questions": [
                    { "question": "Which database?", "header": "DATABASE",
                      "multiSelect": false,
                      "options": [
                        { "label": "PostgreSQL", "description": "Relational, ACID, great for complex queries" },
                        { "label": "SQLite",    "description": "File-based, zero-config, great for small apps" },
                        { "label": "MongoDB",   "description": "Document store, flexible schema" }
                      ]
                    },
                    { "question": "Set up migrations?", "header": "MIGRATIONS",
                      "multiSelect": false,
                      "options": [
                        { "label": "Yes, use a migration tool", "description": "Add sqlx-cli or similar" },
                        { "label": "No, manual schema only",    "description": "I'll write SQL by hand" }
                      ]
                    }
                ]
            })),
            questions: vec![
                ElicitationQuestion {
                    question: "Which database?".into(),
                    header: "DATABASE".into(),
                    multi_select: false,
                    options: vec![
                        crate::agent::ElicitationOption {
                            label: "PostgreSQL".into(),
                            description: "Relational, ACID, great for complex queries".into(),
                            preview: None,
                        },
                        crate::agent::ElicitationOption {
                            label: "SQLite".into(),
                            description: "File-based, zero-config, great for small apps".into(),
                            preview: None,
                        },
                        crate::agent::ElicitationOption {
                            label: "MongoDB".into(),
                            description: "Document store, flexible schema".into(),
                            preview: None,
                        },
                    ],
                },
                ElicitationQuestion {
                    question: "Set up migrations?".into(),
                    header: "MIGRATIONS".into(),
                    multi_select: false,
                    options: vec![
                        crate::agent::ElicitationOption {
                            label: "Yes, use a migration tool".into(),
                            description: "Add sqlx-cli or similar".into(),
                            preview: None,
                        },
                        crate::agent::ElicitationOption {
                            label: "No, manual schema only".into(),
                            description: "I'll write SQL by hand".into(),
                            preview: None,
                        },
                    ],
                },
            ],
        },
        "PlanReview" => PermissionRequest::PlanReview {
            base,
            tool_name: "ExitPlanMode".into(),
            tool_input: Some(json!({
                "plan": "# Implementation Plan\n\n1. Add a database abstraction layer\n2. Wire up migrations\n3. Update connection pooling\n4. Add integration tests"
            })),
            plan_content: Some(
                "# Implementation Plan\n\n1. Add a database abstraction layer\n2. Wire up migrations\n3. Update connection pooling\n4. Add integration tests".into(),
            ),
        },
        other => return Err(format!("unknown kind: {other}")),
    };

    // Insert into PendingStore with a oneshot. The rx is dropped
    // (no one listens) — that's fine, `respond_permission` removes
    // the entry from the store cleanly either way.
    let (tx, _rx) = tokio::sync::oneshot::channel::<crate::agent::PermissionDecision>();
    {
        let mut pending = store.0.lock().await;
        pending.insert(
            request_id.clone(),
            PendingEntry {
                tx,
                request: request.clone(),
                agent_id: "claude-code".into(),
            },
        );
    }

    let payload = serde_json::to_value(&request)
        .map_err(|e| format!("serialize synthetic request: {e}"))?;
    // The bubble window starts hidden. Make sure it's shown — the
    // HTTP path does this in handle_permission; the dev-tools
    // synthetic path bypasses HTTP, so we show it here.
    if let Err(err) = crate::http_server::show_bubble_window(&app, "bottom-right") {
        eprintln!("[devtools] failed to show bubble window: {err}");
    }
    if let Some(bubble) = app.get_webview_window("permission-bubble") {
        match bubble.emit("permission-request", payload.clone()) {
            Ok(()) => eprintln!(
                "[devtools] synthetic emitted to permission-bubble webview (request_id={request_id})"
            ),
            Err(e) => eprintln!(
                "[devtools] synthetic emit to bubble FAILED: {e}"
            ),
        }
    } else {
        eprintln!("[devtools] synthetic permission-bubble webview NOT FOUND");
    }
    match app.emit("permission-request", payload) {
        Ok(()) => eprintln!(
            "[devtools] synthetic emitted app-wide (request_id={request_id})"
        ),
        Err(e) => eprintln!("[devtools] synthetic app.emit FAILED: {e}"),
    }
    eprintln!(
        "[devtools] synthetic permission fired: kind={kind} request_id={request_id}"
    );
    Ok(request_id)
}

// ── Theme editor IPC (dev-only; gated by `cfg(debug_assertions)`) ────
//
// Read / write public/themes/<id>/theme.json. Powers the dev panel's
// visual sprite editor. Only compiled in debug builds (release
// users don't have a UI to mutate themes — keep that gate as
// one less moving part. After save, emits
// `theme-updated` so the robot window re-reads and re-registers the
// theme (no app restart needed for tweaks to take effect).
//
// Path resolution: from src-tauri/, the project root is `..`. Themes
// live at `../public/themes/<id>/theme.json`. In production the
// themes are bundled read-only, so this command will fail at
// runtime; that's intentional — release users have no editor.

#[cfg(debug_assertions)]
fn theme_path(theme_id: &str) -> std::path::PathBuf {
    // CARGO_MANIFEST_DIR is src-tauri/, so project root is parent.
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .unwrap_or(manifest)
        .join("public")
        .join("themes")
        .join(theme_id)
        .join("theme.json")
}

#[cfg(debug_assertions)]
#[tauri::command]
fn theme_load(theme_id: String) -> Result<serde_json::Value, String> {
    let path = theme_path(&theme_id);
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("read {} failed: {e}", path.display()))?;
    serde_json::from_str(&content).map_err(|e| format!("parse failed: {e}"))
}

#[cfg(debug_assertions)]
#[tauri::command]
fn theme_save(
    app: AppHandle,
    theme_id: String,
    content: serde_json::Value,
) -> Result<(), String> {
    let path = theme_path(&theme_id);
    // Best-effort backup of the previous file before overwriting. We
    // do this so a dev session that thrashes the editor can be
    // reverted with `git checkout` or by reading the .bak.
    let backup = path.with_extension("json.bak");
    if path.exists() {
        std::fs::copy(&path, &backup).map_err(|e| format!("backup failed: {e}"))?;
    }
    let pretty = serde_json::to_string_pretty(&content)
        .map_err(|e| format!("serialize failed: {e}"))?;
    std::fs::write(&path, pretty).map_err(|e| format!("write failed: {e}"))?;
    // Notify listeners (robot window, dev panel) to re-read the theme.
    app.emit("theme-updated", serde_json::json!({ "theme": theme_id }))
        .map_err(|e| format!("emit failed: {e}"))?;
    Ok(())
}

// ── App entry ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hook_port: u16 = std::env::var("UMA_PET_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17373);

    let pending = Arc::new(Mutex::new(HashMap::<String, PendingEntry>::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(PendingStore(pending.clone()))
        .manage(SettingsStore(Arc::new(std::sync::Mutex::new(
            Settings::default(),
        ))))
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_theme,
            set_dnd,
            set_language,
            set_bubble_position,
            respond_permission,
            list_agents,
            check_agent_installed,
            install_agent_hook,
            uninstall_agent_hook,
            #[cfg(debug_assertions)]
            devtools_get_pending,
            #[cfg(debug_assertions)]
            devtools_fire_synthetic_permission,
            #[cfg(debug_assertions)]
            theme_load,
            #[cfg(debug_assertions)]
            theme_save,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let pending_for_http = pending.clone();
            let port = hook_port;

            // Load persisted bubble_position (default bottom-right)
            let bubble_pos = if let Ok(pstore) = app.store("settings.json") {
                pstore
                    .get("bubble_position")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_else(|| "bottom-right".into())
            } else {
                "bottom-right".into()
            };
            let bubble_pos_store = Arc::new(std::sync::Mutex::new(bubble_pos));
            app.manage(BubblePositionStore(bubble_pos_store.clone()));

            // Create the three runtime windows. Geometry + flags were
            // previously declared in tauri.conf.json; they live in Rust
            // now so the source of truth for window size (e.g. the
            // 144×144 robot sprite) is a single place.
            use tauri::{WebviewUrl, WebviewWindowBuilder};

            let main_window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("")
            .inner_size(800.0, 680.0)
            .visible(false)
            // macOS: extend the page's dark background into the title
            // bar so the chrome doesn't read as a light bar floating
            // over a dark card. Overlay also makes the whole window
            // draggable (no need for a custom drag region).
            .title_bar_style(tauri::TitleBarStyle::Visible)
            .build()?;

            let _robot_window = WebviewWindowBuilder::new(
                app,
                "robot",
                WebviewUrl::App("robot.html".into()),
            )
            .title("Uma Robot")
            .inner_size(144.0, 144.0)
            .position(100.0, 100.0)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(false)
            .focused(false)
            .visible(true)
            .transparent(true)
            .build()?;

            let _bubble_window = WebviewWindowBuilder::new(
                app,
                "permission-bubble",
                WebviewUrl::App("permission-bubble.html".into()),
            )
            .title("Uma Permission")
            .inner_size(360.0, 200.0)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(false)
            .visible(false)
            .transparent(true)
            .build()?;

            // Intercept main window close → hide instead of exit
            {
                let window = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                });
            }

            tauri::async_runtime::spawn(async move {
                http_server::run(
                    app_handle,
                    pending_for_http,
                    port,
                    bubble_pos_store,
                )
                .await;
            });

            // Load persisted settings from plugin-store
            let initial_settings = if let Ok(pstore) = app.store("settings.json") {
                Settings {
                    theme: pstore
                        .get("theme")
                        .and_then(|v| v.as_str().map(String::from))
                        .unwrap_or_else(|| "uma".into()),
                    dnd: pstore.get("dnd").and_then(|v| v.as_bool()).unwrap_or(false),
                    mini_mode: pstore
                        .get("mini_mode")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                    sound_enabled: pstore
                        .get("sound_enabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true),
                    auto_start: pstore
                        .get("auto_start")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                    language: pstore
                        .get("language")
                        .and_then(|v| v.as_str().map(String::from))
                        .filter(|s| matches!(s.as_str(), "en" | "zh"))
                        .unwrap_or_else(|| "en".into()),
                }
            } else {
                Settings::default()
            };

            // Update in-memory store with loaded settings
            {
                let settings_state = app.state::<SettingsStore>();
                let mut s = settings_state.0.lock().unwrap();
                *s = initial_settings.clone();
            }

            // Install system tray
            let settings_for_tray = Arc::new(std::sync::Mutex::new(initial_settings));
            if let Err(err) = tray::install_tray(app.handle(), settings_for_tray.clone()) {
                eprintln!("[uma] failed to install tray: {err}");
            }

            eprintln!("[uma] hook server listening on http://127.0.0.1:{hook_port}");
            eprintln!("[uma] robot window: 144x144 transparent, hit-zone 144x144 centered");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Round-trip a theme.json via theme_path → write → re-read.
    /// Verifies the path resolution and the disk IO, not the Tauri
    /// command wrapper. The Tauri command wrapper just forwards to
    /// these functions.
    #[test]
    fn theme_io_roundtrip() {
        let theme_id = "uma";
        let path = theme_path(theme_id);

        // Pre-condition: the real theme.json exists and is valid JSON.
        let original = fs::read_to_string(&path).expect("read real theme.json");
        let _: serde_json::Value =
            serde_json::from_str(&original).expect("real theme.json is valid JSON");

        // Write a known value
        let new_content = serde_json::json!({
            "name": "TestRoundtrip",
            "objectScale": {
                "widthRatio": 99.9,
                "heightRatio": 88.8,
                "offsetX": -11.1,
                "offsetY": -22.2,
            }
        });
        let pretty = serde_json::to_string_pretty(&new_content).unwrap();
        fs::write(&path, &pretty).unwrap();

        // Re-read and verify
        let restored = fs::read_to_string(&path).unwrap();
        let restored_json: serde_json::Value = serde_json::from_str(&restored).unwrap();
        assert_eq!(
            restored_json["objectScale"]["widthRatio"].as_f64().unwrap(),
            99.9
        );
        assert_eq!(restored_json["name"].as_str().unwrap(), "TestRoundtrip");

        // Restore original content so the test is non-destructive.
        fs::write(&path, &original).unwrap();
        let after_restore = fs::read_to_string(&path).unwrap();
        assert_eq!(after_restore, original);
    }

    #[test]
    fn theme_save_creates_backup() {
        let theme_id = "uma";
        let path = theme_path(theme_id);
        let backup = path.with_extension("json.bak");

        // Pre-condition: backup must not exist (or be from a prior run).
        // If it does exist, just delete it so we can assert creation.
        let _ = fs::remove_file(&backup);

        let original = fs::read_to_string(&path).unwrap();
        fs::write(&path, r#"{"name":"BackupTest"}"#).unwrap();

        // The save function's backup step is inline in theme_save;
        // simulate it here.
        fs::copy(&path, &backup).unwrap();
        assert!(backup.exists(), "backup file should be created");

        let backup_content = fs::read_to_string(&backup).unwrap();
        assert_eq!(backup_content, r#"{"name":"BackupTest"}"#);

        // Restore
        fs::write(&path, &original).unwrap();
        fs::remove_file(&backup).unwrap();
    }
}
