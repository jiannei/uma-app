// src-tauri/src/commands.rs — Tauri command handlers grouped by
// feature (settings / permission / agent / theme).
//
// Each command is a thin wrapper. The real work lives in the
// underlying store / helper module:
//
//   - SettingsStore (lib.rs re-export, defined in settings_store.rs)
//     owns the settings read/write + persist + emit pipeline.
//     A single generic `set_setting` command replaces the 9
//     per-field + per-toggle setters — adding a new setting is now
//     one Change variant + one `set_setting` arm.
//   - PendingStore (pending_store.rs) holds the in-flight
//     permission requests with their oneshot senders.
//     respond_permission removes an entry + resolves the oneshot.
//   - The Agent trait (agent.rs) is implemented per-adapter in
//     adapters/. The 4 agent commands below look up an adapter by
//     id and call the trait method.
//   - theme_io.rs (lib.rs re-export) owns the public/themes
//     filesystem read/write. The 2 theme commands below are thin
//     forwarders.
//
// Helper types (`AgentInfo`, `pet_port`, `lookup_or_404`) are
// private to this module — they're consumed only by the commands
// here.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent;
use crate::events;
use crate::pending_store::PendingStore;
use crate::settings_store::{Change, SettingsStore};

// ── Settings commands ────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> crate::settings_store::Settings {
    store.get()
}

/// Single IPC entry point for every settings mutation. The frontend
/// (`useSettings().update<K>(field, value)`) sends the field name as
/// a string and the value as a `serde_json::Value`; this command
/// dispatches into `SettingsStore::apply(Change)` so the in-memory
/// state, plugin-store persistence, and per-field event broadcast
/// stay aligned without call-site coordination.
///
/// Adding a new setting = add a `Change` variant in
/// `settings_store.rs` + one arm in the match below. No new Tauri
/// command, no new invoke_handler entry, no new frontend
/// invoke("set_...") call.
#[tauri::command]
pub fn set_setting(
    store: State<'_, SettingsStore>,
    field: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let change = match (field.as_str(), value) {
        ("theme", serde_json::Value::String(v)) => Change::SetTheme(v),
        ("dnd", serde_json::Value::Bool(v)) => Change::SetDnd(v),
        ("sound_enabled", serde_json::Value::Bool(v)) => Change::SetSound(v),
        ("language", serde_json::Value::String(v)) => Change::SetLanguage(v),
        ("auto_start", serde_json::Value::Bool(v)) => Change::SetAutoStart(v),
        (
            "bubble_permission_auto_close_seconds",
            serde_json::Value::Number(n),
        ) => Change::SetBubblePermissionAutoCloseSeconds(n.as_u64().unwrap_or(0) as u32),
        _ => return Err(format!("unknown setting field or wrong value type: {field}")),
    };
    store.apply(change)
}

// ── Permission commands ────────────────────────────────────────

/// User responded to a permission request. `PendingStore::resolve`
/// removes the entry, delivers the decision via the oneshot, and
/// emits `dev::PENDING_CHANGED` in debug builds — all in one call.
/// This command then hides the bubble window.
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
    let request_id = decision.request_id.clone();
    if store.resolve(&request_id, decision).await {
        eprintln!("[uma] permission resolved");
    } else {
        eprintln!("[uma] no pending request found for id={request_id}");
    }

    // Hide bubble window after user responds (or after a stale
    // response — the hide is harmless either way). Emit
    // permission-hide first so the renderer can play a 250ms
    // fade-out animation before the webview is hidden.
    if let Some(bubble) = app.get_webview_window("permission-bubble") {
        let _ = app.emit(events::prod::PERMISSION_HIDE, ());
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        let _ = bubble.hide();
    }

    Ok(())
}

/// Resize the bubble webview to fit content. Re-anchors to the
/// bottom-left of the primary monitor after resize so the bubble's
/// bottom edge stays at the screen bottom as it grows upward.
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

        // Re-anchor to BottomLeft only when width changes (idle ↔ active
        // transitions). Height-only changes keep the same x position and
        // don't need re-anchoring.
        if width_changed {
            let margin = 16i32;
            let fallback = tauri::PhysicalPosition::new(margin, 600i32);
            let position = app
                .primary_monitor()
                .ok()
                .flatten()
                .map(|monitor| {
                    let size = monitor.size();
                    let scale = monitor.scale_factor();
                    let screen_height_px = size.height;
                    let bubble_height_px = (height * scale) as i32;
                    let y = (screen_height_px as i32) - bubble_height_px - margin;
                    tauri::PhysicalPosition::new(margin, y)
                })
                .unwrap_or(fallback);
            let _ = bubble.set_position(position);
        }
    } else {
        return Err("permission-bubble window not found".into());
    }
    Ok(())
}

/// Renderer-driven height reporting. Called from the bubble webview
/// via `useResizeObserver` (throttled) when the natural content height
/// changes. Rust resizes the webview to match, preserving the
/// current width (and bottom-left anchor).
#[tauri::command]
pub fn report_bubble_height(
    app: AppHandle,
    height: f64,
) -> Result<(), String> {
    if let Some(bubble) = app.get_webview_window("permission-bubble") {
        // Clamp to bubble bounds (80pt min, 600pt max — matches
        // min_inner_size / max_inner_size in windows.rs).
        let h = height.clamp(80.0, 600.0);
        // Preserve current width; only change height. Use LogicalSize
        // (ResizeObserver returns CSS / logical pixels).
        let current_width = bubble
            .inner_size()
            .ok()
            .map(|s| s.width as f64 / bubble.scale_factor().unwrap_or(1.0))
            .unwrap_or(360.0);
        bubble
            .set_size(tauri::LogicalSize::new(current_width, h))
            .map_err(|e| format!("report_bubble_height: {e}"))?;
        // Re-anchor bottom-left after height change
        let margin = 16i32;
        let fallback = tauri::PhysicalPosition::new(margin, 600i32);
        let position = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|monitor| {
                let size = monitor.size();
                let scale = monitor.scale_factor();
                let screen_height_px = size.height;
                let bubble_height_px = (h * scale) as i32;
                let y = (screen_height_px as i32) - bubble_height_px - margin;
                tauri::PhysicalPosition::new(margin, y)
            })
            .unwrap_or(fallback);
        let _ = bubble.set_position(position);
    } else {
        return Err("permission-bubble window not found".into());
    }
    Ok(())
}

// ── Agent commands ─────────────────────────────────────────────

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