// src-tauri/src/http_server.rs — HTTP server for agent hook events + permission requests
//
// Endpoints (agent-routed):
//   GET  /health                          → health check
//   POST /agents/{id}/state              → state events (non-blocking, fire-and-forget)
//   POST /agents/{id}/permission         → permission request (blocking, waits for user response)
//
// The {id} path segment selects the agent adapter (see `crate::agent`).
// The adapter owns the wire format: this server only knows about the
// canonical `HookEvent` / `PermissionRequest` types that the adapter
// translates to.
//
// Security model (MVP, simplified):
// - Bound to 127.0.0.1 only (no LAN/external reachability)
// - Pending permission requests are capped at MAX_PENDING_REQUESTS
//   to prevent unbounded growth from misbehaving callers
// - Each adapter validates its own raw payload (length caps, etc.)
//
// Trust model: this is a single-user desktop app. The loopback bind is
// the only network boundary. Any other local process can send requests;
// we accept this risk in exchange for a simpler hook configuration
// (no token, no signed URLs). If the user wants stronger isolation
// later, the hook installer can switch to a Unix domain socket.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex};

use crate::agent;
use crate::PendingEntry;

// ── Internal types ──────────────────────────────────────────────

/// Permission response as the bubble UI sends it. Decision string is
/// one of "allow" | "deny" | "always" — the HTTP layer normalizes
/// "always" into a write to the always-allow set before translating
/// the wire response via the adapter.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct PermissionResponse {
    pub request_id: String,
    pub decision: String, // "allow" | "deny" | "always"
    #[serde(default)]
    pub reason: Option<String>,
}

/// Generic success response for non-blocking endpoints.
#[derive(Debug, Clone, Serialize)]
pub struct HookResponse {
    pub ok: bool,
    pub message: String,
}

// ── App state ───────────────────────────────────────────────────

/// Maximum concurrent in-flight permission requests. New requests are
/// rejected with 503 if the queue is full — prevents unbounded growth
/// of the pending map if a misbehaving caller never responds.
const MAX_PENDING_REQUESTS: usize = 50;

#[derive(Clone)]
struct AppState {
    app: AppHandle,
    /// Pending permission requests, keyed by request_id. The
    /// `PendingEntry` carries the oneshot sender AND the canonical
    /// request payload (so the dev-tools panel can render pending
    /// requests without re-fetching). Mirrors `lib.rs::PendingStore`.
    pending: Arc<Mutex<HashMap<String, PendingEntry>>>,
    /// Per-(agent, session) always-allow tool set. Scope follows ADR-0003:
    /// tool name is auto-approved only for that specific agent and session.
    /// Memory-only, lost on restart (intentional MVP scope).
    always_allow: Arc<Mutex<HashMap<(String, String), std::collections::HashSet<String>>>>,
    /// Internal request ID counter (per process).
    request_counter: Arc<Mutex<u64>>,
    /// User-configured bubble position ("bottom-right" default).
    bubble_position: Arc<std::sync::Mutex<String>>,
}

// ── Handlers ────────────────────────────────────────────────────

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "uma-app",
    }))
}

/// POST /agents/{id}/state — non-blocking state event from an agent hook.
async fn handle_state(
    State(state): State<Arc<AppState>>,
    Path(agent_id): Path<String>,
    Json(raw): Json<serde_json::Value>,
) -> Result<Json<HookResponse>, (StatusCode, String)> {
    let adapter = agent::lookup_agent(&agent_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("unknown agent: {agent_id}")))?;
    let event = adapter
        .parse_state_payload(raw)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    eprintln!(
        "[http] state event: agent={} session={} event={} tool={:?}",
        agent_id, event.session_id, event.event_type, event.tool_name
    );

    // The state machine + robot window expect a flat JSON shape with these
    // keys. Serialize the canonical HookEvent directly (its field names
    // already match the legacy shape, with `agent` now being a string
    // after AgentId's transparent serialization).
    let json_payload = serde_json::to_value(&event)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("serialize: {e}")))?;
    let app = state.app.clone();
    let _ = app.emit("agent-hook-event", json_payload.clone());
    if let Some(robot_win) = app.get_webview_window("robot") {
        let _ = robot_win.emit("agent-hook-event", json_payload);
    }

    Ok(Json(HookResponse {
        ok: true,
        message: "event forwarded".into(),
    }))
}

