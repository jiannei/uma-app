// src-tauri/src/adapters/claude_code.rs — Claude Code agent adapter
//
// Encapsulates everything Claude-Code-specific: raw payload DTOs,
// wire-format validation, the canonical mapping into `HookEvent` /
// `PermissionRequest`, and the install / uninstall behavior against
// `~/.claude/settings.json`.
//
// Lives in the Tauri binary so the rest of the app (HTTP server,
// state machine, bubble) can stay agent-agnostic. See ADR-0002.

use crate::agent::{
    Agent, AgentId, DecisionBehavior, ElicitationQuestion, HookEvent, PermissionBase,
    PermissionDecision, PermissionRequest, PermissionUpdateEntry, Result,
};
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

/// Maximum number of permission_suggestions the bubble will surface.
/// CC may send more; we keep the first N (FIFO).
pub const MAX_PERMISSION_SUGGESTIONS: usize = 20;

/// Tool names that Claude Code uses to spawn a subagent. The resolver
/// uses this to flip `subagent: true` on the canonical HookEvent;
/// it never inspects the tool name itself. Keep this in lockstep
/// with whatever Claude Code currently ships — see ADR-0008.
const SUBAGENT_TOOL_NAMES: &[&str] = &["Task", "Agent", "task"];

fn is_subagent_tool(tool_name: Option<&str>) -> bool {
    match tool_name {
        Some(name) => SUBAGENT_TOOL_NAMES.contains(&name),
        None => false,
    }
}

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
    #[allow(dead_code)] // deserialized from Claude Code hook payload, not yet read
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
    /// CC's `permission_suggestions` input field. Pass-through; the
    /// bubble renders them as suggestion buttons and the user's pick
    /// is echoed back as `updatedPermissions`. See ADR-0011.
    #[serde(default)]
    pub permission_suggestions: Vec<PermissionUpdateEntry>,
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
/// because all state lives in the robot's process-wide stores.
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
        // Debug-level full-payload dump (see ADR/plan: raw request
        // logging for claude-code adapter). Borrowed before `from_value`
        // moves it.
        log::debug!(
            "[claude-code] parse_state_payload raw:\n{}",
            serde_json::to_string_pretty(&raw)
                .unwrap_or_else(|e| format!("<serialize error: {e}>"))
        );
        let payload: ClaudeCodeHookPayload = serde_json::from_value(raw)
            .map_err(|e| format!("invalid Claude Code hook payload: {e}"))?;
        payload.validate()?;
        let (event_type, success, error) = translate_event(&payload.hook_event_name);
        // `subagent: true` is set on the tool-call events (`PreToolUse` →
        // ToolCallStart, `PostToolUse`/`PostToolUseFailure` → ToolCallEnd)
        // when the tool is one Claude Code uses to spawn a subagent.
        // The resolver never inspects `tool_name` itself — it reads the
        // bool. See ADR-0008.
        let subagent = if event_type == "ToolCallStart" || event_type == "ToolCallEnd" {
            Some(is_subagent_tool(payload.tool_name.as_deref()))
        } else {
            None
        };
        Ok(HookEvent {
            session_id: payload.session_id,
            event_type,
            tool_name: payload.tool_name,
            tool_input: payload.tool_input,
            agent: Some(AgentId(AGENT_ID.into())),
            cwd: payload.cwd,
            success,
            error,
            subagent,
        })
    }

    fn parse_permission_payload(
        &self,
        raw: serde_json::Value,
        request_id: String,
    ) -> Result<PermissionRequest> {
        // Debug-level full-payload dump (see ADR/plan: raw request
        // logging for claude-code adapter). Borrowed before `from_value`
        // moves it.
        log::debug!(
            "[claude-code] parse_permission_payload raw:\n{}",
            serde_json::to_string_pretty(&raw)
                .unwrap_or_else(|e| format!("<serialize error: {e}>"))
        );
        let payload: ClaudeCodePermissionPayload = serde_json::from_value(raw)
            .map_err(|e| format!("invalid Claude Code permission payload: {e}"))?;
        payload.validate()?;

        let base = PermissionBase {
            request_id,
            session_id: payload.session_id,
            agent: AgentId(AGENT_ID.into()),
            agent_display_name: AGENT_DISPLAY_NAME.into(),
            cwd: payload.cwd,
        };

        let tool_name = payload.tool_name.unwrap_or_default();
        let tool_input = payload.tool_input;
        match tool_name.as_str() {
            "AskUserQuestion" => Ok(PermissionRequest::Elicitation {
                base,
                tool_name,
                tool_input: tool_input.clone(),
                questions: extract_elicitation_questions(tool_input.as_ref()),
            }),
            "ExitPlanMode" => Ok(PermissionRequest::PlanReview {
                base,
                tool_name,
                tool_input: tool_input.clone(),
                plan_content: extract_plan_content(tool_input.as_ref()),
            }),
            _ => Ok(PermissionRequest::SideEffect {
                base,
                tool_name: (!tool_name.is_empty()).then_some(tool_name),
                tool_input,
                permission_suggestions: normalize_permission_suggestions(
                    payload.permission_suggestions,
                ),
            }),
        }
    }

    fn build_permission_response(
        &self,
        decision: &PermissionDecision,
    ) -> Result<serde_json::Value> {
        // Debug-level input dump (see ADR/plan: response logging for
        // claude-code adapter). Logs the canonical `PermissionDecision`
        // before we translate it into CC's wire format.
        log::debug!(
            "[claude-code] build_permission_response decision (input):\n{}",
            serde_json::to_string_pretty(decision)
                .unwrap_or_else(|e| format!("<serialize error: {e}>"))
        );
        // CC's `decision` shape is flat: `behavior` required, the rest
        // optional and only-valid-for-the-relevant-behavior (validated
        // at the HTTP server boundary). Serialize from the canonical
        // `PermissionDecision` field by field.
        let behavior = match decision.behavior {
            DecisionBehavior::Allow => "allow",
            DecisionBehavior::Deny => "deny",
        };
        let mut wire = json!({ "behavior": behavior });
        if let Some(message) = &decision.message {
            wire["message"] = json!(message);
        }
        if let Some(interrupt) = decision.interrupt {
            wire["interrupt"] = json!(interrupt);
        }
        if let Some(updated_input) = &decision.updated_input {
            wire["updatedInput"] = updated_input.clone();
        }
        if let Some(updated_permissions) = &decision.updated_permissions {
            wire["updatedPermissions"] = json!(updated_permissions);
        }
        let output = json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": wire,
            }
        });
        // Debug-level output dump: the actual JSON we hand back to
        // Claude Code over the wire.
        log::debug!(
            "[claude-code] build_permission_response wire (output):\n{}",
            serde_json::to_string_pretty(&output)
                .unwrap_or_else(|e| format!("<serialize error: {e}>"))
        );
        Ok(output)
    }
}

