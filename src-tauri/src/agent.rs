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
// (`HookEvent`, `PermissionRequest`) and the `AgentId` newtype. They never
// touch agent-specific DTOs — that is each adapter's job.
//
// KNOWN_AGENTS is the compile-time registry. Adding a new agent means
// writing a new module under `adapters/` and appending it to KNOWN_AGENTS.

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
}

/// Canonical permission request, already routed to the right agent and
/// ready to be shown in the bubble UI. The `request_id` is pet-generated
/// (a per-process counter) and is what the bubble uses to refer back to
/// the pending entry when the user decides.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    pub request_id: String,
    pub session_id: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    #[serde(default)]
    pub cwd: Option<String>,
    pub agent: AgentId,
    /// Human-readable name for the bubble UI, sourced from the agent.
    #[serde(default)]
    pub agent_display_name: String,
}

// ── Trait ────────────────────────────────────────────────────────

/// Implementor of one AI coding assistant. The pet treats agents as
/// opaque, first-class objects: it asks the agent for its name, asks
/// it whether it is installed, and asks it to translate payloads.
///
/// All methods are infallible at the *trait* level (they take `&self`,
/// not `&mut self`) — they do not need to mutate agent-local state.
/// Process-wide state (pending permission requests, always-allow set,
/// etc.) lives elsewhere and is keyed by `AgentId`.
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
    /// a pet-installed hook entry. Does *not* verify the hook actually
    /// works (e.g. the agent CLI being installed is a separate concern).
    fn is_installed(&self) -> Result<bool>;

    /// Write pet hook entries into this agent's config file. `port` is
    /// the pet's loopback HTTP port (read from `UMA_PET_PORT` env).
    fn install(&self, port: u16) -> Result<()>;

    /// Remove pet hook entries from this agent's config file. Other
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
    /// canonical `HookEvent`. The pet passes the entire body as a
    /// `serde_json::Value` so the adapter can pick out whatever fields
    /// its protocol needs.
    fn parse_state_payload(&self, raw: serde_json::Value) -> Result<HookEvent>;

    /// Translate this agent's raw permission payload into a canonical
    /// `PermissionRequest`. The `request_id` is the pet's internal
    /// id (allocated by the HTTP server before calling this method).
    fn parse_permission_payload(
        &self,
        raw: serde_json::Value,
        request_id: String,
    ) -> Result<PermissionRequest>;

    /// Serialize a permission decision into the JSON shape this agent's
    /// hook protocol expects back. For Claude Code, this is
    /// `{"hookSpecificOutput":{"hookEventName":"PermissionRequest",
    ///   "decision":{"behavior":"allow"}}}`.
    fn build_permission_response(
        &self,
        request_id: &str,
        decision: &str,
    ) -> Result<serde_json::Value>;
}

// ── Registry ─────────────────────────────────────────────────────

/// Look up a registered agent by id. Returns `None` for unknown ids —
/// the HTTP server uses this to reject state events from agents the
/// pet has no adapter for.
pub fn lookup_agent(id: &str) -> Option<&'static dyn Agent> {
    KNOWN_AGENTS.iter().copied().find(|a| a.id() == id)
}

/// Compile-time registry of every agent the pet knows how to handle.
/// Order is significant only for UI display; iteration should be
/// stable.
pub static KNOWN_AGENTS: &[&'static dyn Agent] = &[
    &crate::adapters::claude_code::ClaudeCodeAdapter,
    // When more adapters land they go here, e.g.:
    // &crate::adapters::codex::CodexAdapter,
];
