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
            // ADR-0013 决策 4：把 tray event 喂给 tauri-plugin-positioner
            // 让它把 tray 当前位置存到 Tray state。bubble 调
            // moveWindow(Position.TrayBottomCenter) 时才有 tray
            // 位置可用（不喂的话 plugin 返回 Err "Tray position not set"）。
            // 必须在 destructure 之前调用，因为 `event` 是 owned，
            // 被 if let 消耗后就没法再借用了。
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

            // Click on tray icon — menu is already shown via show_menu_on_left_click
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
            // app.emit broadcasts to all webviews; the robot window is
            // a webview, so the second robot.emit was redundant (and
            // made the robot's listener fire twice). One emit is enough.
            let _ = app.emit("theme-change", serde_json::json!({ "theme": "uma" }));
        }
        "theme_calico" => {
            let mut s = settings.lock().unwrap();
            s.theme = "calico".into();
            let _ = app.emit("theme-change", serde_json::json!({ "theme": "calico" }));
        }
        "dnd" => toggle_bool_setting(
            app,
            settings,
            "dnd",
            "dnd",
            "dnd-change",
            |s| &mut s.dnd,
        ),
        "sound" => toggle_bool_setting(
            app,
            settings,
            "sound_enabled",
            "sound_enabled",
            "sound-change",
            |s| &mut s.sound_enabled,
        ),
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

/// Toggle a single bool field on Settings: lock → flip → mirror to
/// global SettingsStore → persist to plugin-store → broadcast event.
///
/// Shared between the tray "dnd" and "sound" arms, and structurally
/// identical to the body of the `set_dnd` / `set_sound` Tauri commands
/// in lib.rs (those set an explicit value rather than toggling).
/// `store_key` and `payload_key` happen to be the same in current
/// usage (both "dnd" or both "sound_enabled") but are kept as separate
/// parameters to allow future divergence (e.g. a plugin-store key with
/// a different casing from the event payload key).
fn toggle_bool_setting<R: Runtime>(
    app: &AppHandle<R>,
    settings: &Arc<std::sync::Mutex<Settings>>,
    store_key: &str,
    payload_key: &str,
    event_name: &str,
    flip: impl FnOnce(&mut Settings) -> &mut bool,
) {
    use tauri::Emitter;
    let new_val = {
        let mut s = settings.lock().unwrap();
        let target = flip(&mut s);
        *target = !*target;
        *target
    };
    // Mirror to global SettingsStore
    if let Some(state) = app.try_state::<SettingsStore>() {
        let mut s = state.0.lock().unwrap();
        // map key → field. 2-key map avoids bringing a third parameter
        // (the field itself) into the signature.
        match payload_key {
            "dnd" => s.dnd = new_val,
            "sound_enabled" => s.sound_enabled = new_val,
            _ => {}
        }
    }
    // Persist to plugin-store
    if let Ok(pstore) = app.store("settings.json") {
        pstore.set(store_key, serde_json::json!(new_val));
        let _ = pstore.save();
    }
    // Broadcast — previously the sound arm did not emit, leaving App.vue's
    // sound_enabled toggle stale until next launch.
    let _ = app.emit(event_name, serde_json::json!({ payload_key: new_val }));
}
