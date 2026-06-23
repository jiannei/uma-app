// src-tauri/src/adapters/claude_code.rs — Claude Code agent adapter
//
// Encapsulates everything Claude-Code-specific: raw payload DTOs,
// wire-format validation, the canonical mapping into `HookEvent` /
// `PermissionRequest`, and the install / uninstall behavior against
// `~/.claude/settings.json`.
//
// Lives in the Tauri binary so the rest of the app (HTTP server,
// state machine, bubble) can stay agent-agnostic. See ADR-0002.

use crate::agent::{Agent, AgentId, HookEvent, PermissionRequest, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

// ── Constants ────────────────────────────────────────────────────

const UMA_HOOK_URL_PREFIX: &str = "http://127.0.0.1:";

const MAX_SESSION_ID_LEN: usize = 256;
const MAX_TOOL_NAME_LEN: usize = 128;
const MAX_CWD_LEN: usize = 1024;
const MAX_HOOK_EVENT_NAME_LEN: usize = 64;
const MAX_PERMISSION_MODE_LEN: usize = 64;

const AGENT_ID: &str = "claude-code";
const AGENT_DISPLAY_NAME: &str = "Claude Code";

/// Per-hook timeouts (seconds) for Claude Code's HTTP hook protocol.
/// State hooks are fire-and-forget (2s is enough for the loopback round
/// trip + a small buffer). Permission hooks must wait for the user, so
/// 600s matches Claude Code's default hook timeout.
const STATE_HOOK_TIMEOUT_SECS: u64 = 2;
const PERMISSION_HOOK_TIMEOUT_SECS: u64 = 600;

// ── Raw DTOs (Claude Code's wire format) ─────────────────────────

/// Claude Code's HTTP hook state-event payload.
///
/// We deliberately do NOT use `#[serde(deny_unknown_fields)]` —
/// Claude Code adds event-specific fields across versions (e.g.
/// `effort` on Stop, `stop_hook_active`) and we want to be tolerant
/// of new fields. Length caps in `validate()` still defend against
/// oversized inputs from arbitrary local callers.
#[derive(Debug, Clone, Deserialize)]
pub struct ClaudeCodeHookPayload {
    pub session_id: String,
    pub hook_event_name: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub transcript_path: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
}

impl ClaudeCodeHookPayload {
    fn validate(&self) -> Result<()> {
        if self.session_id.len() > MAX_SESSION_ID_LEN {
            return Err("session_id too long".into());
        }
        if self.hook_event_name.len() > MAX_HOOK_EVENT_NAME_LEN {
            return Err("hook_event_name too long".into());
        }
        if let Some(t) = &self.tool_name {
            if t.len() > MAX_TOOL_NAME_LEN {
                return Err("tool_name too long".into());
            }
        }
        if let Some(c) = &self.cwd {
            if c.len() > MAX_CWD_LEN {
                return Err("cwd too long".into());
            }
        }
        if let Some(p) = &self.permission_mode {
            if p.len() > MAX_PERMISSION_MODE_LEN {
                return Err("permission_mode too long".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClaudeCodePermissionPayload {
    pub session_id: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    #[serde(default)]
    pub cwd: Option<String>,
}

impl ClaudeCodePermissionPayload {
    fn validate(&self) -> Result<()> {
        if self.session_id.len() > MAX_SESSION_ID_LEN {
            return Err("session_id too long".into());
        }
        if let Some(t) = &self.tool_name {
            if t.len() > MAX_TOOL_NAME_LEN {
                return Err("tool_name too long".into());
            }
        }
        if let Some(c) = &self.cwd {
            if c.len() > MAX_CWD_LEN {
                return Err("cwd too long".into());
            }
        }
        Ok(())
    }
}

// ── Agent trait impl ─────────────────────────────────────────────

/// Singleton adapter for Claude Code. Constructed as a unit struct
/// because all state lives in the pet's process-wide stores.
pub struct ClaudeCodeAdapter;

impl Agent for ClaudeCodeAdapter {
    fn id(&self) -> &'static str {
        AGENT_ID
    }

    fn display_name(&self) -> &'static str {
        AGENT_DISPLAY_NAME
    }

    fn config_path(&self) -> PathBuf {
        match std::env::var("HOME") {
            Ok(home) => PathBuf::from(home).join(".claude").join("settings.json"),
            Err(_) => PathBuf::new(),
        }
    }

    fn is_installed(&self) -> Result<bool> {
        check_installed()
    }

    fn install(&self, port: u16) -> Result<()> {
        install(port)
    }

    fn uninstall(&self) -> Result<()> {
        uninstall()
    }

    fn state_event_names(&self) -> &'static [&'static str] {
        &[
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
        ]
    }

    fn permission_event_names(&self) -> &'static [&'static str] {
        &["PermissionRequest"]
    }

    fn parse_state_payload(&self, raw: serde_json::Value) -> Result<HookEvent> {
        let payload: ClaudeCodeHookPayload = serde_json::from_value(raw)
            .map_err(|e| format!("invalid Claude Code hook payload: {e}"))?;
        payload.validate()?;
        Ok(HookEvent {
            session_id: payload.session_id,
            event_type: payload.hook_event_name,
            tool_name: payload.tool_name,
            tool_input: payload.tool_input,
            agent: Some(AgentId(AGENT_ID.into())),
            cwd: payload.cwd,
        })
    }

    fn parse_permission_payload(
        &self,
        raw: serde_json::Value,
        request_id: String,
    ) -> Result<PermissionRequest> {
        let payload: ClaudeCodePermissionPayload = serde_json::from_value(raw)
            .map_err(|e| format!("invalid Claude Code permission payload: {e}"))?;
        payload.validate()?;
        Ok(PermissionRequest {
            request_id,
            session_id: payload.session_id,
            tool_name: payload.tool_name,
            tool_input: payload.tool_input,
            cwd: payload.cwd,
            agent: AgentId(AGENT_ID.into()),
            agent_display_name: AGENT_DISPLAY_NAME.into(),
        })
    }

    fn build_permission_response(
        &self,
        _request_id: &str,
        decision: &str,
    ) -> Result<serde_json::Value> {
        // Claude Code's hook protocol only accepts "allow" / "deny" —
        // the pet's "always" decision collapses to "allow" on the wire
        // (the in-memory always-allow set is updated separately by the
        // HTTP server before this method is called).
        let behavior = if decision == "always" { "allow" } else { decision };
        Ok(json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": { "behavior": behavior },
            }
        }))
    }
}

