// src-tauri/src/agent.rs — Agent abstraction (ADR-0002: in-process adapter)
//
// Defines the `Agent` trait that every supported AI coding assistant must
// implement. Each agent encapsulates:
//   - its identity (id, display name, config file path)
//   - hook install / uninstall behavior on that agent's config file
//   - the names of hook events this agent supports
//   - translation of this agent's raw hook payload → canonical HookEvent /
//     PermissionRequest
//   - serialization of a permission decision into this agent's expected
//     response shape
//
// The state machine and HTTP server only deal with the *canonical* types
// (`HookEvent`, `PermissionRequest`, `PermissionDecision`) and the
// `AgentId` newtype. They never touch agent-specific DTOs — that is each
// adapter's job.
//
// KNOWN_AGENTS is the compile-time registry. Adding a new agent means
// writing a new module under `adapters/` and appending it to KNOWN_AGENTS.
//
// See ADR-0011 for the kind sub-discriminator on `PermissionRequest` and
// the `PermissionUpdateEntry` type.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Convenience alias matching existing Tauri command signatures.
pub type Result<T> = std::result::Result<T, String>;

// ── Identity ──────────────────────────────────────────────────────

/// Canonical, stringly-typed agent identifier (e.g. "claude-code", "codex").
///
/// Wrapped in a newtype so we don't accidentally pass a session id, a
/// tool name, or any other opaque string where an agent id is expected.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentId(pub String);

impl AgentId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for AgentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<&str> for AgentId {
    fn from(s: &str) -> Self {
        AgentId(s.to_string())
    }
}

// ── Canonical types (state machine + bubble see only these) ──────

/// Canonical hook event after adapter conversion. See ADR-0001.
///
/// All 8 canonical event types share the same flat shape; per-event
/// fields are populated only when meaningful:
/// - `success` + `error` are set on `ToolCallEnd` (the only event that
///   carries a result). They are `None` on every other event type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookEvent {
    pub session_id: String,
    pub event_type: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    #[serde(default)]
    pub agent: Option<AgentId>,
    #[serde(default)]
    pub cwd: Option<String>,
    /// `Some(true)` / `Some(false)` only on `ToolCallEnd`. The state
    /// machine uses this to flip into `error` on a failed tool call.
    #[serde(default)]
    pub success: Option<bool>,
    /// Human-readable failure reason. `Some(_)` only on
    /// `ToolCallEnd` with `success = false`.
    #[serde(default)]
    pub error: Option<String>,
    /// `Some(true)` when the adapter recognises this tool call as a
    /// subagent-spawning tool (e.g. Claude Code's `Task` / `Agent`).
    /// The resolver reads this flag to drive the juggling / subagent-
    /// groove / building display states — it never inspects `tool_name`
    /// itself, so the canonical layer stays agent-agnostic. See
    /// ADR-0008.
    #[serde(default)]
    pub subagent: Option<bool>,
}

// ── PermissionRequest kind sub-discriminator (ADR-0011) ──────────

/// Tag enum for the `PermissionRequest` discriminated union.
///
/// The three kinds correspond to three distinct user-decision shapes:
/// - `SideEffect` — authorization for a tool with side effects
///   (Bash, Edit, Write, Read, Glob, Grep, Task, …)
/// - `Elicitation` — Claude Code's `AskUserQuestion`; the user fills
///   structured answers and we echo them back via `updatedInput`
/// - `PlanReview` — Claude Code's `ExitPlanMode`; the user approves
///   the plan or rejects with feedback that becomes a `deny` reason
///
/// The tag is part of the canonical vocabulary; classification rules
/// (which `tool_name` maps to which kind) are adapter-private.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum PermissionKind {
    SideEffect,
    Elicitation,
    PlanReview,
}

/// Shared fields for every `PermissionRequest` variant. Embedded via
/// `#[serde(flatten)]` so the JSON wire format stays flat (only the
/// `kind` discriminator is added at the top level).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionBase {
    /// Robot-generated id (per-process counter); the bubble uses this
    /// to refer back to the pending entry when the user decides.
    pub request_id: String,
    pub session_id: String,
    pub agent: AgentId,
    /// Human-readable name for the bubble UI, sourced from the agent.
    #[serde(default)]
    pub agent_display_name: String,
    #[serde(default)]
    pub cwd: Option<String>,
}

