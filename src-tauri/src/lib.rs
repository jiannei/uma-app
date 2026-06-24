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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "clawd".into(),
            dnd: false,
            mini_mode: false,
            sound_enabled: true,
            auto_start: false,
        }
    }
}

// ── State wrappers ──

/// One outstanding permission request. The oneshot sender is the
/// user-decision transport (resolved by `pet_permission_response` or
/// by the 5-min timeout in `http_server`). The `request` field
/// carries the canonical `PermissionRequest` so the dev-tools panel
/// can render it without re-fetching.
///
/// Note: not `Clone` because `oneshot::Sender` isn't. PendingStore
/// itself is cheap to clone (it wraps `Arc<Mutex<...>>`).
pub struct PendingEntry {
    pub tx: tokio::sync::oneshot::Sender<http_server::PermissionResponse>,
    pub request: agent::PermissionRequest,
    pub agent_id: String,
}

/// Serializable view of `PendingEntry` for the dev-tools panel
/// (Tauri command return types must `Serialize`; `PendingEntry`
/// can't derive it because `oneshot::Sender` isn't serializable).
#[derive(serde::Serialize, Clone)]
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

/// Per-(agent, session) "always allow" tool set. Scope follows ADR-0003:
/// a tool name is auto-approved only for that specific agent and
/// session. The HTTP server writes to this when the user clicks
/// "Always", and reads it on every incoming permission request.
///
/// The pet frontend invokes `clear_always_allow_session` on
/// `SessionEnd` so a closed session's allow rules don't bleed into
/// the next session opened by the same agent.
///
/// Memory-only, lost on restart (intentional MVP scope).
#[derive(Clone)]
pub struct AlwaysAllowStore(
    pub Arc<Mutex<HashMap<(String, String), std::collections::HashSet<String>>>>,
);

/// Serializable view of a single (agent, session) entry in
/// `AlwaysAllowStore` for the dev-tools panel.
#[derive(serde::Serialize, Clone)]
pub struct AlwaysAllowView {
    pub agent_id: String,
    pub session_id: String,
    pub tools: Vec<String>,
}

#[derive(serde::Deserialize)]
pub struct PermissionDecision {
    pub request_id: String,
    pub decision: String,
    pub reason: Option<String>,
}

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
    eprintln!("[clawd] set theme: {theme}");
    {
        let mut s = store.0.lock().unwrap();
        s.theme = theme.clone();
    }
    // Persist to plugin-store
    if let Ok(pstore) = app.store("settings.json") {
        pstore.set("theme", serde_json::json!(theme.clone()));
        let _ = pstore.save();
    }
    app.emit("pet-theme-change", serde_json::json!({ "theme": &theme }))
        .map_err(|e| e.to_string())?;
    if let Some(pet) = app.get_webview_window("pet") {
        pet.emit("pet-theme-change", serde_json::json!({ "theme": &theme }))
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
    eprintln!("[clawd] set dnd: {enabled}");
    {
        let mut s = store.0.lock().unwrap();
        s.dnd = enabled;
    }
    // Persist to plugin-store
    if let Ok(pstore) = app.store("settings.json") {
        pstore.set("dnd", serde_json::json!(enabled));
        let _ = pstore.save();
    }
    app.emit("pet-dnd-change", serde_json::json!({ "dnd": enabled }))
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
    eprintln!("[clawd] set bubble position: {position}");
    *pos_store.0.lock().unwrap() = position.clone();
    // Persist to plugin-store
    if let Ok(pstore) = app.store("settings.json") {
        pstore.set("bubble_position", serde_json::json!(position));
        let _ = pstore.save();
    }
    Ok(())
}

