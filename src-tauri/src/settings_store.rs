// src-tauri/src/settings_store.rs — Single owner of "the value of <field>
// right now" for user-facing preferences.
//
// This module is the SettingsStore deepening called out by the
// architecture review (candidate 1). The whole point: every settings
// mutation goes through `SettingsStore::set_*` / `toggle_*` so that
// the in-memory value, plugin-store persistence, and event broadcast
// stay aligned without call-site coordination.
//
// Order inside each setter: validate → write memory → persist → emit.
// Errors propagate before persist+emit, so subscribers only ever see
// durable values. Boot-time load filters plugin-store contents
// through the same validators as runtime set, so a hand-edited
// settings.json with garbage (e.g. theme: "bogus") won't poison the
// in-memory state.

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

use crate::events::prod;

// ── Settings ──

/// User-facing preferences, persisted in `settings.json` via
/// `tauri-plugin-store`. Per-agent installation state is NOT here —
/// read it from `list_agents` (see ADR-0002).
#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct Settings {
    pub theme: String,
    pub dnd: bool,
    pub mini_mode: bool,
    pub sound_enabled: bool,
    pub auto_start: bool,
    /// UI / bubble language tag. Matches the `Lang` union in
    /// `src/bubble/strings.ts`. Unknown values fall back to "en"
    /// at the bubble boundary.
    pub language: String,
    /// Auto-close permission bubbles after this many seconds of
    /// inactivity. 0 = disabled. Rust 5-min timeout is safety net.
    #[serde(default)]
    pub bubble_permission_auto_close_seconds: u32,
    /// Auto-close notification bubbles.
    #[serde(default)]
    pub bubble_notification_auto_close_seconds: u32,
    /// Auto-close update bubbles.
    #[serde(default)]
    pub bubble_update_auto_close_seconds: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "uma".into(),
            dnd: false,
            mini_mode: false,
            sound_enabled: true,
            auto_start: false,
            language: "en".into(),
            bubble_permission_auto_close_seconds: 0,
            bubble_notification_auto_close_seconds: 6,
            bubble_update_auto_close_seconds: 9,
        }
    }
}

// ── Store ──

/// Tauri-managed singleton. Constructed once via `SettingsStore::new`
/// inside `.setup(...)` after the three webview windows exist (so
/// `app.handle()` is valid). Reads via `State<'_, SettingsStore>`;
/// mutations via `store.set_*(...)` / `store.toggle_*(...)`.
#[derive(Clone)]
pub struct SettingsStore {
    inner: Arc<Mutex<Settings>>,
    app: AppHandle,
}