/// Canonical permission request, already routed to the right agent and
/// ready to be shown in the bubble UI. The `kind` field discriminates
/// the variant; see ADR-0011 for the rationale.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "PascalCase")]
pub enum PermissionRequest {
    /// Authorization for a tool call with side effects.
    /// Carries `permission_suggestions` from the agent (e.g. Claude
    /// Code's `permission_suggestions` hook input) for the bubble to
    /// render as suggestion buttons.
    SideEffect {
        #[serde(flatten)]
        base: PermissionBase,
        #[serde(default, rename = "toolName")]
        tool_name: Option<String>,
        #[serde(default, rename = "toolInput")]
        tool_input: Option<serde_json::Value>,
        #[serde(default, rename = "permissionSuggestions")]
        permission_suggestions: Vec<PermissionUpdateEntry>,
    },
    /// Claude Code's `AskUserQuestion` (and equivalent tools from other
    /// agents). `questions` is normalized from `tool_input.questions` by
    /// the adapter for the renderer.
    Elicitation {
        #[serde(flatten)]
        base: PermissionBase,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(default, rename = "toolInput")]
        tool_input: Option<serde_json::Value>,
        #[serde(default)]
        questions: Vec<ElicitationQuestion>,
    },
    /// Claude Code's `ExitPlanMode`. `plan_content` is normalized from
    /// `tool_input` by the adapter (which field varies across CC
    /// versions).
    PlanReview {
        #[serde(flatten)]
        base: PermissionBase,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(default, rename = "toolInput")]
        tool_input: Option<serde_json::Value>,
        #[serde(default, rename = "planContent")]
        plan_content: Option<String>,
    },
}

impl PermissionRequest {
    pub fn request_id(&self) -> &str {
        match self {
            Self::SideEffect { base, .. }
            | Self::Elicitation { base, .. }
            | Self::PlanReview { base, .. } => &base.request_id,
        }
    }

    pub fn session_id(&self) -> &str {
        match self {
            Self::SideEffect { base, .. }
            | Self::Elicitation { base, .. }
            | Self::PlanReview { base, .. } => &base.session_id,
        }
    }

    pub fn agent(&self) -> &AgentId {
        match self {
            Self::SideEffect { base, .. }
            | Self::Elicitation { base, .. }
            | Self::PlanReview { base, .. } => &base.agent,
        }
    }

    pub fn agent_display_name(&self) -> &str {
        match self {
            Self::SideEffect { base, .. }
            | Self::Elicitation { base, .. }
            | Self::PlanReview { base, .. } => &base.agent_display_name,
        }
    }

    pub fn cwd(&self) -> Option<&str> {
        match self {
            Self::SideEffect { base, .. }
            | Self::Elicitation { base, .. }
            | Self::PlanReview { base, .. } => base.cwd.as_deref(),
        }
    }

    /// `tool_name` is optional for `SideEffect` (some agents may not
    /// carry it) but always present for `Elicitation` and `PlanReview`
    /// (the kinds themselves are defined by the tool name).
    pub fn tool_name(&self) -> Option<&str> {
        match self {
            Self::SideEffect { tool_name, .. } => tool_name.as_deref(),
            Self::Elicitation { tool_name, .. } | Self::PlanReview { tool_name, .. } => {
                Some(tool_name.as_str())
            }
        }
    }

    pub fn kind(&self) -> PermissionKind {
        match self {
            Self::SideEffect { .. } => PermissionKind::SideEffect,
            Self::Elicitation { .. } => PermissionKind::Elicitation,
            Self::PlanReview { .. } => PermissionKind::PlanReview,
        }
    }
}

// ── Elicitation structures (ADR-0011) ────────────────────────────

