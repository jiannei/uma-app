// src-tauri/src/lib.rs — Main application entry point.
//
// This file is intentionally thin. After the lib.rs split (PR 5 +
// PR 6), the actual logic lives in focused modules:
//
//   - settings_store  — persisted user settings
//   - pending_store   — in-flight permission requests + oneshot
//   - windows         — build_main / build_robot / build_bubble
//                       + install_close_interceptor
//   - theme_io        — public/themes/<id>/theme.json read/write
//                       + 2 inline tests
//   - http_server     — axum router + handler fns
//   - commands        — Tauri command handlers (settings +
//                       permission + agent + theme)
//   - devtools        — dev-only Tauri commands (synthetic
//                       permission fixture + pending snapshot)
//   - agent / adapters — Agent trait + ClaudeCode impl
//   - tray            — system tray + menu
//   - events          — Tauri event channel constants
//
// `run()` is the only function in this file. It registers the
// commands (with namespacing) and runs the setup closure.

mod adapters;
mod agent;
mod commands;
mod devtools;
mod events;
mod http_server;
mod pending_store;
mod settings_store;
mod theme_io;
mod tray;
mod windows;

pub use pending_store::{PendingEntry, PendingEntryView, PendingStore};
pub use settings_store::{Change, Settings, SettingsStore};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hook_port: u16 = std::env::var("UMA_PET_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17373);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    // Dev-only: enables the `mcp___hypothesi_tauri-mcp-server__*`
    // tools (screenshots, DOM snapshots, IPC) over WebSocket on
    // port 9223. No-op in release builds.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_setting,
            commands::respond_permission,
            commands::set_bubble_size,
            commands::report_bubble_height,
            commands::list_agents,
            commands::check_agent_installed,
            commands::install_agent_hook,
            commands::uninstall_agent_hook,
            #[cfg(debug_assertions)]
            devtools::devtools_get_pending,
            #[cfg(debug_assertions)]
            devtools::devtools_fire_synthetic_permission,
            #[cfg(debug_assertions)]
            commands::theme_load,
            #[cfg(debug_assertions)]
            commands::theme_save,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            // PendingStore owns the pending map AND the devtools
            // emit invariant. Construct it once with the app
            // handle; clone the handle cheaply for the http
            // server's copy of the store.
            let store = PendingStore::new(app_handle.clone());
            let store_for_http = store.clone();
            let port = hook_port;

            // Build the three runtime windows. The geometry + flags
            // used to be in tauri.conf.json; they live in Rust now so
            // the source of truth is one place. The builders live in
            // `crate::windows`.
            let main_window = windows::build_main(app)?;
            let _robot_window = windows::build_robot(app)?;
            let _bubble_window = windows::build_bubble(app)?;

            // Intercept main window close → hide instead of exit.
            windows::install_close_interceptor(&main_window);

            // Register PendingStore as Tauri state so commands
            // can take `State<'_, PendingStore>`.
            app.manage(store);

            tauri::async_runtime::spawn(async move {
                http_server::run(
                    app_handle,
                    store_for_http,
                    port,
                )
                .await;
            });

            // SettingsStore::new loads from plugin-store, validates
            // each field through `is_valid_*`, and falls back to
            // defaults for missing/invalid keys. Single source of
            // truth — no separate `settings_for_tray` clone, no
            // mirror dance.
            app.manage(SettingsStore::new(app.handle()));

            // Install system tray (uses global SettingsStore via
            // app.try_state inside the menu handler).
            if let Err(err) = tray::install_tray(app.handle()) {
                eprintln!("[uma] failed to install tray: {err}");
            }

            eprintln!("[uma] hook server listening on http://127.0.0.1:{hook_port}");
            eprintln!("[uma] robot window: 144x144 transparent, hit-zone 144x144 centered");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}