// src-tauri/src/http_server.rs — HTTP server for agent hook events + permission requests
// Receives Claude Code HTTP hook payloads and converts to internal events
// Endpoints (aligned with uma-pet):
//   GET  /health     → health check
//   POST /state      → state events (non-blocking, fire-and-forget)
//   POST /permission → permission request (blocking, waits for user response)
//
// Security model (MVP, simplified):
// - Bound to 127.0.0.1 only (no LAN/external reachability)
// - Pending permission requests are capped at MAX_PENDING_REQUESTS
//   to prevent unbounded growth from misbehaving callers
// - DTOs use `deny_unknown_fields` and length caps to reject untrusted input
//
// Trust model: this is a single-user desktop app. The loopback bind is
// the only network boundary. Any other local process can send requests;
// we accept this risk in exchange for a simpler hook configuration
// (no token, no signed URLs). If the user wants stronger isolation
// later, the hook installer can switch to a Unix domain socket.

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex};

// ── Claude Code HTTP hook payload (incoming from Claude Code) ──

/// Security: string length limits to prevent DoS via giant payloads.
const MAX_SESSION_ID_LEN: usize = 256;
const MAX_TOOL_NAME_LEN: usize = 128;
const MAX_CWD_LEN: usize = 1024;
const MAX_HOOK_EVENT_NAME_LEN: usize = 64;
const MAX_PERMISSION_MODE_LEN: usize = 64;

/// DTO for Claude Code state-event payloads.
///
/// Note: we deliberately do NOT use `#[serde(deny_unknown_fields)]`.
/// Claude Code adds event-specific fields across versions (e.g. `effort`
/// on Stop, `stop_hook_active`, etc.) and we want to be tolerant of new
/// fields. Length caps in `validate()` still defend against oversized
/// inputs from arbitrary local callers.
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
    fn validate(&self) -> Result<(), String> {
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

/// DTO for Claude Code PermissionRequest payloads.
/// Same tolerance stance as `ClaudeCodeHookPayload` — accept unknown
/// fields, rely on length caps in `validate()`.
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
    fn validate(&self) -> Result<(), String> {
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

// ── Internal unified event format ──

/// Normalized hook event after adapter conversion
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HookEvent {
    pub session_id: String,
    pub event_type: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

// ── Permission types ──

/// Internal permission response (from UI → HTTP server)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionResponse {
    pub request_id: String,
    pub decision: String, // "allow" | "deny" | "always"
    #[serde(default)]
    pub reason: Option<String>,
}

/// Claude Code PermissionRequest hook response format.
///
/// Per the official docs, PermissionRequest uses a different schema than
/// PreToolUse: instead of `hookSpecificOutput.permissionDecision`, it
/// expects `hookSpecificOutput.decision.behavior` (allow/deny).
#[derive(Debug, Clone, Serialize)]
pub struct ClaudeCodePermissionResponse {
    #[serde(rename = "hookSpecificOutput")]
    pub hook_specific_output: ClaudeCodePermissionOutput,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeCodePermissionOutput {
    #[serde(rename = "hookEventName")]
    pub hook_event_name: String,
    /// `decision` is a `Behavior` object (not a string). For
    /// PermissionRequest, the only valid behavior values are
    /// "allow" and "deny" — omitting `decision` lets Claude Code
    /// fall back to its native prompt.
    pub decision: PermissionDecisionBehavior,
}

#[derive(Debug, Clone, Serialize)]
pub struct PermissionDecisionBehavior {
    pub behavior: String, // "allow" | "deny"
}

/// Generic response for non-blocking endpoints
#[derive(Debug, Clone, Serialize)]
pub struct HookResponse {
    pub ok: bool,
    pub message: String,
}

// ── App state ──

/// Maximum concurrent in-flight permission requests. New requests are
/// rejected with 503 if the queue is full — prevents unbounded growth
/// of the pending map if a misbehaving caller never responds.
const MAX_PENDING_REQUESTS: usize = 50;

#[derive(Clone)]
struct AppState {
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionResponse>>>>,
    /// Internal request ID counter
    request_counter: Arc<Mutex<u64>>,
    /// Tools the user has marked as "always allow"
    always_allow: Arc<Mutex<HashSet<String>>>,
    /// User-configured bubble position ("bottom-right" default)
    bubble_position: Arc<std::sync::Mutex<String>>,
}

// ── Adapter: Claude Code payload → internal HookEvent ──

/// All Claude Code hook payloads include a non-empty `hook_event_name`,
/// so that's enough to tag the payload as Claude Code. Future agents
/// (Codex, Gemini, etc.) can be added by recognizing other field patterns.
fn detect_agent(_payload: &ClaudeCodeHookPayload) -> &'static str {
    "claude-code"
}

/// Convert Claude Code hook payload to internal HookEvent
fn adapt_claude_code_payload(payload: &ClaudeCodeHookPayload) -> HookEvent {
    HookEvent {
        session_id: payload.session_id.clone(),
        event_type: payload.hook_event_name.clone(),
        tool_name: payload.tool_name.clone(),
        tool_input: payload.tool_input.clone(),
        agent: Some(detect_agent(payload).to_string()),
        cwd: payload.cwd.clone(),
    }
}

// ── Handlers ──

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "uma-pet",
    }))
}