/// Normalized shape for one entry in Claude Code's `AskUserQuestion`
/// `tool_input.questions[]`. Other agents' equivalents map to the same
/// shape via their adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationQuestion {
    pub question: String,
    pub header: String,
    pub multi_select: bool,
    pub options: Vec<ElicitationOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElicitationOption {
    pub label: String,
    #[serde(default)]
    pub description: String,
    /// Optional preview text (Claude Code supports it; some agents may
    /// not). Used by the bubble when rendering the option.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

// ── PermissionUpdateEntry (ADR-0011) ─────────────────────────────

/// Canonical "permission update" atomic operation, aligned with Claude
/// Code's `PermissionRequest` hook protocol's `permission_suggestions` /
/// `updatedPermissions` shared schema.
///
/// v1 only transports these entries — uma-app never synthesizes one.
/// The bubble renders the agent-provided `permission_suggestions[]` as
/// buttons; the user's pick is echoed back verbatim as
/// `updatedPermissions`.
///
/// Source schema: <https://code.claude.com/docs/zh-CN/hooks>
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PermissionUpdateEntry {
    AddRules {
        rules: Vec<RuleSpec>,
        behavior: RuleBehavior,
        destination: Destination,
    },
    ReplaceRules {
        rules: Vec<RuleSpec>,
        behavior: RuleBehavior,
        destination: Destination,
    },
    RemoveRules {
        rules: Vec<RuleSpec>,
        behavior: RuleBehavior,
        destination: Destination,
    },
    SetMode {
        mode: PermissionMode,
        destination: Destination,
    },
    AddDirectories {
        directories: Vec<String>,
        destination: Destination,
    },
    RemoveDirectories {
        directories: Vec<String>,
        destination: Destination,
    },
}

/// One rule in a `addRules` / `replaceRules` / `removeRules` entry.
/// `rule_content` is optional per CC protocol — omit to match the
/// entire tool, or supply to scope the rule (e.g. `Bash` + `rm -rf *`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSpec {
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_content: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleBehavior {
    Allow,
    Deny,
    Ask,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Destination {
    /// In-memory only; cleared at session end. CC short-circuits
    /// subsequent requests matching the rule without firing the hook.
    Session,
    /// Written to `.claude/settings.local.json`.
    LocalSettings,
    /// Written to the project's `.claude/settings.json`.
    ProjectSettings,
    /// Written to the user's `~/.claude/settings.json`.
    UserSettings,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    Auto,
    AcceptEdits,
    DontAsk,
    BypassPermissions,
    Plan,
}

// ── PermissionDecision (ADR-0011) ───────────────────────────────

/// The bubble's decision on a pending `PermissionRequest`. Flat struct
/// with optional fields that aligns with Claude Code's
/// `hookSpecificOutput.decision` wire format — see
/// <https://code.claude.com/docs/zh-CN/hooks>.
///
/// Field validity by `behavior`:
/// - `Allow`: `updated_input?` and/or `updated_permissions?` may be set
/// - `Deny`:  `message?` and/or `interrupt?` may be set
///
/// The HTTP server validates these invariants before forwarding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionDecision {
    pub request_id: String,
    pub behavior: DecisionBehavior,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interrupt: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_input: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_permissions: Option<Vec<PermissionUpdateEntry>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DecisionBehavior {
    Allow,
    Deny,
}

// ── Trait ────────────────────────────────────────────────────────

/// Implementor of one AI coding assistant. The robot treats agents as
/// opaque, first-class objects: it asks the agent for its name, asks
/// it whether it is installed, and asks it to translate payloads.
///
/// All methods are infallible at the *trait* level (they take `&self`,
/// not `&mut self`) — they do not need to mutate agent-local state.
/// Process-wide state (pending permission requests, etc.) lives
/// elsewhere and is keyed by `AgentId`.
///
/// `Send + Sync` because the HTTP handlers run on tokio and may share
/// the trait object across tasks.
pub trait Agent: Send + Sync {
    /// Canonical identifier, e.g. "claude-code". Used as the JSON `agent_id`
    /// field on outgoing state events and as the registry key.
    fn id(&self) -> &'static str;

    /// Human-readable name for the settings UI, e.g. "Claude Code".
    fn display_name(&self) -> &'static str;

    /// Where this agent's settings file lives on disk. Used for display
    /// in the settings UI and as the path the install/uninstall methods
    /// read & write.
    fn config_path(&self) -> PathBuf;

    /// Returns `Ok(true)` if this agent's config file already contains
    /// a robot-installed hook entry. Does *not* verify the hook actually
    /// works (e.g. the agent CLI being installed is a separate concern).
    fn is_installed(&self) -> Result<bool>;

    /// Write robot hook entries into this agent's config file. `port` is
    /// the robot's loopback HTTP port (read from `UMA_PET_PORT` env).
    fn install(&self, port: u16) -> Result<()>;

    /// Remove robot hook entries from this agent's config file. Other
    /// hooks (e.g. user-installed third-party hooks) are preserved.
    fn uninstall(&self) -> Result<()>;

    /// Names of the agent's state-emission hook events (e.g. for
    /// Claude Code: `["SessionStart", "SessionEnd", ...]`). Used by
    /// `install` to know which event keys to register in the config.
    fn state_event_names(&self) -> &'static [&'static str];

    /// Names of the agent's permission hook events (almost always a
    /// single entry; separated out for the rare agent that splits
    /// "ask for permission" across multiple hook types).
    fn permission_event_names(&self) -> &'static [&'static str];

    /// Translate this agent's raw state-event JSON payload into a
    /// canonical `HookEvent`. The robot passes the entire body as a
    /// `serde_json::Value` so the adapter can pick out whatever fields
    /// its protocol needs.
    fn parse_state_payload(&self, raw: serde_json::Value) -> Result<HookEvent>;

    /// Translate this agent's raw permission payload into a canonical
    /// `PermissionRequest` (with `kind` classified per adapter-private
    /// rules). The `request_id` is the robot's internal id (allocated
    /// by the HTTP server before calling this method).
    fn parse_permission_payload(
        &self,
        raw: serde_json::Value,
        request_id: String,
    ) -> Result<PermissionRequest>;

    /// Serialize a canonical `PermissionDecision` into the JSON shape
    /// this agent's hook protocol expects back. For Claude Code, this
    /// is `{"hookSpecificOutput":{"hookEventName":"PermissionRequest",
    /// "decision":{...}}}` where `decision` carries the optional
    /// `message` / `interrupt` / `updatedInput` / `updatedPermissions`
    /// fields per CC's wire format.
    fn build_permission_response(&self, decision: &PermissionDecision) -> Result<serde_json::Value>;
}

