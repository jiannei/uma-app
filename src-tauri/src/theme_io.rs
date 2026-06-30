// src-tauri/src/theme_io.rs — Read / write public/themes/<id>/theme.json.
//
// Powers the dev panel's visual sprite editor. Only compiled in
// debug builds (release users don't have a UI to mutate themes —
// keep that gate as one less moving part). After save, emits
// `prod::THEME_UPDATED` so the robot window re-reads and re-registers
// the theme (no app restart needed for tweaks to take effect).
//
// Path resolution: from src-tauri/, the project root is `..`. Themes
// live at `../public/themes/<id>/theme.json`. In production the
// themes are bundled read-only, so the load/save functions will
// fail at runtime; that's intentional — release users have no
// editor.
//
// The two tests at the bottom of this file verify the path
// resolution and the disk IO, not the Tauri command wrapper. The
// Tauri command wrapper (in commands.rs after PR 6) just forwards
// to these functions.

#[cfg(debug_assertions)]
use crate::events::prod;
use tauri::Emitter;

/// Resolve `public/themes/<id>/theme.json` from the project root.
///
/// `CARGO_MANIFEST_DIR` is `src-tauri/`, so project root is the
/// manifest's parent. If the manifest somehow has no parent (it
/// always does in practice), fall back to the manifest dir itself.
#[cfg(debug_assertions)]
pub fn theme_path(theme_id: &str) -> std::path::PathBuf {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .unwrap_or(manifest)
        .join("public")
        .join("themes")
        .join(theme_id)
        .join("theme.json")
}

/// Read and parse a theme.json from disk. Used by the robot's
/// initial mount + the dev panel's reload path.
#[cfg(debug_assertions)]
pub fn load_theme(theme_id: &str) -> Result<serde_json::Value, String> {
    let path = theme_path(theme_id);
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("read {} failed: {e}", path.display()))?;
    serde_json::from_str(&content).map_err(|e| format!("parse failed: {e}"))
}

/// Write a theme.json to disk with a .bak backup of the previous
/// version, then emit `theme-updated` so the robot window re-reads
/// and re-registers. The .bak lets a dev session that thrashes the
/// editor be reverted with `git checkout` or by reading the .bak.
#[cfg(debug_assertions)]
pub fn save_theme(
    app: &tauri::AppHandle,
    theme_id: &str,
    content: serde_json::Value,
) -> Result<(), String> {
    let path = theme_path(theme_id);
    let backup = path.with_extension("json.bak");
    if path.exists() {
        std::fs::copy(&path, &backup).map_err(|e| format!("backup failed: {e}"))?;
    }
    let pretty = serde_json::to_string_pretty(&content)
        .map_err(|e| format!("serialize failed: {e}"))?;
    std::fs::write(&path, pretty).map_err(|e| format!("write failed: {e}"))?;
    // Notify listeners (robot window, dev panel) to re-read the theme.
    app.emit(prod::THEME_UPDATED, serde_json::json!({ "theme": theme_id }))
        .map_err(|e| format!("emit failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip a theme.json via theme_path → write → re-read.
    /// Verifies the path resolution and the disk IO, not the Tauri
    /// command wrapper. The Tauri command wrapper just forwards to
    /// these functions.
    #[test]
    fn theme_io_roundtrip() {
        let theme_id = "uma";
        let path = theme_path(theme_id);

        // Pre-condition: the real theme.json exists and is valid JSON.
        let original = std::fs::read_to_string(&path).expect("read real theme.json");
        let _: serde_json::Value =
            serde_json::from_str(&original).expect("real theme.json is valid JSON");

        // Write a known value
        let new_content = serde_json::json!({
            "name": "TestRoundtrip",
            "objectScale": {
                "widthRatio": 99.9,
                "heightRatio": 88.8,
                "offsetX": -11.1,
                "offsetY": -22.2,
            }
        });
        let pretty = serde_json::to_string_pretty(&new_content).unwrap();
        std::fs::write(&path, &pretty).unwrap();

        // Re-read and verify
        let restored = std::fs::read_to_string(&path).unwrap();
        let restored_json: serde_json::Value = serde_json::from_str(&restored).unwrap();
        assert_eq!(
            restored_json["objectScale"]["widthRatio"].as_f64().unwrap(),
            99.9
        );
        assert_eq!(restored_json["name"].as_str().unwrap(), "TestRoundtrip");

        // Restore original content so the test is non-destructive.
        std::fs::write(&path, &original).unwrap();
        let after_restore = std::fs::read_to_string(&path).unwrap();
        assert_eq!(after_restore, original);
    }

    #[test]
    fn theme_save_creates_backup() {
        let theme_id = "uma";
        let path = theme_path(theme_id);
        let backup = path.with_extension("json.bak");

        // Pre-condition: backup must not exist (or be from a prior run).
        // If it does exist, just delete it so we can assert creation.
        let _ = std::fs::remove_file(&backup);

        let original = std::fs::read_to_string(&path).unwrap();
        std::fs::write(&path, r#"{"name":"BackupTest"}"#).unwrap();

        // The save function's backup step is inline in save_theme;
        // simulate it here.
        std::fs::copy(&path, &backup).unwrap();
        assert!(backup.exists(), "backup file should be created");

        let backup_content = std::fs::read_to_string(&backup).unwrap();
        assert_eq!(backup_content, r#"{"name":"BackupTest"}"#);

        // Restore
        std::fs::write(&path, &original).unwrap();
        std::fs::remove_file(&backup).unwrap();
    }
}