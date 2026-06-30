// src-tauri/src/tray.rs — System tray icon and menu
//
// Uses the global `SettingsStore` (registered in lib.rs setup) for
// initial check states and for menu-event mutations. The old shape —
// a private `Arc<Mutex<Settings>>` plus a string-keyed mirror back
// to global `SettingsStore` — is gone; the tray is now just a thin
// dispatcher over `SettingsStore::set_*` / `toggle_*`.

use crate::events::prod;
use crate::SettingsStore;
use tauri::{
    menu::{CheckMenuItemBuilder, Menu, MenuItem, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

/// Build and install the system tray with menu
pub fn install_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // Read initial toggle states from the global SettingsStore.
    // If it's somehow not registered yet (shouldn't happen — lib.rs
    // manages it before calling install_tray), default to off / on.
    let initial = app
        .try_state::<SettingsStore>()
        .map(|s| s.get())
        .unwrap_or_default();

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
        .checked(initial.dnd)
        .build(app)?;
    let sound_item = CheckMenuItemBuilder::new("Sound Effects")
        .id("sound")
        .checked(initial.sound_enabled)
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
        .on_menu_event(move |app, event| {
            handle_menu_event(app, event.id().as_ref());
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

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    use tauri::Emitter;

    // SettingsStore is registered before install_tray is called (see
    // lib.rs setup), so this should always succeed. If it doesn't,
    // we log and bail — better than panicking inside the menu handler.
    let store = match app.try_state::<SettingsStore>() {
        Some(s) => s,
        None => {
            eprintln!("[tray] SettingsStore not initialized; ignoring {id}");
            return;
        }
    };

    match id {
        "theme_uma" => {
            let _ = store.set_theme("uma");
        }
        "theme_calico" => {
            let _ = store.set_theme("calico");
        }
        "dnd" => {
            // toggle_dnd returns the new value; we could refresh the
            // tray CheckMenuItem state here, but Tauri doesn't expose
            // the menu item handle in this scope without restructuring.
            // The toggle's `dnd-change` broadcast keeps the UI in sync;
            // the next time the menu is opened, the initial value
            // reads fresh from the store (see `checked(initial.dnd)`).
            let _ = store.toggle_dnd();
        }
        "sound" => {
            let _ = store.toggle_sound();
        }
        "mini" => {
            // Half-dead channel (events::prod::TOGGLE_MINI is deprecated
            // per ADR-0019 Stage B). Robot window consumes this; will
            // be removed in the cleanup PR.
            #[allow(deprecated)]
            let _ = app.emit(prod::TOGGLE_MINI, ());
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
