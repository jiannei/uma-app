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
//
// ADR-0011: this server no longer maintains an `AlwaysAllowStore` —
// Claude Code (and equivalent agents) own session-scoped permission
// rules via `destination: "session"` entries in
// `permission_suggestions`. We just relay the bubble's pick as
// `updatedPermissions`; the agent handles persistence and short-circuit.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex};

use crate::agent::{self, PermissionDecision};
use crate::events::prod;
use crate::pending_store::{CapFull, PendingEntry, PendingStore};

// ── Internal types ──────────────────────────────────────────────

/// Generic success response for non-blocking endpoints.
#[derive(Debug, Clone, Serialize)]
pub struct HookResponse {
    pub ok: bool,
    pub message: String,
}

// ── App state ───────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    app: AppHandle,
    /// Pending permission requests. `PendingStore` owns the map,
    /// the cap check, and the devtools-emit invariant. The cap
    /// itself lives in `pending_store::MAX_PENDING_REQUESTS`.
    pending: PendingStore,
    /// Internal request ID counter (per process).
    request_counter: Arc<Mutex<u64>>,
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

    log::info!(
        "[http] state event: agent={} session={} event={} tool={:?} subagent={:?}",
        agent_id, event.session_id, event.event_type, event.tool_name, event.subagent
    );

    // The state machine + robot window expect a flat JSON shape with these
    // keys. Serialize the canonical HookEvent directly (its field names
    // already match the legacy shape, with `agent` now being a string
    // after AgentId's transparent serialization).
    let json_payload = serde_json::to_value(&event)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("serialize: {e}")))?;
    let app = state.app.clone();
    let _ = app.emit(prod::AGENT_HOOK, json_payload.clone());
    if let Some(robot_win) = app.get_webview_window("robot") {
        let _ = robot_win.emit(prod::AGENT_HOOK, json_payload);
    }

    Ok(Json(HookResponse {
        ok: true,
        message: "event forwarded".into(),
    }))
}

/// POST /agents/{id}/permission — blocking permission request.
///
/// The handler blocks until either the user picks a button in the
/// bubble (response arrives via `respond_permission`) or the 5-minute
/// timeout elapses. On timeout, returns 204 so the agent can fall
/// back to its native prompt.
async fn handle_permission(
    State(state): State<Arc<AppState>>,
    Path(agent_id): Path<String>,
    Json(raw): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let adapter = agent::lookup_agent(&agent_id).ok_or(StatusCode::NOT_FOUND)?;

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

    let tool_name = canonical.tool_name().unwrap_or("").to_string();

    log::info!(
        "[http] permission request: agent={} tool={} session={} kind={:?}",
        agent_id,
        tool_name,
        canonical.session_id(),
        canonical.kind(),
    );

    // Cap pending queue + insert. The cap, the mutation, and the
    // devtools `PENDING_CHANGED` emit all live inside
    // `PendingStore::insert` — callers just match on `CapFull`.
    let (tx, rx) = oneshot::channel::<PermissionDecision>();
    let entry = PendingEntry {
        tx,
        request: canonical.clone(),
        agent_id: agent_id.clone(),
    };
    if let Err(CapFull { current, max }) = state.pending.insert(request_id.clone(), entry).await {
        log::info!("[http] pending queue full ({}/{}), rejecting", current, max);
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    // Show bubble at its fixed TopCenter position (set once at window
    // creation — see lib.rs setup hook + ADR-0013 决策 4).
    if let Err(err) = show_bubble_window(&state.app) {
        log::warn!("[http] failed to show bubble window: {err}");
    }

    // Emit to the bubble window. The canonical PermissionRequest
    // already carries agent + agent_display_name, so the bubble no
    // longer has to hardcode "claude-code".
    let bubble_payload = serde_json::to_value(&canonical)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let app = state.app.clone();
    if let Some(bubble_win) = app.get_webview_window("permission-bubble") {
        match bubble_win.emit(prod::PERMISSION_REQUEST, bubble_payload.clone()) {
            Ok(()) => log::debug!("[http] emitted to permission-bubble webview"),
            Err(e) => log::warn!("[http] emit to bubble FAILED: {e}"),
        }
    } else {
        log::error!("[http] permission-bubble webview NOT FOUND");
    }
    match app.emit(prod::PERMISSION_REQUEST, bubble_payload) {
        Ok(()) => log::debug!("[http] emitted app-wide"),
        Err(e) => log::warn!("[http] app.emit FAILED: {e}"),
    }

    // Block until user response or timeout.
    let timeout = tokio::time::Duration::from_secs(300);
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(decision)) => {
            log::info!(
                "[http] permission response: request_id={} behavior={:?}",
                decision.request_id, decision.behavior,
            );
            hide_bubble_window(&state.app);
            // Forward the canonical decision to the agent via the
            // adapter; the agent owns the wire-format envelope
            // (e.g. Claude Code's `hookSpecificOutput.decision`).
            let payload = adapter
                .build_permission_response(&decision)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(Json(payload))
        }
        Ok(Err(_)) => {
            log::warn!("[http] permission sender dropped");
            hide_bubble_window(&state.app);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
        Err(_) => {
            log::warn!("[http] permission timeout");
            // Remove the entry + emit devtools `PENDING_CHANGED`
            // remove — both live inside `PendingStore::timeout`.
            state.pending.timeout(&request_id).await;

            // ADR-0013 决策 8: 超时自动 deny + 给 agent 响应 —
            // 否则 agent 会 hang 等待 response，违反"必须响应"
            // 契约。bubble webview 同时收到 permission-timeout
            // event 显示"⏰ 已超时"反馈 1s。
            let timeout_decision = crate::agent::PermissionDecision {
                request_id: request_id.clone(),
                behavior: crate::agent::DecisionBehavior::Deny,
                message: Some("User did not respond within 5 minutes".into()),
                interrupt: None,
                updated_input: None,
                updated_permissions: None,
            };
            let payload = adapter
                .build_permission_response(&timeout_decision)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            // Notify bubble so it can show "⏰ 已超时" feedback
            if let Some(bubble_win) = state.app.get_webview_window("permission-bubble") {
                let _ = bubble_win.emit(
                    prod::PERMISSION_TIMEOUT,
                    serde_json::json!({ "request_id": &request_id }),
                );
            }

            Ok(Json(payload))
        }
    }
}

// ── Bubble window positioning ───────────────────────────────────
//
// Bubble position is **fixed once** at window creation
// (`move_window(Position::TopCenter)` in lib.rs). Per ADR-0013 决策 4
// and the BubbleApp.vue "click-through" comment: webview is
// permanently at TopCenter, so we just `show` + `setFocus` here.

pub fn show_bubble_window(app: &AppHandle) -> Result<(), String> {
    if let Some(bubble) = app.get_webview_window("permission-bubble") {
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
    pending: PendingStore,
) -> Router {
    let state = Arc::new(AppState {
        app,
        pending,
        request_counter: Arc::new(Mutex::new(0)),
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
    pending: PendingStore,
    port: u16,
) {
    let router = build_router(app, pending);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));

    log::info!("[http] starting hook server on http://{addr}");

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(err) => {
            log::error!("[http] failed to bind to {addr}: {err}");
            return;
        }
    };

    if let Err(err) = axum::serve(listener, router).await {
        log::error!("[http] server error: {err}");
    }
}