impl SettingsStore {
    /// Construct from the persisted `settings.json` if present, falling
    /// back to defaults. Each field is filtered through `is_valid_*`
    /// so a hand-edited JSON with garbage (e.g. theme: "bogus") won't
    /// poison the in-memory state.
    pub fn new(app: &AppHandle) -> Self {
        let initial = match app.store("settings.json") {
            Ok(pstore) => Settings {
                theme: pstore
                    .get("theme")
                    .and_then(|v| v.as_str().map(String::from))
                    .filter(|s| is_valid_theme(s))
                    .unwrap_or_else(|| "uma".into()),
                dnd: pstore
                    .get("dnd")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                mini_mode: pstore
                    .get("mini_mode")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                sound_enabled: pstore
                    .get("sound_enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true),
                auto_start: pstore
                    .get("auto_start")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                language: pstore
                    .get("language")
                    .and_then(|v| v.as_str().map(String::from))
                    .filter(|s| is_valid_language(s))
                    .unwrap_or_else(|| "en".into()),
                bubble_permission_auto_close_seconds: pstore
                    .get("bubble_permission_auto_close_seconds")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32)
                    .unwrap_or(0),
                bubble_notification_auto_close_seconds: pstore
                    .get("bubble_notification_auto_close_seconds")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32)
                    .unwrap_or(6),
                bubble_update_auto_close_seconds: pstore
                    .get("bubble_update_auto_close_seconds")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32)
                    .unwrap_or(9),
            },
            Err(_) => Settings::default(),
        };
        Self {
            inner: Arc::new(Mutex::new(initial)),
            app: app.clone(),
        }
    }

    /// Read the current settings snapshot. Cloned so callers can hold
    /// it without holding the lock.
    pub fn get(&self) -> Settings {
        self.inner.lock().unwrap().clone()
    }

    // ── Setters: validate → write memory → persist → emit ──

    pub fn set_theme(&self, theme: impl Into<String>) -> Result<(), String> {
        let v = theme.into();
        if !is_valid_theme(&v) {
            return Err(format!("unknown theme: {v}"));
        }
        self.write_and_persist("theme", serde_json::json!(v.clone()), || {
            self.inner.lock().unwrap().theme = v.clone();
        })?;
        self.app
            .emit(prod::THEME_CHANGE, serde_json::json!({ "theme": v }))
            .map_err(|e| e.to_string())
    }

    pub fn set_dnd(&self, enabled: bool) -> Result<(), String> {
        self.write_and_persist("dnd", serde_json::json!(enabled), || {
            self.inner.lock().unwrap().dnd = enabled;
        })?;
        self.app
            .emit(prod::DND_CHANGE, serde_json::json!({ "dnd": enabled }))
            .map_err(|e| e.to_string())
    }

    pub fn set_sound(&self, enabled: bool) -> Result<(), String> {
        self.write_and_persist("sound_enabled", serde_json::json!(enabled), || {
            self.inner.lock().unwrap().sound_enabled = enabled;
        })?;
        self.app
            .emit(prod::SOUND_CHANGE, serde_json::json!({ "sound_enabled": enabled }))
            .map_err(|e| e.to_string())
    }

    pub fn set_language(&self, language: impl Into<String>) -> Result<(), String> {
        let v = language.into();
        if !is_valid_language(&v) {
            return Err(format!("unsupported language: {v}"));
        }
        self.write_and_persist("language", serde_json::json!(v.clone()), || {
            self.inner.lock().unwrap().language = v.clone();
        })?;
        self.app
            .emit(prod::LANGUAGE_CHANGE, serde_json::json!({ "language": v }))
            .map_err(|e| e.to_string())
    }

    pub fn set_auto_start(&self, enabled: bool) -> Result<(), String> {
        self.write_and_persist("auto_start", serde_json::json!(enabled), || {
            self.inner.lock().unwrap().auto_start = enabled;
        })?;
        self.app
            .emit(prod::AUTO_START_CHANGE, serde_json::json!({ "auto_start": enabled }))
            .map_err(|e| e.to_string())
    }

    pub fn set_bubble_policy(
        &self,
        permission_seconds: u32,
        notification_seconds: u32,
        update_seconds: u32,
    ) -> Result<(), String> {
        let p = permission_seconds.min(3600);
        let n = notification_seconds.min(3600);
        let u = update_seconds.min(3600);
        self.write_and_persist(
            "bubble_policy",
            serde_json::json!({
                "bubble_permission_auto_close_seconds": p,
                "bubble_notification_auto_close_seconds": n,
                "bubble_update_auto_close_seconds": u,
            }),
            || {
                let mut s = self.inner.lock().unwrap();
                s.bubble_permission_auto_close_seconds = p;
                s.bubble_notification_auto_close_seconds = n;
                s.bubble_update_auto_close_seconds = u;
            },
        )
    }

    // ── Toggles: bool fields, atomic flip, return new value ──

    pub fn toggle_dnd(&self) -> Result<bool, String> {
        let new_val = {
            let mut s = self.inner.lock().unwrap();
            s.dnd = !s.dnd;
            s.dnd
        };
        self.persist("dnd", serde_json::json!(new_val))?;
        self.app
            .emit(prod::DND_CHANGE, serde_json::json!({ "dnd": new_val }))
            .map_err(|e| e.to_string())?;
        Ok(new_val)
    }

    pub fn toggle_sound(&self) -> Result<bool, String> {
        let new_val = {
            let mut s = self.inner.lock().unwrap();
            s.sound_enabled = !s.sound_enabled;
            s.sound_enabled
        };
        self.persist("sound_enabled", serde_json::json!(new_val))?;
        self.app
            .emit(prod::SOUND_CHANGE, serde_json::json!({ "sound_enabled": new_val }))
            .map_err(|e| e.to_string())?;
        Ok(new_val)
    }

    pub fn toggle_auto_start(&self) -> Result<bool, String> {
        let new_val = {
            let mut s = self.inner.lock().unwrap();
            s.auto_start = !s.auto_start;
            s.auto_start
        };
        self.persist("auto_start", serde_json::json!(new_val))?;
        self.app
            .emit(prod::AUTO_START_CHANGE, serde_json::json!({ "auto_start": new_val }))
            .map_err(|e| e.to_string())?;
        Ok(new_val)
    }

    // ── Internal helpers ──

    /// Apply `mutate` to the in-memory settings, then persist the
    /// given (key, value) pair to plugin-store. Used by the simple
    /// `set_*` methods; the `toggle_*` methods handle their own
    /// mutation since they need to return the new value.
    ///
    /// Order is write-memory → persist → emit. If persist fails, the
    /// emit is skipped and the caller gets the Err — subscribers never
    /// see a non-durable value.
    fn write_and_persist(
        &self,
        key: &str,
        value: serde_json::Value,
        mutate: impl FnOnce(),
    ) -> Result<(), String> {
        mutate();
        self.persist(key, value)
    }

    fn persist(&self, key: &str, value: serde_json::Value) -> Result<(), String> {
        let pstore = self
            .app
            .store("settings.json")
            .map_err(|e| format!("plugin-store unavailable: {e}"))?;
        pstore.set(key, value);
        pstore.save().map_err(|e| format!("persist failed: {e}"))
    }
}

// ── Validators ──
//
// Module-private. Shared between boot-time load and runtime set so a
// hand-edited settings.json can't sneak a value past boot that would
// later be rejected at runtime.

fn is_valid_theme(s: &str) -> bool {
    matches!(s, "uma" | "calico")
}

fn is_valid_language(s: &str) -> bool {
    matches!(s, "en" | "zh")
}