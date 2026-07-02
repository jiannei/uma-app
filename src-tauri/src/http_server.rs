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
    extract::{DefaultBodyLimit, Extension, Path, State},
    http::{HeaderValue, Request, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex};
use tower_http::{
    on_early_drop::OnEarlyDropLayer,
    request_id::{MakeRequestId, RequestId, SetRequestIdLayer},
};

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

/// Custom `MakeRequestId` impl that produces `perm-{counter}` IDs
/// compatible with the existing PendingStore key format. Uses
/// `AtomicU64` because `MakeRequestId::make_request_id` is sync (not
/// async) — cannot `await` a `Mutex` inside the callback.
#[derive(Clone, Default)]
struct CounterRequestId {
    counter: Arc<AtomicU64>,
}

impl MakeRequestId for CounterRequestId {
    fn make_request_id<B>(&mut self, _request: &Request<B>) -> Option<RequestId> {
        let n = self.counter.fetch_add(1, Ordering::SeqCst) + 1;
        let id_str = format!("perm-{n}");
        HeaderValue::from_str(&id_str)
            .ok()
            .map(RequestId::new)
    }
}

// ── App state ───────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    app: AppHandle,
    /// Pending permission requests. `PendingStore` owns the map,
    /// the cap check, and the devtools-emit invariant. The cap
    /// itself lives in `pending_store::MAX_PENDING_REQUESTS`.
    pending: PendingStore,
    /// Abort signal registry. Maps `perm-{N}` request IDs to a
    /// oneshot sender. When `OnEarlyDropLayer` detects a client
    /// disconnect, it fires the sender; the corresponding watchdog
    /// task receives the signal and cleans up the pending entry +
    /// hides the bubble.
    abort_registry: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

// ── Abort detection ──────────────────────────────────────────────
//
// When a client disconnects mid-request (e.g., user answered the
// permission prompt in Claude Code's TUI), we want to auto-close the
// bubble instead of waiting for the 5-minute timeout. We use
// `tower_http::OnEarlyDropLayer` to detect early drops of the
// response future, and a per-request watchdog task to clean up.

/// Watchdog task: listens for an abort signal from `OnEarlyDropLayer`
/// and performs cleanup (remove from PendingStore + hide bubble).
/// Drops cleanly when the handler completes normally (abort_tx is
/// removed from registry, so abort_rx returns Err → task exits).
async fn make_watchdog(
    state: Arc<AppState>,
    app: AppHandle,
    request_id: String,
    abort_rx: oneshot::Receiver<()>,
) {
    if abort_rx.await.is_ok() {
        log::info!("[http] client disconnected — aborting permission request {request_id}");
        state.pending.timeout(&request_id).await;
        hide_bubble_window(&app).await;
    }
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
/// bubble (response arrives via `respond_permission`), the 5-minute
/// timeout elapses, or the client disconnects mid-request (detected
/// via `OnEarlyDropLayer`). On timeout or disconnect, returns 204
/// so the agent can fall back to its native prompt.
async fn handle_permission(
    State(state): State<Arc<AppState>>,
    Path(agent_id): Path<String>,
    Extension(request_id_ext): Extension<RequestId>,
    Json(raw): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let adapter = agent::lookup_agent(&agent_id).ok_or(StatusCode::NOT_FOUND)?;

    // Extract request ID from the extension set by SetRequestIdLayer.
    // The ID is already in `perm-{counter}` format (generated by
    // CounterRequestId::make_request_id).
    let request_id = request_id_ext
        .header_value()
        .to_str()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .to_string();

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

    // Passthrough: if the tool is in the whitelist, allow immediately
    // without showing the bubble, inserting into PendingStore, or
    // starting the 5-minute timeout.
    if !tool_name.is_empty() && agent::is_passthrough(&tool_name) {
        log::info!("[http] passthrough tool: {} — silent allow", tool_name);
        let allow_decision = crate::agent::PermissionDecision {
            request_id: request_id.clone(),
            behavior: crate::agent::DecisionBehavior::Allow,
            message: None,
            interrupt: None,
            updated_input: None,
            updated_permissions: None,
        };
        let payload = adapter
            .build_permission_response(&allow_decision)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(Json(payload));
    }

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

    // Spawn watchdog task + register abort sender. The watchdog listens
    // for an abort signal from OnEarlyDropLayer (client disconnect) and
    // performs cleanup. The sender is removed from the registry on
    // normal completion (below) to prevent spurious abort signals.
    let (abort_tx, abort_rx) = oneshot::channel();
    state
        .abort_registry
        .lock()
        .await
        .insert(request_id.clone(), abort_tx);
    let watchdog = tokio::spawn(make_watchdog(
        state.clone(),
        state.app.clone(),
        request_id.clone(),
        abort_rx,
    ));

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
    // Emit to the bubble webview via app.emit (broadcast). Previously
    // we also called `bubble_win.emit` for an explicit bubble target,
    // but that meant the bubble received the event twice (once from
    // bubble_win.emit, once from app.emit) and pushed the same
    // request into the queue twice — first deny removed only one
    // copy and the second was stuck forever.
    let app = state.app.clone();
    match app.emit(prod::PERMISSION_REQUEST, bubble_payload) {
        Ok(()) => log::debug!("[http] emitted app-wide"),
        Err(e) => log::warn!("[http] app.emit FAILED: {e}"),
    }

    // Block until user response or timeout.
    let timeout = tokio::time::Duration::from_secs(300);
    let result = match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(decision)) => {
            log::info!(
                "[http] permission response: request_id={} behavior={:?}",
                decision.request_id, decision.behavior,
            );
            hide_bubble_window(&state.app).await;
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
            hide_bubble_window(&state.app).await;
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

            // Rust owns the timeout decision AND its UI side
            // effect: hide the bubble. The TS handler only cleans
            // its local queue (see BubbleShellRoot.vue).
            hide_bubble_window(&state.app).await;

            Ok(Json(payload))
        }
    };

    // Normal completion: remove abort_tx from registry and abort
    // the watchdog task. This prevents spurious abort signals if
    // the client disconnects after we've already sent the response.
    state.abort_registry.lock().await.remove(&request_id);
    watchdog.abort();

    result
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