// ── Install / uninstall helpers (moved from old hook_installer.rs) ─

fn settings_path() -> Result<PathBuf> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set")?;
    Ok(PathBuf::from(home).join(".claude").join("settings.json"))
}

fn read_settings() -> Result<Value> {
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

fn write_settings(value: &Value) -> Result<()> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    if path.exists() {
        let backup = path.with_extension("json.bak");
        let _ = fs::copy(&path, &backup);
    }
    let content = serde_json::to_string_pretty(value)
        .map_err(|e| format!("serialize failed: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("write failed: {e}"))
}

fn check_installed() -> Result<bool> {
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

fn install(port: u16) -> Result<()> {
    let mut settings = read_settings()?;
    // Per-agent URL path: the HTTP server dispatches by `:id` segment
    // (see http_server.rs). New agents get their own path automatically
    // — no edits to the install code beyond the agent id.
    let state_url = format!("{UMA_HOOK_URL_PREFIX}{port}/agents/{AGENT_ID}/state");
    let permission_url = format!("{UMA_HOOK_URL_PREFIX}{port}/agents/{AGENT_ID}/permission");

    let hooks = settings
        .as_object_mut()
        .ok_or("settings is not an object")?
        .entry("hooks")
        .or_insert_with(|| json!({}));
    let hooks_obj = hooks.as_object_mut().ok_or("hooks is not an object")?;

    for event in ClaudeCodeAdapter.state_event_names() {
        add_http_hook(hooks_obj, event, &state_url, STATE_HOOK_TIMEOUT_SECS);
    }
    for event in ClaudeCodeAdapter.permission_event_names() {
        add_http_hook(hooks_obj, event, &permission_url, PERMISSION_HOOK_TIMEOUT_SECS);
    }

    write_settings(&settings)
}

fn uninstall() -> Result<()> {
    let mut settings = read_settings()?;

    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        let events: Vec<String> = hooks.keys().cloned().collect();
        for event in events {
            let should_remove = {
                if let Some(matcher_array) =
                    hooks.get_mut(&event).and_then(|m| m.as_array_mut())
                {
                    for matcher in matcher_array.iter_mut() {
                        if let Some(hook_array) =
                            matcher.get_mut("hooks").and_then(|h| h.as_array_mut())
                        {
                            hook_array.retain(|hook| {
                                let url = hook.get("url").and_then(|u| u.as_str()).unwrap_or("");
                                !url.starts_with(UMA_HOOK_URL_PREFIX)
                            });
                        }
                    }
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
        if hooks.is_empty() {
            settings.as_object_mut().unwrap().remove("hooks");
        }
    }
    write_settings(&settings)
}

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
    let event_entry = hooks
        .entry(event.to_string())
        .or_insert_with(|| json!([]));
    let matcher_array = event_entry
        .as_array_mut()
        .expect("event entry should be array");

    for matcher in matcher_array.iter() {
        if let Some(hook_array) = matcher.get("hooks").and_then(|h| h.as_array()) {
            for hook in hook_array {
                if let Some(existing_url) = hook.get("url").and_then(|u| u.as_str()) {
                    if existing_url == url {
                        return;
                    }
                }
            }
        }
    }
    matcher_array.push(json!({
        "matcher": "",
        "hooks": [hook_entry]
    }));
}
