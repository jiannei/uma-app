// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod http_server;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

#[derive(serde::Deserialize)]
pub struct PermissionDecision {
    pub request_id: String,
    pub decision: String,
    pub reason: Option<String>,
}

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

#[derive(Clone)]
pub struct PendingStore(pub Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<http_server::PermissionResponse>>>>);

#[derive(Clone)]
pub struct SettingsStore(pub Arc<std::sync::Mutex<Settings>>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

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
    app.emit("pet-theme-change", serde_json::json!({ "theme": theme }))
        .map_err(|e| e.to_string())?;
    if let Some(pet) = app.get_webview_window("pet") {
        pet.emit("pet-theme-change", serde_json::json!({ "theme": theme }))
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
    app.emit("pet-dnd-change", serde_json::json!({ "dnd": enabled }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pet_set_theme(app: AppHandle, theme: String) -> Result<(), String> {
    eprintln!("[clawd] switching theme to: {theme}");
    app.emit("pet-theme-change", serde_json::json!({ "theme": theme }))
        .map_err(|e| e.to_string())?;
    if let Some(pet) = app.get_webview_window("pet") {
        pet.emit("pet-theme-change", serde_json::json!({ "theme": theme }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn pet_permission_response(
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
        eprintln!("[clawd] no pending request found for id={}", decision.request_id);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hook_port: u16 = std::env::var("UMA_PET_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17373);

    let pending = Arc::new(Mutex::new(HashMap::<String, tokio::sync::oneshot::Sender<http_server::PermissionResponse>>::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PendingStore(pending.clone()))
        .manage(SettingsStore(Arc::new(std::sync::Mutex::new(Settings::default()))))
        .invoke_handler(tauri::generate_handler![
            greet,
            get_settings,
            set_theme,
            set_dnd,
            pet_set_theme,
            pet_permission_response,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let pending_for_http = pending.clone();
            let port = hook_port;
            tauri::async_runtime::spawn(async move {
                http_server::run(app_handle, pending_for_http, port).await;
            });

            eprintln!("[clawd] hook server listening on http://127.0.0.1:{hook_port}");
            eprintln!("[clawd] pet window: 200x200 transparent, hit-zone 144x144 centered");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}