/// POST /agents/{id}/permission — blocking permission request.
///
/// The handler blocks until either the user clicks a button in the
/// bubble (response arrives via `respond_permission`) or the
/// 5-minute timeout elapses. On timeout, returns 204 so the agent
/// can fall back to its native prompt.
async fn handle_permission(
    State(state): State<Arc<AppState>>,
    Path(agent_id): Path<String>,
    Json(raw): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let adapter = agent::lookup_agent(&agent_id).ok_or(StatusCode::NOT_FOUND)?;
    let tool_name = raw
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Allocate internal request id BEFORE calling the adapter, so the
    // canonical PermissionRequest carries it for the bubble UI.
    let request_id = {
        let mut counter = state.request_counter.lock().await;
        *counter += 1;
        format!("perm-{}", *counter)
    };

    let canonical = adapter
        .parse_permission_payload(raw, request_id.clone())
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    eprintln!(
        "[http] permission request: agent={} tool={} session={}",
        agent_id, tool_name, canonical.session_id
    );

    // Check the always-allow set (per ADR-0003, scoped to (agent, session)).
    {
        let allow = state.always_allow.lock().await;
        if let Some(tools) = allow.get(&(agent_id.clone(), canonical.session_id.clone())) {
            if tools.contains(&tool_name) {
                eprintln!(
                    "[http] tool '{}' in always-allow for {}/{}, auto-approving",
                    tool_name, agent_id, canonical.session_id
                );
                let response = adapter
                    .build_permission_response(&request_id, "allow")
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                return Ok(Json(response));
            }
        }
    }

    // Cap pending queue.
    let (tx, rx) = oneshot::channel::<PermissionResponse>();
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
        pending.insert(
            request_id.clone(),
            PendingEntry {
                tx,
                request: canonical.clone(),
                agent_id: agent_id.clone(),
            },
        );

        // Dev-tools panel watches PendingStore mutations.
        #[cfg(feature = "dev-tools")]
        {
            let _ = state.app.emit(
                "devtools-pending-changed",
                serde_json::json!({
                    "kind": "insert",
                    "request_id": &request_id,
                    "agent_id": &agent_id,
                    "request": &canonical,
                }),
            );
        }
    }

    // Show bubble at the user-configured corner.
    let position = state.bubble_position.lock().unwrap().clone();
    if let Err(err) = show_bubble_window(&state.app, &position) {
        eprintln!("[http] failed to show bubble window: {err}");
    }

    // Emit to the bubble window. The canonical PermissionRequest
    // already carries agent + agent_display_name, so the bubble no
    // longer has to hardcode "claude-code".
    let bubble_payload = serde_json::to_value(&canonical)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let app = state.app.clone();
    if let Some(bubble_win) = app.get_webview_window("permission-bubble") {
        let _ = bubble_win.emit("permission-request", bubble_payload.clone());
    }
    let _ = app.emit("permission-request", bubble_payload);

    // Block until user response or timeout.
    let timeout = tokio::time::Duration::from_secs(300);
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(response)) => {
            eprintln!("[http] permission response: {:?}", response);
            if response.decision == "always" {
                let mut allow = state.always_allow.lock().await;
                allow
                    .entry((agent_id.clone(), canonical.session_id.clone()))
                    .or_insert_with(std::collections::HashSet::new)
                    .insert(tool_name.clone());
                eprintln!(
                    "[http] added '{}' to always-allow for {}/{}",
                    tool_name, agent_id, canonical.session_id
                );

                // Dev-tools panel watches AlwaysAllowStore mutations.
                #[cfg(feature = "dev-tools")]
                {
                    let _ = state.app.emit(
                        "devtools-always-allow-changed",
                        serde_json::json!({
                            "kind": "insert",
                            "agent_id": &agent_id,
                            "session_id": &canonical.session_id,
                            "tool_name": &tool_name,
                        }),
                    );
                }
            }
            hide_bubble_window(&state.app);
            let wire_decision = if response.decision == "always" {
                "allow"
            } else {
                &response.decision
            };
            let payload = adapter
                .build_permission_response(&request_id, wire_decision)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(Json(payload))
        }
        Ok(Err(_)) => {
            eprintln!("[http] permission sender dropped");
            hide_bubble_window(&state.app);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
        Err(_) => {
            eprintln!("[http] permission timeout");
            let mut pending = state.pending.lock().await;
            pending.remove(&request_id);

            // Dev-tools panel watches PendingStore mutations.
            #[cfg(feature = "dev-tools")]
            {
                let _ = state.app.emit(
                    "devtools-pending-changed",
                    serde_json::json!({
                        "kind": "remove",
                        "request_id": &request_id,
                    }),
                );
            }

            hide_bubble_window(&state.app);
            Err(StatusCode::NO_CONTENT)
        }
    }
}

// ── Bubble window positioning ───────────────────────────────────

fn show_bubble_window(app: &AppHandle, position: &str) -> Result<(), String> {
    use tauri::PhysicalPosition;
    if let Some(bubble) = app.get_webview_window("permission-bubble") {
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

fn hide_bubble_window(app: &AppHandle) {
    if let Some(bubble) = app.get_webview_window("permission-bubble") {
        let _ = bubble.hide();
    }
}

// ── Router ──────────────────────────────────────────────────────

pub fn build_router(
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, PendingEntry>>>,
    always_allow: Arc<Mutex<HashMap<(String, String), std::collections::HashSet<String>>>>,
    bubble_position: Arc<std::sync::Mutex<String>>,
) -> Router {
    let state = Arc::new(AppState {
        app,
        pending,
        request_counter: Arc::new(Mutex::new(0)),
        always_allow,
        bubble_position,
    });
    Router::new()
        .route("/health", get(health))
        // Per-agent routes. Adding a new agent means it gets a route
        // automatically via KNOWN_AGENTS; the install side writes URLs
        // matching this pattern.
        .route("/agents/:id/state", post(handle_state))
        .route("/agents/:id/permission", post(handle_permission))
        .with_state(state)
}

pub async fn run(
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, PendingEntry>>>,
    always_allow: Arc<Mutex<HashMap<(String, String), std::collections::HashSet<String>>>>,
    port: u16,
    bubble_position: Arc<std::sync::Mutex<String>>,
) {
    let router = build_router(app, pending, always_allow, bubble_position);
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
