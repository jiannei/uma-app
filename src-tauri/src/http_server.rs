// src-tauri/src/http_server.rs — HTTP server for agent hook events + permission requests
// Receives POST events from Claude Code (and eventually Codex) hooks
// Forwards to JS state machine via Tauri events

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HookEvent {
    pub session_id: String,
    pub event_type: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PermissionRequest {
    pub request_id: String,
    pub session_id: String,
    pub tool_name: String,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionResponse {
    pub request_id: String,
    pub decision: String, // "allow" | "deny" | "always"
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HookResponse {
    pub ok: bool,
    pub message: String,
}

#[derive(Clone)]
struct AppState {
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionResponse>>>>,
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "uma-pet",
    }))
}

async fn handle_hook(
    State(state): State<Arc<AppState>>,
    Json(event): Json<HookEvent>,
) -> Result<Json<HookResponse>, (StatusCode, String)> {
    eprintln!(
        "[http] hook event: session={} type={} tool={:?} agent={:?}",
        event.session_id, event.event_type, event.tool_name, event.agent
    );

    let payload = serde_json::json!({
        "session_id": event.session_id,
        "event_type": event.event_type,
        "tool_name": event.tool_name,
        "agent": event.agent,
        "cwd": event.cwd,
    });
    let app = state.app.clone();

    match app.emit("agent-hook-event", payload.clone()) {
        Ok(_) => eprintln!("[http] event broadcast OK"),
        Err(err) => eprintln!("[http] emit broadcast failed: {err}"),
    }

    if let Some(pet_win) = app.get_webview_window("pet") {
        match pet_win.emit("agent-hook-event", payload) {
            Ok(_) => eprintln!("[http] event emitted to pet window"),
            Err(err) => eprintln!("[http] emit to pet failed: {err}"),
        }
    } else {
        eprintln!("[http] pet window not found");
    }

    Ok(Json(HookResponse {
        ok: true,
        message: "event forwarded".into(),
    }))
}

#[derive(Debug, Clone, Deserialize)]
pub struct ThemeRequest {
    pub theme: String,
}

async fn handle_theme(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ThemeRequest>,
) -> Result<Json<HookResponse>, (StatusCode, String)> {
    eprintln!("[http] theme change: {}", req.theme);
    let payload = serde_json::json!({ "theme": req.theme });
    let app = state.app.clone();

    app.emit("pet-theme-change", payload.clone())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(pet_win) = app.get_webview_window("pet") {
        pet_win.emit("pet-theme-change", payload)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(Json(HookResponse {
        ok: true,
        message: format!("theme changed to {}", req.theme),
    }))
}

/// Handle a permission request — blocks until the user responds via the bubble UI.
async fn handle_permission_request(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PermissionRequest>,
) -> Result<Json<PermissionResponse>, (StatusCode, String)> {
    eprintln!(
        "[http] permission request: id={} tool={} session={}",
        req.request_id, req.tool_name, req.session_id
    );

    let (tx, rx) = oneshot::channel::<PermissionResponse>();

    // Store the sender so the Tauri command can find it
    {
        let mut pending = state.pending.lock().await;
        pending.insert(req.request_id.clone(), tx);
    }

    // Emit to all windows — bubble window will pick it up
    let payload = serde_json::json!({
        "request_id": req.request_id,
        "session_id": req.session_id,
        "tool_name": req.tool_name,
        "tool_input": req.tool_input,
        "agent": req.agent,
        "cwd": req.cwd,
    });
    let app = state.app.clone();

    match app.emit("permission-request", payload.clone()) {
        Ok(_) => eprintln!("[http] permission event broadcast OK"),
        Err(err) => eprintln!("[http] permission broadcast failed: {err}"),
    }

    // Block until user responds (with a 5-minute timeout)
    let timeout = tokio::time::Duration::from_secs(300);
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(response)) => {
            eprintln!("[http] permission response: {:?}", response);
            Ok(Json(response))
        }
        Ok(Err(_)) => {
            eprintln!("[http] permission sender dropped");
            Err((StatusCode::INTERNAL_SERVER_ERROR, "sender dropped".into()))
        }
        Err(_) => {
            eprintln!("[http] permission timeout");
            // Clean up pending entry
            let mut pending = state.pending.lock().await;
            pending.remove(&req.request_id);
            Err((StatusCode::REQUEST_TIMEOUT, "user did not respond".into()))
        }
    }
}

pub fn build_router(
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionResponse>>>>,
) -> Router {
    let state = Arc::new(AppState { app, pending });
    Router::new()
        .route("/health", get(health))
        .route("/hook/event", post(handle_hook))
        .route("/theme", post(handle_theme))
        .route("/permission/request", post(handle_permission_request))
        .with_state(state)
}

pub async fn run(
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionResponse>>>>,
    port: u16,
) {
    let router = build_router(app, pending);
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