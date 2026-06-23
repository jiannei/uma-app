// src-tauri/src/lib.rs — Main application entry point
// Manages settings, system tray, and Tauri commands

mod hook_installer;
mod http_server;
mod tray;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

// ── Settings ──

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct Settings {
    pub theme: String,
    pub dnd: bool,
    pub mini_mode: bool,
    pub sound_enabled: bool,
    pub auto_start: bool,
    pub hook_installed: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "clawd".into(),
            dnd: false,
            mini_mode: false,
            sound_enabled: true,
            auto_start: false,
            hook_installed: false,
        }
    }
}

// ── State wrappers ──

#[derive(Clone)]
pub struct PendingStore(
    pub Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<http_server::PermissionResponse>>>>,
);

#[derive(Clone)]
pub struct SettingsStore(pub Arc<std::sync::Mutex<Settings>>);

/// Permission bubble display position, shared with the HTTP server so
/// `show_bubble_window` can read the user's choice without a round-trip.
#[derive(Clone)]
pub struct BubblePositionStore(pub Arc<std::sync::Mutex<String>>);

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
    if let Some(tx) = pending.remove(&decision.request_id) {
        let _ = tx.send(http_server::PermissionResponse {
            request_id: decision.request_id,
            decision: decision.decision,
            reason: decision.reason,
        });
        eprintln!("[clawd] permission resolved");
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

// ── Hook installer commands ──

#[tauri::command]
fn check_hook_installed() -> Result<bool, String> {
    hook_installer::check_installed()
}

#[tauri::command]
fn install_claude_hook() -> Result<(), String> {
    // Port is read from UMA_PET_PORT env var, falling back to 17373.
    // We deliberately do not accept `port` from the frontend — the Rust
    // side is the single source of truth for what port the server binds.
    let port: u16 = std::env::var("UMA_PET_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17373);
    hook_installer::install(port)
}

#[tauri::command]
fn uninstall_claude_hook() -> Result<(), String> {
    hook_installer::uninstall()
}

// ── App entry ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hook_port: u16 = std::env::var("UMA_PET_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17373);

    let pending = Arc::new(Mutex::new(
        HashMap::<String, tokio::sync::oneshot::Sender<http_server::PermissionResponse>>::new(),
    ));

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
            set_bubble_position,
            pet_permission_response,
            check_hook_installed,
            install_claude_hook,
            uninstall_claude_hook,
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

            tauri::async_runtime::spawn(async move {
                http_server::run(app_handle, pending_for_http, port, bubble_pos_store).await;
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
                    hook_installed: pstore
                        .get("hook_installed")
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