/// POST /state — receive state events from agent hooks (non-blocking)
async fn handle_state(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ClaudeCodeHookPayload>,
) -> Result<Json<HookResponse>, (StatusCode, String)> {
    payload
        .validate()
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let event = adapt_claude_code_payload(&payload);

    eprintln!(
        "[http] state event: session={} event={} tool={:?} agent={:?}",
        event.session_id, event.event_type, event.tool_name, event.agent
    );

    let json_payload = serde_json::json!({
        "session_id": event.session_id,
        "event_type": event.event_type,
        "tool_name": event.tool_name,
        "tool_input": event.tool_input,
        "agent": event.agent,
        "cwd": event.cwd,
    });
    let app = state.app.clone();

    // Broadcast to all windows
    let _ = app.emit("agent-hook-event", json_payload.clone());

    // Also emit specifically to pet window
    if let Some(pet_win) = app.get_webview_window("pet") {
        let _ = pet_win.emit("agent-hook-event", json_payload);
    }

    Ok(Json(HookResponse {
        ok: true,
        message: "event forwarded".into(),
    }))
}

/// POST /permission — handle permission request (blocking until user responds)
async fn handle_permission(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ClaudeCodePermissionPayload>,
) -> Result<Json<ClaudeCodePermissionResponse>, StatusCode> {
    payload
        .validate()
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let tool_name = payload.tool_name.clone().unwrap_or_default();

    eprintln!(
        "[http] permission request: tool={} session={}",
        tool_name, payload.session_id
    );

    // Check if this tool is in the always-allow list
    {
        let always = state.always_allow.lock().await;
        if always.contains(&tool_name) {
            eprintln!("[http] tool '{}' in always-allow list, auto-approving", tool_name);
            return Ok(Json(ClaudeCodePermissionResponse {
                hook_specific_output: ClaudeCodePermissionOutput {
                    hook_event_name: "PermissionRequest".into(),
                    decision: PermissionDecisionBehavior { behavior: "allow".into() },
                },
            }));
        }
    }

    // Generate internal request ID
    let request_id = {
        let mut counter = state.request_counter.lock().await;
        *counter += 1;
        format!("perm-{}", *counter)
    };

    let (tx, rx) = oneshot::channel::<PermissionResponse>();

    // Store the sender (capped at MAX_PENDING_REQUESTS to prevent unbounded growth)
    {
        let mut pending = state.pending.lock().await;
        if pending.len() >= MAX_PENDING_REQUESTS {
            eprintln!(
                "[http] pending queue full ({}/{}), rejecting",
                pending.len(),
                MAX_PENDING_REQUESTS
            );
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        pending.insert(request_id.clone(), tx);
    }

    // Show bubble window at the user-configured position
    let position = state.bubble_position.lock().unwrap().clone();
    if let Err(err) = show_bubble_window(&state.app, &position) {
        eprintln!("[http] failed to show bubble window: {err}");
    }

    // Emit permission request to bubble window
    let bubble_payload = serde_json::json!({
        "request_id": request_id,
        "session_id": payload.session_id,
        "tool_name": payload.tool_name,
        "tool_input": payload.tool_input,
        "agent": "claude-code",
        "cwd": payload.cwd,
    });
    let app = state.app.clone();

    if let Some(bubble_win) = app.get_webview_window("pet-bubble") {
        let _ = bubble_win.emit("permission-request", bubble_payload.clone());
    }
    let _ = app.emit("permission-request", bubble_payload);

    // Block until user responds (5-minute timeout)
    let timeout = tokio::time::Duration::from_secs(300);
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(response)) => {
            eprintln!("[http] permission response: {:?}", response);

            // If "always", add to always-allow list
            if response.decision == "always" {
                let mut always = state.always_allow.lock().await;
                always.insert(tool_name.clone());
                eprintln!("[http] added '{}' to always-allow list", tool_name);
            }

            // Hide bubble window
            hide_bubble_window(&state.app);

            // Convert to Claude Code response format
            let decision = if response.decision == "always" {
                "allow"
            } else {
                &response.decision
            };

            Ok(Json(ClaudeCodePermissionResponse {
                hook_specific_output: ClaudeCodePermissionOutput {
                    hook_event_name: "PermissionRequest".into(),
                    decision: PermissionDecisionBehavior { behavior: decision.to_string() },
                },
            }))
        }
        Ok(Err(_)) => {
            eprintln!("[http] permission sender dropped");
            hide_bubble_window(&state.app);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
        Err(_) => {
            eprintln!("[http] permission timeout");
            // Clean up pending entry
            let mut pending = state.pending.lock().await;
            pending.remove(&request_id);
            hide_bubble_window(&state.app);
            // Return 204 — Claude Code falls back to native prompt
            Err(StatusCode::NO_CONTENT)
        }
    }
}

