// src-tauri/src/pending_store.rs — In-memory store of outstanding
// permission requests, plus the Tauri command surface that reads
// and mutates it.
//
// The HTTP handler (http_server.rs) inserts an entry when a request
// arrives; respond_permission removes it when the user decides. The
// dev panel (lib.rs devtools_fire_synthetic_permission, in the
// commands PR) inserts entries for testing each bubble kind.
//
// `PendingEntry` carries a `oneshot::Sender` so the HTTP handler can
// block until the user responds. `PendingEntryView` is the Tauri-
// command-safe view (Serialize, no oneshot). `PendingStore` is the
// `Arc<Mutex<HashMap<...>>>` wrapper that gets registered on the
// Tauri app state.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::agent::{PermissionDecision, PermissionRequest};

/// One outstanding permission request. The oneshot sender is the
/// user-decision transport (resolved by `respond_permission` or
/// by the 5-min timeout in `http_server`). The `request` field
/// carries the canonical `PermissionRequest` so the dev-tools panel
/// can render it without re-fetching.
///
/// Note: not `Clone` because `oneshot::Sender` isn't. PendingStore
/// itself is cheap to clone (it wraps `Arc<Mutex<...>>`).
pub struct PendingEntry {
    pub tx: tokio::sync::oneshot::Sender<PermissionDecision>,
    pub request: PermissionRequest,
    pub agent_id: String,
}

/// Serializable view of `PendingEntry` for the dev-tools panel
/// (Tauri command return types must `Serialize`; `PendingEntry`
/// can't derive it because `oneshot::Sender` isn't serializable).
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingEntryView {
    pub request_id: String,
    pub agent_id: String,
    pub request: PermissionRequest,
}

#[derive(Clone)]
pub struct PendingStore(pub Arc<Mutex<HashMap<String, PendingEntry>>>);