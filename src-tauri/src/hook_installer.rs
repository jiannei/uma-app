// src-tauri/src/hook_installer.rs — Install/uninstall Claude Code HTTP hooks
// Safely merges hook entries into ~/.claude/settings.json without overwriting existing hooks

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

const UMA_HOOK_URL_PREFIX: &str = "http://127.0.0.1:";

/// Events to register for state tracking (non-blocking, POST /state)
const STATE_EVENTS: &[&str] = &[
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
    "Notification",
    "SubagentStart",
    "SubagentStop",
];

/// Events that require blocking permission response (POST /permission)
const PERMISSION_EVENTS: &[&str] = &["PermissionRequest"];

fn settings_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set")?;
    Ok(PathBuf::from(home).join(".claude").join("settings.json"))
}

fn read_settings() -> Result<Value, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(json!({}));
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read failed: {e}"))?;
    if content.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&content).map_err(|e| format!("parse failed: {e}"))
}

fn write_settings(value: &Value) -> Result<(), String> {
    let path = settings_path()?;

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }

    // Backup existing file
    if path.exists() {
        let backup = path.with_extension("json.bak");
        let _ = fs::copy(&path, &backup);
    }

    let content = serde_json::to_string_pretty(value).map_err(|e| format!("serialize failed: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}

/// Check if uma hooks are installed (any port)
pub fn check_installed() -> Result<bool, String> {
    let settings = read_settings()?;
    let hooks = match settings.get("hooks").and_then(|h| h.as_object()) {
        Some(h) => h,
        None => return Ok(false),
    };

    for (_event, matchers) in hooks {
        if let Some(matcher_array) = matchers.as_array() {
            for matcher in matcher_array {
                if let Some(hook_array) = matcher.get("hooks").and_then(|h| h.as_array()) {
                    for hook in hook_array {
                        if let Some(url) = hook.get("url").and_then(|u| u.as_str()) {
                            if url.starts_with(UMA_HOOK_URL_PREFIX) {
                                return Ok(true);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(false)
}

/// Install Claude Code HTTP hooks
pub fn install(port: u16) -> Result<(), String> {
    let mut settings = read_settings()?;

    let state_url = format!("{UMA_HOOK_URL_PREFIX}{port}/state");
    let permission_url = format!("{UMA_HOOK_URL_PREFIX}{port}/permission");

    // Get or create hooks object
    let hooks = settings
        .as_object_mut()
        .ok_or("settings is not an object")?
        .entry("hooks")
        .or_insert_with(|| json!({}));

    let hooks_obj = hooks.as_object_mut().ok_or("hooks is not an object")?;

    // Register state events (HTTP hooks are inherently non-blocking; 2s timeout for fast fail)
    for event in STATE_EVENTS {
        add_http_hook(hooks_obj, event, &state_url, 2);
    }

    // Register permission events (600s timeout — aligned with HTTP default, must wait for user)
    for event in PERMISSION_EVENTS {
        add_http_hook(hooks_obj, event, &permission_url, 600);
    }

    write_settings(&settings)
}

/// Add an HTTP hook entry to a specific event, skipping if URL already exists.
///
/// Note: HTTP hooks don't have an `async` field (that's command-hook only).
/// HTTP hooks are inherently non-blocking: connection failure and timeout
/// are non-fatal errors that let execution continue. See:
/// https://code.claude.com/docs/zh-CN/hooks#http-hook-fields
fn add_http_hook(
    hooks: &mut serde_json::Map<String, Value>,
    event: &str,
    url: &str,
    timeout: u64,
) {
    let hook_entry = json!({
        "type": "http",
        "url": url,
        "timeout": timeout,
    });

    // Get or create the event's matcher array
    let event_entry = hooks
        .entry(event.to_string())
        .or_insert_with(|| json!([]));

    let matcher_array = event_entry.as_array_mut().expect("event entry should be array");

    // Check if this URL already exists in any matcher
    for matcher in matcher_array.iter() {
        if let Some(hook_array) = matcher.get("hooks").and_then(|h| h.as_array()) {
            for hook in hook_array {
                if let Some(existing_url) = hook.get("url").and_then(|u| u.as_str()) {
                    if existing_url == url {
                        return; // Already installed, skip
                    }
                }
            }
        }
    }

    // Add as a new matcher entry with empty matcher (matches all tools)
    // Per docs: "*", "" or omitted all match every event trigger
    matcher_array.push(json!({
        "matcher": "",
        "hooks": [hook_entry]
    }));
}

/// Uninstall Claude Code HTTP hooks (remove entries with our URL prefix)
pub fn uninstall() -> Result<(), String> {
    let mut settings = read_settings()?;

    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        let events: Vec<String> = hooks.keys().cloned().collect();

        for event in events {
            let should_remove = {
                if let Some(matcher_array) = hooks.get_mut(&event).and_then(|m| m.as_array_mut()) {
                    // Filter out our hooks from each matcher
                    for matcher in matcher_array.iter_mut() {
                        if let Some(hook_array) = matcher.get_mut("hooks").and_then(|h| h.as_array_mut()) {
                            hook_array.retain(|hook| {
                                let url = hook.get("url").and_then(|u| u.as_str()).unwrap_or("");
                                !url.starts_with(UMA_HOOK_URL_PREFIX)
                            });
                        }
                    }

                    // Remove empty matchers
                    matcher_array.retain(|matcher| {
                        matcher
                            .get("hooks")
                            .and_then(|h| h.as_array())
                            .is_some_and(|arr| !arr.is_empty())
                    });

                    matcher_array.is_empty()
                } else {
                    false
                }
            };

            if should_remove {
                hooks.remove(&event);
            }
        }

        // Remove hooks key if empty
        if hooks.is_empty() {
            settings.as_object_mut().unwrap().remove("hooks");
        }
    }

    write_settings(&settings)
}