#[cfg_attr(not(feature = "dev-tools"), allow(unused_variables))]
#[tauri::command]
async fn pet_permission_response(
    app: AppHandle,
    store: State<'_, PendingStore>,
    decision: PermissionDecision,
) -> Result<(), String> {
    eprintln!(
        "[clawd] permission response: id={} decision={}",
        decision.request_id, decision.decision
    );
    let mut pending = store.0.lock().await;
    if let Some(entry) = pending.remove(&decision.request_id) {
        let _ = entry.tx.send(http_server::PermissionResponse {
            request_id: decision.request_id.clone(),
            decision: decision.decision.clone(),
            reason: decision.reason,
        });
        eprintln!("[clawd] permission resolved");

        // Dev-tools panel watches PendingStore mutations.
        #[cfg(feature = "dev-tools")]
        {
            let _ = app.emit(
                "devtools-pending-changed",
                serde_json::json!({
                    "kind": "remove",
                    "request_id": &decision.request_id,
                }),
            );
        }
    } else {
        eprintln!(
            "[clawd] no pending request found for id={}",
            decision.request_id
        );
    }

    // Hide bubble window after user responds
    if let Some(bubble) = app.get_webview_window("pet-bubble") {
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

/// Read the pet port the HTTP server binds to. Falls back to 17373.
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

/// Drop the always-allow set for a (agent_id, session_id) pair.
/// Invoked from the pet frontend on `SessionEnd` so a closed
/// session's allow rules don't leak to the next session opened by
/// the same agent. No-op if the key isn't present.
#[cfg_attr(not(feature = "dev-tools"), allow(unused_variables))]
#[tauri::command]
async fn clear_always_allow_session(
    app: AppHandle,
    store: State<'_, AlwaysAllowStore>,
    agent_id: String,
    session_id: String,
) -> Result<(), String> {
    let mut allow = store.0.lock().await;
    if allow.remove(&(agent_id.clone(), session_id.clone())).is_some() {
        eprintln!("[clawd] cleared always-allow for {agent_id}/{session_id}");

        // Dev-tools panel watches AlwaysAllowStore mutations.
        #[cfg(feature = "dev-tools")]
        {
            let _ = app.emit(
                "devtools-always-allow-changed",
                serde_json::json!({
                    "kind": "remove",
                    "agent_id": &agent_id,
                    "session_id": &session_id,
                }),
            );
        }
    }
    Ok(())
}

// ── Dev-tools commands (gated by `dev-tools` feature) ──
//
// Snapshot the in-memory permission/allow stores for the dev panel's
// initial render. Live updates flow through `devtools-pending-changed`
// and `devtools-always-allow-changed` Tauri events (emitted at every
// mutation point). The panel calls these on mount, then subscribes
// to the events for incremental updates.

#[cfg(feature = "dev-tools")]
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

#[cfg(feature = "dev-tools")]
#[tauri::command]
async fn devtools_get_always_allow(
    store: State<'_, AlwaysAllowStore>,
) -> Result<Vec<AlwaysAllowView>, String> {
    let allow = store.0.lock().await;
    Ok(allow
        .iter()
        .map(|((aid, sid), tools)| AlwaysAllowView {
            agent_id: aid.clone(),
            session_id: sid.clone(),
            tools: tools.iter().cloned().collect(),
        })
        .collect())
}

// ── App entry ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hook_port: u16 = std::env::var("UMA_PET_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17373);

    let pending = Arc::new(Mutex::new(HashMap::<String, PendingEntry>::new()));
    let always_allow: AlwaysAllowStore = AlwaysAllowStore(Arc::new(Mutex::new(HashMap::new())));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(PendingStore(pending.clone()))
        .manage(always_allow.clone())
        .manage(SettingsStore(Arc::new(std::sync::Mutex::new(
            Settings::default(),
        ))))
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_theme,
            set_dnd,
            set_bubble_position,
            pet_permission_response,
            list_agents,
            check_agent_installed,
            install_agent_hook,
            uninstall_agent_hook,
            clear_always_allow_session,
            #[cfg(feature = "dev-tools")]
            devtools_get_pending,
            #[cfg(feature = "dev-tools")]
            devtools_get_always_allow,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let pending_for_http = pending.clone();
            let always_allow_for_http = always_allow.0.clone();
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

            tauri::async_runtime::spawn(async move {
                http_server::run(
                    app_handle,
                    pending_for_http,
                    always_allow_for_http,
                    port,
                    bubble_pos_store,
                )
                .await;
            });

            // Intercept main window close → hide instead of exit
            if let Some(main_window) = app.get_webview_window("main") {
                let window = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                });
            }

            // Dev-tools panel: a 4th webview created at startup
            // (gated — does not exist in release). Auto-shown on
            // launch in dev builds; close mirrors the main window's
            // pattern (hide, don't exit). To bring it back: restart
            // the app, or use the system menu / window list.
            #[cfg(feature = "dev-tools")]
            {
                use tauri::{WebviewUrl, WebviewWindowBuilder};

                let devtools = WebviewWindowBuilder::new(
                    app,
                    "devtools",
                    WebviewUrl::App("devtools.html".into()),
                )
                .title("Clawd DevTools")
                .inner_size(800.0, 600.0)
                .resizable(true)
                .decorations(true)
                .skip_taskbar(true)
                .visible(false)
                .build()
                .expect("failed to create devtools window");

                let _ = devtools.show();
                let _ = devtools.unminimize();
                let _ = devtools.set_focus();

                let devtools_handle = devtools.clone();
                devtools.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = devtools_handle.hide();
                    }
                });
            }

            // Load persisted settings from plugin-store
            let initial_settings = if let Ok(pstore) = app.store("settings.json") {
                Settings {
                    theme: pstore
                        .get("theme")
                        .and_then(|v| v.as_str().map(String::from))
                        .unwrap_or_else(|| "clawd".into()),
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
                eprintln!("[clawd] failed to install tray: {err}");
            }

            eprintln!("[clawd] hook server listening on http://127.0.0.1:{hook_port}");
            eprintln!("[clawd] pet window: 200x200 transparent, hit-zone 144x144 centered");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