async fn hide_bubble_window(app: &AppHandle) {
    if let Some(bubble) = app.get_webview_window("permission-bubble") {
        let _ = bubble.hide();
    }
}

// ── Router ──────────────────────────────────────────────────────

pub fn build_router(
    app: AppHandle,
    pending: PendingStore,
) -> Router {
    let abort_registry = Arc::new(Mutex::new(HashMap::new()));
    let state = Arc::new(AppState {
        app: app.clone(),
        pending,
        abort_registry: abort_registry.clone(),
    });

    // Permission route: wraps handler with SetRequestIdLayer (outer) +
    // OnEarlyDropLayer (inner). Layer order matters: SetRequestIdLayer
    // generates the request ID first, then OnEarlyDropLayer captures it
    // for the abort callback.
    let permission_route = Router::new()
        .route("/agents/{id}/permission", post(handle_permission))
        .layer(
            OnEarlyDropLayer::builder()
                .on_future_drop({
                    let registry = abort_registry.clone();
                    move |req: &Request<_>| {
                        let request_id = req
                            .extensions()
                            .get::<RequestId>()
                            .and_then(|rid| {
                                rid.header_value().to_str().ok().map(|s| s.to_string())
                            });
                        let registry = registry.clone();
                        // Inline the abort callback logic. If RequestId is missing
                        // (shouldn't happen), the closure does nothing.
                        move || {
                            if let Some(rid) = request_id {
                                // Spawn a non-blocking task to avoid blocking the drop context.
                                // The sender is fire-and-forget; if the watchdog already
                                // exited, the send returns Err (ignored).
                                let registry = registry.clone();
                                tokio::spawn(async move {
                                    if let Some(tx) = registry.lock().await.remove(&rid) {
                                        let _ = tx.send(());
                                    }
                                });
                            }
                        }
                    }
                }),
        )
        .layer(SetRequestIdLayer::x_request_id(CounterRequestId {
            counter: Arc::new(AtomicU64::new(0)),
        }));

    // Other routes: no abort detection needed.
    let other_routes = Router::new()
        .route("/health", get(health))
        .route("/agents/{id}/state", post(handle_state));

    Router::new()
        .merge(permission_route)
        .merge(other_routes)
        // axum 0.8 raised the default `Json` body limit from 2 KiB to
        // 2 MiB; restore the previous first-pass cap so PR1 stays a
        // pure dependency upgrade. Per-field length caps in
        // `adapters/claude_code.rs` remain the second-line defense.
        .layer(DefaultBodyLimit::max(2 * 1024))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Pure-function coverage for the passthrough check. Full
    /// integration tests for the HTTP path require a live axum
    /// router + PendingStore + AppHandle, which is heavy to mock —
    /// see test-bubble.sh (Plan D Task 6) for runtime coverage.
    #[test]
    fn is_passthrough_matches_constant() {
        for tool in agent::PASSTHROUGH_TOOLS {
            assert!(agent::is_passthrough(tool), "expected {tool} in passthrough");
        }
        assert!(!agent::is_passthrough("Bash"));
        assert!(!agent::is_passthrough("Edit"));
    }
}