// ── Permission payload extraction (ADR-0011) ─────────────────────

/// Normalize permission_suggestions[] coming from Claude Code:
/// 1. Merge consecutive `AddRules` entries with same `behavior` and
///    `destination` into a single entry with combined `rules[]`.
/// 2. Cap total length at `MAX_PERMISSION_SUGGESTIONS` (FIFO).
///
/// This collapses the noisy default CC pattern (`addRules[0]`,
/// `addRules[1]`, `addRules[2]`) into a single `addRules` with multiple
/// rules — same wire effect, fewer buttons.
pub fn normalize_permission_suggestions(
    raw: Vec<PermissionUpdateEntry>,
) -> Vec<PermissionUpdateEntry> {
    let mut out: Vec<PermissionUpdateEntry> = Vec::with_capacity(raw.len());
    for entry in raw {
        match (&mut out.last_mut(), &entry) {
            (
                Some(PermissionUpdateEntry::AddRules {
                    rules: last_rules,
                    behavior: last_behavior,
                    destination: last_destination,
                }),
                PermissionUpdateEntry::AddRules {
                    rules: new_rules,
                    behavior: new_behavior,
                    destination: new_destination,
                },
            ) if last_behavior == new_behavior && last_destination == new_destination => {
                last_rules.extend(new_rules.iter().cloned());
            }
            _ => out.push(entry),
        }
        if out.len() >= MAX_PERMISSION_SUGGESTIONS {
            break;
        }
    }
    out
}

/// Pull `questions[]` out of Claude Code's `AskUserQuestion` tool input.
/// Each entry is deserialized into the canonical `ElicitationQuestion`
/// shape; entries that don't fit are skipped rather than failing the
/// whole request — the bubble still shows what it can.
fn extract_elicitation_questions(tool_input: Option<&Value>) -> Vec<ElicitationQuestion> {
    let Some(input) = tool_input else { return Vec::new() };
    let Some(questions) = input.get("questions").and_then(|q| q.as_array()) else {
        return Vec::new();
    };
    questions
        .iter()
        .filter_map(|q| serde_json::from_value::<ElicitationQuestion>(q.clone()).ok())
        .collect()
}