/// Show the permission bubble window at the configured corner of the screen.
///
/// `position` is one of: "bottom-right" (default), "bottom-left",
/// "top-right", "top-left".
fn show_bubble_window(
    app: &AppHandle,
    position: &str,
) -> Result<(), String> {
    use tauri::PhysicalPosition;

    if let Some(bubble) = app.get_webview_window("pet-bubble") {
        // Get primary monitor for positioning
        if let Ok(Some(monitor)) = app.primary_monitor() {
            let screen = monitor.size();
            let scale = monitor.scale_factor();
            let win_w = (360.0 * scale) as i32;
            let win_h = (200.0 * scale) as i32;
            let margin = (20.0 * scale) as i32;
            let (x, y) = match position {
                "bottom-left" => (margin, screen.height as i32 - win_h - margin),
                "top-right" => (screen.width as i32 - win_w - margin, margin),
                "top-left" => (margin, margin),
                // bottom-right (default)
                _ => (
                    screen.width as i32 - win_w - margin,
                    screen.height as i32 - win_h - margin,
                ),
            };

            bubble
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
        }
        bubble.show().map_err(|e| e.to_string())?;
        bubble.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide the permission bubble window
fn hide_bubble_window(app: &AppHandle) {
    if let Some(bubble) = app.get_webview_window("pet-bubble") {
        let _ = bubble.hide();
    }
}

// ── Router ──

pub fn build_router(
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionResponse>>>>,
    bubble_position: Arc<std::sync::Mutex<String>>,
) -> Router {
    let state = Arc::new(AppState {
        app,
        pending,
        request_counter: Arc::new(Mutex::new(0)),
        always_allow: Arc::new(Mutex::new(HashSet::new())),
        bubble_position,
    });
    Router::new()
        .route("/health", get(health))
        .route("/state", post(handle_state))
        .route("/permission", post(handle_permission))
        .with_state(state)
}

pub async fn run(
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionResponse>>>>,
    port: u16,
    bubble_position: Arc<std::sync::Mutex<String>>,
) {
    let router = build_router(app, pending, bubble_position);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));

    eprintln!("[http] starting hook server on http://{addr}");

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(err) => {
            eprintln!("[http] failed to bind to {addr}: {err}");
            return;
        }
    };

    if let Err(err) = axum::serve(listener, router).await {
        eprintln!("[http] server error: {err}");
    }
}
