// src-tauri/src/windows.rs — Builders for the 3 runtime webview
// windows (main / robot / permission-bubble) and the main window
// close interceptor.
//
// Window geometry + flags used to live in tauri.conf.json. They
// moved to Rust so the source of truth for window size (e.g. the
// 144×144 robot sprite) is in one place — the .conf.json values
// would shadow the Rust-side geometry if both were set.
//
// Each `build_*` function returns the constructed WebviewWindow so
// the caller can wire close interceptors, set initial position,
// etc. The functions never call `app.manage` or register state —
// they only construct + show/hide.

use tauri::{App, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use tauri_plugin_positioner::{Position, WindowExt};

/// Build the main settings window (800×680, hidden, visible=false
/// until `main.show()` is called from the tray menu). macOS title
/// bar is configured to extend the page's dark background into the
/// title bar area so the chrome doesn't read as a light bar floating
/// over a dark card; overlay also makes the whole window draggable.
pub fn build_main(app: &App) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("")
        .inner_size(800.0, 680.0)
        .visible(false)
        .title_bar_style(tauri::TitleBarStyle::Visible)
        .build()
}

/// Build the robot window (144×144 transparent, always-on-top, no
/// decorations). Per ADR-0013 决策 4, the initial position is set
/// via the positioner plugin (screen center) right after build.
pub fn build_robot(app: &App) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, "robot", WebviewUrl::App("robot.html".into()))
        .title("Uma Robot")
        .inner_size(144.0, 144.0)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .focused(false)
        .visible(true)
        .transparent(true)
        .build()?;

    // ADR-0013 决策 4: robot 初始位置用 tauri-plugin-positioner
    // 的 Position.Center — 屏幕中央。后续用户可以拖到任意位置。
    let _ = window.move_window(Position::Center);

    Ok(window)
}

/// Build the permission bubble window (360×80, content-sized via
/// `set_bubble_size` IPC). The window is anchored to the bottom-left
/// corner of the primary monitor (uma-pet uses bottom-right; left
/// avoids overlap and mirrors it for easy visual comparison);
/// ADR-0013 click-through strategy applies — body
/// `pointer-events: none` + content `pointer-events: auto`.
pub fn build_bubble(app: &App) -> tauri::Result<WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(
        app,
        "permission-bubble",
        WebviewUrl::App("bubble.html".into()),
    )
    .title("Uma Permission")
    .inner_size(360.0, 80.0)
    .min_inner_size(360.0, 80.0)
    .max_inner_size(360.0, 600.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .resizable(false)
    .visible(false)
    .transparent(true);


    // macOS: ensure the first click on an inactive bubble window
    // registers without requiring the user to click the window first
    // to give it focus.
    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }

    let window = builder.build()?;

    // 固定位置：主屏幕左下角，margin 16pt
    // (tauri-plugin-positioner 的 `current_monitor()` 对隐藏窗口
    // 返回不可靠的结果；手动坐标 + primary_monitor fallback 更可靠。)
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
            let bubble_height_px = (80.0 * scale) as i32;
            let y = (screen_height_px as i32) - bubble_height_px - margin;
            tauri::PhysicalPosition::new(margin, y)
        })
        .unwrap_or(fallback);

    let _ = window.set_position(position);

    Ok(window)
}

/// Intercept the main window's close request: hide instead of exit.
/// This is the "tray-resident app" pattern — closing the settings
/// window keeps the process alive (tray menu + robot + bubble stay
/// running). Quit only happens via the tray's Quit item or the
/// process being killed.
pub fn install_close_interceptor(window: &WebviewWindow) {
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hidden.hide();
        }
    });
}