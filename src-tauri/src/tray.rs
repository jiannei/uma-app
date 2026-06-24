// src-tauri/src/tray.rs — System tray icon and menu

use crate::{Settings, SettingsStore};
use std::sync::Arc;
use tauri::{
    menu::{CheckMenuItemBuilder, Menu, MenuItem, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};
use tauri_plugin_store::StoreExt;

/// Build and install the system tray with menu
pub fn install_tray<R: Runtime>(
    app: &AppHandle<R>,
    settings: Arc<std::sync::Mutex<Settings>>,
) -> tauri::Result<()> {
    // Use the app's default window icon as the tray icon
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default icon".into()))?;

    // Theme submenu
    let theme_uma = MenuItem::with_id(app, "theme_uma", "Uma", true, None::<&str>)?;
    let theme_calico = MenuItem::with_id(app, "theme_calico", "Calico", true, None::<&str>)?;
    let theme_submenu = SubmenuBuilder::new(app, "Theme")
        .items(&[&theme_uma, &theme_calico])
        .build()?;

    // Toggles
    let dnd_item = CheckMenuItemBuilder::new("Do Not Disturb")
        .id("dnd")
        .checked(settings.lock().unwrap().dnd)
        .build(app)?;
    let sound_item = CheckMenuItemBuilder::new("Sound Effects")
        .id("sound")
        .checked(settings.lock().unwrap().sound_enabled)
        .build(app)?;

    // Mini mode and settings
    let mini_item = MenuItem::with_id(app, "mini", "Mini Mode", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;

    // Quit
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &theme_submenu,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &dnd_item,
            &sound_item,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &mini_item,
            &settings_item,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Uma on Desk")
        .on_menu_event({
            let settings = settings.clone();
            move |app, event| {
                handle_menu_event(app, event.id().as_ref(), &settings);
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Click on tray icon — menu is already shown via show_menu_on_left_click
            // This is here for any custom click logic if needed
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _app = tray.app_handle();
                // Menu will show automatically via show_menu_on_left_click
            }
        })
        .build(app)?;

    Ok(())
}

fn handle_menu_event<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    settings: &Arc<std::sync::Mutex<Settings>>,
) {
    use tauri::Emitter;

    match id {
        "theme_uma" => {
            let mut s = settings.lock().unwrap();
            s.theme = "uma".into();
            let _ = app.emit("theme-change", serde_json::json!({ "theme": "uma" }));
            if let Some(robot) = app.get_webview_window("robot") {
                let _ = robot.emit(
                    "theme-change",
                    serde_json::json!({ "theme": "uma" }),
                );
            }
        }
        "theme_calico" => {
            let mut s = settings.lock().unwrap();
            s.theme = "calico".into();
            let _ = app.emit("theme-change", serde_json::json!({ "theme": "calico" }));
            if let Some(robot) = app.get_webview_window("robot") {
                let _ = robot.emit(
                    "theme-change",
                    serde_json::json!({ "theme": "calico" }),
                );
            }
        }
        "dnd" => {
            let new_val = {
                let mut s = settings.lock().unwrap();
                s.dnd = !s.dnd;
                s.dnd
            };
            // Sync to global SettingsStore
            if let Some(state) = app.try_state::<SettingsStore>() {
                let mut s = state.0.lock().unwrap();
                s.dnd = new_val;
            }
            // Persist to plugin-store
            if let Ok(pstore) = app.store("settings.json") {
                pstore.set("dnd", serde_json::json!(new_val));
                let _ = pstore.save();
            }
            let _ = app.emit("dnd-change", serde_json::json!({ "dnd": new_val }));
        }
        "sound" => {
            let new_val = {
                let mut s = settings.lock().unwrap();
                s.sound_enabled = !s.sound_enabled;
                s.sound_enabled
            };
            // Sync to global SettingsStore
            if let Some(state) = app.try_state::<SettingsStore>() {
                let mut s = state.0.lock().unwrap();
                s.sound_enabled = new_val;
            }
            // Persist to plugin-store
            if let Ok(pstore) = app.store("settings.json") {
                pstore.set("sound_enabled", serde_json::json!(new_val));
                let _ = pstore.save();
            }
        }
        "mini" => {
            // Emit a "toggle-mini" event that the robot window handles
            let _ = app.emit("toggle-mini", ());
        }
        "settings" => {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {
            eprintln!("[tray] unhandled menu event: {id}");
        }
    }
}