/// Pull the plan text out of Claude Code's `ExitPlanMode` tool input.
/// CC's shape varies across versions; we try the most common field
/// names and fall back to `None` — the bubble can still render the raw
/// `tool_input` if `plan_content` is missing.
fn extract_plan_content(tool_input: Option<&Value>) -> Option<String> {
    let input = tool_input?;
    for key in ["plan", "Plan", "content", "message"] {
        if let Some(s) = input.get(key).and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

// ── Event translation (Claude Code → canonical 8 events, ADR-0001) ─

/// Translate Claude Code's `hook_event_name` into the canonical 8-event
/// vocabulary. Returns `(canonical_name, success, error)`:
/// - `success` is set only for `ToolCallEnd` (true for PostToolUse,
///   false for PostToolUseFailure).
/// - `error` is set only on failed `ToolCallEnd`. The MVP doesn't
///   capture the tool's error string — we just flip the success flag
///   so the state machine can show the `error` animation.
/// - Events without a canonical mapping (e.g. `SubagentStart` /
///   `SubagentStop`) are passed through unchanged. The state machine
///   logs them as "unknown event" and ignores them. This way Claude
///   Code can add new event types in the future without breaking the
///   robot — they just don't drive a display state.
fn translate_event(
    hook_event_name: &str,
) -> (String, Option<bool>, Option<String>) {
    match hook_event_name {
        "SessionStart" => ("SessionStart".into(), None, None),
        "SessionEnd" => ("SessionEnd".into(), None, None),
        "UserPromptSubmit" => ("UserPromptSubmit".into(), None, None),
        "PreToolUse" => ("ToolCallStart".into(), None, None),
        "PostToolUse" => ("ToolCallEnd".into(), Some(true), None),
        "PostToolUseFailure" => ("ToolCallEnd".into(), Some(false), None),
        "Stop" => ("AgentTurnEnd".into(), None, None),
        "Notification" => ("Notification".into(), None, None),
        // Pass-through for subagent + permission events. The state
        // machine doesn't act on these; the bubble / HTTP layer does.
        "SubagentStart" | "SubagentStop" | "PermissionRequest" => {
            (hook_event_name.to_string(), None, None)
        }
        // Truly unknown — pass through so we never silently drop data.
        other => (other.to_string(), None, None),
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


#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{Destination, PermissionUpdateEntry, RuleBehavior, RuleSpec};

    fn make_add_rules(
        behavior: RuleBehavior,
        destination: Destination,
        rules: Vec<RuleSpec>,
    ) -> PermissionUpdateEntry {
        PermissionUpdateEntry::AddRules {
            behavior,
            destination,
            rules,
        }
    }

    #[test]
    fn merges_consecutive_add_rules_with_same_destination() {
        let raw = vec![
            make_add_rules(RuleBehavior::Allow, Destination::UserSettings, vec![
                RuleSpec { tool_name: "Bash".into(), rule_content: Some("echo *".into()) },
            ]),
            make_add_rules(RuleBehavior::Allow, Destination::UserSettings, vec![
                RuleSpec { tool_name: "Bash".into(), rule_content: Some("ls *".into()) },
            ]),
        ];
        let merged = normalize_permission_suggestions(raw);
        assert_eq!(merged.len(), 1);
        if let PermissionUpdateEntry::AddRules { rules, .. } = &merged[0] {
            assert_eq!(rules.len(), 2);
        } else {
            panic!("expected AddRules");
        }
    }

    #[test]
    fn does_not_merge_across_destinations() {
        let raw = vec![
            make_add_rules(RuleBehavior::Allow, Destination::UserSettings, vec![
                RuleSpec { tool_name: "Bash".into(), rule_content: Some("echo *".into()) },
            ]),
            make_add_rules(RuleBehavior::Allow, Destination::Session, vec![
                RuleSpec { tool_name: "Bash".into(), rule_content: Some("ls *".into()) },
            ]),
        ];
        let merged = normalize_permission_suggestions(raw);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn does_not_merge_across_behaviors() {
        let raw = vec![
            make_add_rules(RuleBehavior::Allow, Destination::UserSettings, vec![
                RuleSpec { tool_name: "Bash".into(), rule_content: Some("echo *".into()) },
            ]),
            make_add_rules(RuleBehavior::Deny, Destination::UserSettings, vec![
                RuleSpec { tool_name: "Bash".into(), rule_content: Some("ls *".into()) },
            ]),
        ];
        let merged = normalize_permission_suggestions(raw);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn caps_at_max_permission_suggestions() {
        // Alternate destinations so consecutive entries don't merge
        let mut raw = Vec::new();
        for i in 0..25 {
            let dest = if i % 2 == 0 { Destination::UserSettings } else { Destination::Session };
            raw.push(make_add_rules(
                RuleBehavior::Allow,
                dest,
                vec![RuleSpec { tool_name: format!("T{i}"), rule_content: Some("x".into()) }],
            ));
        }
        let merged = normalize_permission_suggestions(raw);
        assert_eq!(merged.len(), MAX_PERMISSION_SUGGESTIONS);
    }
}
