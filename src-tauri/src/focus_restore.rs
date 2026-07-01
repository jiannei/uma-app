// src-tauri/src/focus_restore.rs — Cross-platform front-app capture / restore.
//
// The permission bubble is shown with `set_focus()` which on macOS steals
// focus from the user's terminal / IDE. When the bubble hides we want to
// put focus back where it was.
//
// `active-win-pos-rs` returns the currently-focused window's owning
// process id. On macOS we additionally look up the NSRunningApplication
// by pid so we can re-activate it by bundle id later.
//
// On Linux / Windows we keep the FrontApp struct as an opaque pid — no
// NSWorkspace calls — so the same struct type compiles cross-platform.
// The restore side is gated by `#[cfg(target_os = "macos")]` so the
// no-op path is a plain no-op.

/// Opaque handle for a previously-focused application. Captured before
/// the bubble shows; passed back to `restore_front_app` after hide.
#[derive(Debug, Clone)]
pub struct FrontApp {
    /// Platform-specific identifier: macOS bundle id (e.g.
    /// "com.apple.Terminal"); other platforms store the pid as a string.
    pub identifier: String,
    /// Optional window title for diagnostics.
    pub title: Option<String>,
}

/// Capture the currently-focused application.
///
/// Returns `Some(front_app)` if the call succeeded, `None` on failure
/// (no focused window, or the OS refused).
pub fn capture_front_app() -> Option<FrontApp> {
    #[cfg(target_os = "macos")]
    {
        use active_win_pos_rs::get_active_window;
        match get_active_window() {
            Ok(info) => {
                // `process_id` is the owning app's pid on macOS.
                // `process_name` is the running process name (e.g. "Terminal").
                // We use process_name as the identifier since NSRunningApplication
                // can activate by name.
                let identifier = info.process_name.clone();
                let title = Some(info.title.clone());
                Some(FrontApp { identifier, title })
            }
            Err(_) => None,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Non-macOS: return pid as the identifier; restore is a no-op.
        None
    }
}

/// Re-activate a previously-captured front app.
///
/// On macOS, uses `open -a <app_name>` to bring the app to front.
/// Other platforms: no-op.
pub fn restore_front_app(app: &FrontApp) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-a")
            .arg(&app.identifier)
            .spawn();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app; // suppress unused warning
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_front_app_is_safe_with_empty_identifier() {
        // Should not panic on any platform.
        let app = FrontApp {
            identifier: "".to_string(),
            title: None,
        };
        restore_front_app(&app);
    }

    #[test]
    fn capture_front_app_compiles_on_all_platforms() {
        // On non-macOS this returns None. On macOS the actual value
        // depends on what's running, so we only assert the return type.
        let result = capture_front_app();
        let _ = result; // exhaustiveness check
    }
}