// ── Registry ─────────────────────────────────────────────────────

/// Look up a registered agent by id. Returns `None` for unknown ids —
/// the HTTP server uses this to reject state events from agents the
/// robot has no adapter for.
pub fn lookup_agent(id: &str) -> Option<&'static dyn Agent> {
    KNOWN_AGENTS.iter().copied().find(|a| a.id() == id)
}

/// Compile-time registry of every agent the robot knows how to handle.
/// Order is significant only for UI display; iteration should be
/// stable.
pub static KNOWN_AGENTS: &[&'static dyn Agent] = &[
    &crate::adapters::claude_code::ClaudeCodeAdapter,
    // When more adapters land they go here, e.g.:
    // &crate::adapters::codex::CodexAdapter,
];

/// Tools that Claude Code handles internally and should bypass the
/// permission bubble — silent allow without showing the UI.
pub const PASSTHROUGH_TOOLS: &[&str] = &[
    "TaskCreate",
    "TaskUpdate",
    "TaskGet",
    "TaskList",
    "TaskStop",
    "TaskOutput",
];

/// Returns true if the given tool name is in the passthrough whitelist.
pub fn is_passthrough(tool_name: &str) -> bool {
    PASSTHROUGH_TOOLS.contains(&tool_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_includes_task_tools() {
        assert!(is_passthrough("TaskCreate"));
        assert!(is_passthrough("TaskUpdate"));
        assert!(is_passthrough("TaskGet"));
        assert!(is_passthrough("TaskList"));
        assert!(is_passthrough("TaskStop"));
        assert!(is_passthrough("TaskOutput"));
    }

    #[test]
    fn passthrough_excludes_bash_and_edit() {
        assert!(!is_passthrough("Bash"));
        assert!(!is_passthrough("Edit"));
        assert!(!is_passthrough("Write"));
    }

    #[test]
    fn passthrough_returns_false_for_unknown() {
        assert!(!is_passthrough("UnknownTool"));
        assert!(!is_passthrough(""));
    }
}