// src-tauri/src/commands.rs — Tauri command handlers grouped by
// feature (settings / permission / agent / theme).
//
// Each command is a thin wrapper. The real work lives in the
// underlying store / helper module:
//
//   - SettingsStore (lib.rs re-export, defined in settings_store.rs)
//     owns the settings read/write + persist + emit pipeline. The
//     9 settings commands below are 1-line proxies into it.
//
//   - PendingStore (pending_store.rs) holds the in-flight
//     permission requests with their oneshot senders.
//     respond_permission removes an entry + resolves the oneshot.
//
//   - The Agent trait (agent.rs) is implemented per-adapter in
//     adapters/. The 4 agent commands below look up an adapter by
//     id and call the trait method.
//
//   - theme_io.rs (lib.rs re-export) owns the public/themes
//     filesystem read/write. The 2 theme commands below are thin
//     forwarders.
//
// Helper types (`AgentInfo`, `pet_port`, `lookup_or_404`) are
// private to this module — they're consumed only by the commands
// here.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent;
use crate::events::dev;
use crate::pending_store::{PendingEntryView, PendingStore};
use crate::settings_store::SettingsStore;

// ── Settings commands (1-line proxies into SettingsStore) ────────

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> crate::settings_store::Settings {
    store.get()
}

#[tauri::command]
pub fn set_theme(store: State<'_, SettingsStore>, theme: String) -> Result<(), String> {
    store.set_theme(theme)
}

#[tauri::command]
pub fn set_dnd(store: State<'_, SettingsStore>, enabled: bool) -> Result<(), String> {
    store.set_dnd(enabled)
}

#[tauri::command]
pub fn set_sound(store: State<'_, SettingsStore>, enabled: bool) -> Result<(), String> {
    store.set_sound(enabled)
}

#[tauri::command]
pub fn set_language(store: State<'_, SettingsStore>, language: String) -> Result<(), String> {
    store.set_language(language)
}

#[tauri::command]
pub fn set_auto_start(store: State<'_, SettingsStore>, enabled: bool) -> Result<(), String> {
    store.set_auto_start(enabled)
}

#[tauri::command]
pub fn toggle_dnd(store: State<'_, SettingsStore>) -> Result<bool, String> {
    store.toggle_dnd()
}

#[tauri::command]
pub fn toggle_sound(store: State<'_, SettingsStore>) -> Result<bool, String> {
    store.toggle_sound()
}

#[tauri::command]
pub fn toggle_auto_start(store: State<'_, SettingsStore>) -> Result<bool, String> {
    store.toggle_auto_start()
}

// ── Permission commands ────────────────────────────────────────

/// User responded to a permission request. Resolves the oneshot
/// sender that the HTTP handler is awaiting; removes the entry
/// from PendingStore; hides the bubble window. On debug builds,
/// also emits `dev::PENDING_CHANGED` so the dev panel re-renders.
#[cfg_attr(not(debug_assertions), allow(unused_variables))]
#[tauri::command]
pub async fn respond_permission(
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
                dev::PENDING_CHANGED,
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

/// Resize the bubble webview to fit content. Re-anchors to
/// `Position::TopCenter` after resize so the bubble's top edge stays
/// at the screen top as it grows downward.
#[tauri::command]
pub fn set_bubble_size(
    app: AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(bubble) = app.get_webview_window("permission-bubble") {
        // Get current size to check if width changed (needs re-center)
        let old_size = bubble.inner_size().unwrap_or(tauri::PhysicalSize::new(0u32, 0u32));
        let width_changed = ((old_size.width as f64) - width).abs() > 1.0;

        bubble
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| format!("set_bubble_size: {e}"))?;

        // Re-anchor to TopCenter only when width changes (pill ↔ panel).
        // Height-only changes (compact ↔ expanded within same shell) keep
        // the same x position and don't need re-centering.
        if width_changed {
            use tauri_plugin_positioner::{Position, WindowExt};
            let _ = bubble.move_window(Position::TopCenter);
        }
    } else {
        return Err("permission-bubble window not found".into());
    }
    Ok(())
}

// ── Agent commands ──────────────────────────────────────────────

/// Information about a registered agent, surfaced to the settings UI.
#[derive(serde::Serialize)]
pub struct AgentInfo {
    pub id: String,
    pub display_name: String,
    pub config_path: String,
    pub is_installed: bool,
}

/// Read the robot port the HTTP server binds to. Falls back to 17373.
/// The frontend does NOT pass this in — the Rust side is the single
/// source of truth for what port the server binds.
pub fn pet_port() -> u16 {
    std::env::var("UMA_PET_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17373)
}

pub fn lookup_or_404(agent_id: &str) -> Result<&'static dyn agent::Agent, String> {
    agent::lookup_agent(agent_id).ok_or_else(|| format!("unknown agent: {agent_id}"))
}

#[tauri::command]
pub fn list_agents() -> Vec<AgentInfo> {
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
pub fn check_agent_installed(agent_id: String) -> Result<bool, String> {
    lookup_or_404(&agent_id)?.is_installed()
}

#[tauri::command]
pub fn install_agent_hook(agent_id: String) -> Result<(), String> {
    let adapter = lookup_or_404(&agent_id)?;
    adapter.install(pet_port())
}

#[tauri::command]
pub fn uninstall_agent_hook(agent_id: String) -> Result<(), String> {
    let adapter = lookup_or_404(&agent_id)?;
    adapter.uninstall()
}

// ── Theme commands (dev-only; forward to theme_io) ──────────────
//
// The actual filesystem read/write lives in theme_io. These
// commands exist so the dev panel can invoke them via Tauri IPC.

#[cfg(debug_assertions)]
#[tauri::command]
pub fn theme_load(theme_id: String) -> Result<serde_json::Value, String> {
    crate::theme_io::load_theme(&theme_id)
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn theme_save(
    app: AppHandle,
    theme_id: String,
    content: serde_json::Value,
) -> Result<(), String> {
    crate::theme_io::save_theme(&app, &theme_id, content)
}