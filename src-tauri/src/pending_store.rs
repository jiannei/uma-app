// src-tauri/src/pending_store.rs — In-memory store of outstanding
// permission requests, plus the Tauri command surface that reads
// and mutates it.
//
// The HTTP handler (`http_server.rs`) inserts an entry when a
// permission request arrives; `resolve` removes it when the user
// decides via `respond_permission`; `timeout` removes it when the
// 5-min timeout elapses (the http handler synthesises the deny
// decision and returns it to the agent).
//
// ## Architecture
//
// The module is split into two layers:
//
//   - `PendingMap` (private): a pure data structure — a HashMap with
//     a cap check, oneshot delivery, and snapshot support. Fully
//     unit-testable without Tauri.
//
//   - `PendingStore` (public): wraps `PendingMap` in a `Mutex`,
//     carries an `AppHandle`, and enforces the devtools-emit
//     invariant — every mutation emits `dev::PENDING_CHANGED` in
//     debug builds. Callers cannot forget the emit because it is
//     inside the mutator.
//
// This mirrors the `pure.ts` + XState machine split on the frontend:
// a pure core with exhaustive tests, a thin wrapper that wires it
// into the framework.
//
// ## Call sites
//
//   - `http_server.rs::handle_permission` — `insert` on arrival,
//     `timeout` on 5-min expiry.
//   - `commands.rs::respond_permission` — `resolve` when the user
//     picks a button.
//   - `devtools.rs::devtools_get_pending` — `snapshot`.
//   - `devtools.rs::devtools_fire_synthetic_permission` — `insert`
//     (used by the dev panel to drive each bubble renderer).

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::agent::{PermissionDecision, PermissionRequest};
use crate::events::dev;

// ── Public types ────────────────────────────────────────────────

/// One outstanding permission request. The oneshot sender is the
/// user-decision transport: `PendingStore::resolve` delivers the
/// decision through it; `PendingStore::timeout` drops it (the
/// http handler synthesises the deny decision separately).
///
/// Not `Clone` because `oneshot::Sender` isn't. `PendingStore`
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

/// Returned by `PendingStore::insert` when the cap is reached.
/// Callers (the http server) map this to `503 Service Unavailable`.
#[derive(Debug)]
pub struct CapFull {
    pub current: usize,
    pub max: usize,
}

// ── Private pure core ───────────────────────────────────────────

/// Maximum concurrent in-flight permission requests. New requests
/// are rejected when the queue is at the cap — prevents unbounded
/// growth from misbehaving callers.
const MAX_PENDING_REQUESTS: usize = 50;

/// Pure data structure: the pending map without any I/O or emit
/// concerns. Testable without Tauri.
///
/// Mutators return `Option<PendingChange>` describing what happened
/// so the wrapper can emit the matching devtools event. In release
/// builds the wrapper discards the `PendingChange` (the `emit`
/// helper is a no-op); the construction cost is a few `String`
/// clones per mutation, which is negligible.
struct PendingMap {
    map: HashMap<String, PendingEntry>,
}

impl PendingMap {
    fn new() -> Self {
        Self { map: HashMap::new() }
    }

    fn insert(
        &mut self,
        request_id: String,
        entry: PendingEntry,
    ) -> Result<Option<PendingChange>, CapFull> {
        if self.map.len() >= MAX_PENDING_REQUESTS {
            return Err(CapFull {
                current: self.map.len(),
                max: MAX_PENDING_REQUESTS,
            });
        }
        let change = PendingChange::Insert {
            request_id: request_id.clone(),
            agent_id: entry.agent_id.clone(),
            request: Box::new(entry.request.clone()),
        };
        self.map.insert(request_id, entry);
        Ok(Some(change))
    }

    /// Remove the entry and deliver the decision via the oneshot
    /// channel. Returns the matching `PendingChange` if an entry
    /// was found (caller emits it), `None` otherwise.
    ///
    /// The `tx.send` is best-effort: if the receiver has been
    /// dropped, we silently discard. In practice this is
    /// unreachable because `resolve` and `timeout` both take the
    /// same mutex, so they cannot race the http handler's rx.
    fn resolve(
        &mut self,
        request_id: &str,
        decision: PermissionDecision,
    ) -> Option<PendingChange> {
        let entry = self.map.remove(request_id)?;
        let _ = entry.tx.send(decision);
        Some(PendingChange::Remove {
            request_id: request_id.to_string(),
        })
    }

    /// Remove the entry without delivering a decision. The http
    /// handler's rx has already timed out; the caller synthesises
    /// the deny decision and returns it to the agent directly.
    fn timeout(&mut self, request_id: &str) -> Option<PendingChange> {
        self.map.remove(request_id)?;
        Some(PendingChange::Remove {
            request_id: request_id.to_string(),
        })
    }

    fn snapshot(&self) -> Vec<PendingEntryView> {
        self.map
            .iter()
            .map(|(id, entry)| PendingEntryView {
                request_id: id.clone(),
                agent_id: entry.agent_id.clone(),
                request: entry.request.clone(),
            })
            .collect()
    }
}

// ── Emit payload (private) ──────────────────────────────────────

/// Devtools event payload. Internally-tagged so the JSON shape
/// matches what the dev panel already consumes:
///   `{ "kind": "insert", "requestId": ..., "agentId": ..., "request": ... }`
///   `{ "kind": "remove", "requestId": ... }`
#[derive(Clone, Debug, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum PendingChange {
    Insert {
        request_id: String,
        agent_id: String,
        // Boxed: `PermissionRequest` is ~256 bytes and would
        // otherwise bloat the enum's stack footprint (the `Remove`
        // variant is only ~24 bytes). serde's tag-based
        // serialization is unaffected.
        request: Box<PermissionRequest>,
    },
    Remove {
        request_id: String,
    },
}

// ── Public wrapper ──────────────────────────────────────────────

/// In-memory store of outstanding permission requests. Wraps a
/// pure `PendingMap` in a `Mutex` and owns the devtools-emit
/// invariant: every mutation emits `dev::PENDING_CHANGED` in debug
/// builds. Call sites cannot forget the emit because it lives
/// inside the mutator.
///
/// Cheap to clone (wraps an `Arc`). Registered as Tauri state so
/// commands can take `State<'_, PendingStore>`.
#[derive(Clone)]
pub struct PendingStore {
    inner: Arc<Mutex<PendingMap>>,
    app: AppHandle,
}

impl PendingStore {
    pub fn new(app: AppHandle) -> Self {
        Self {
            inner: Arc::new(Mutex::new(PendingMap::new())),
            app,
        }
    }

    pub async fn insert(
        &self,
        request_id: String,
        entry: PendingEntry,
    ) -> Result<(), CapFull> {
        let change = {
            let mut map = self.inner.lock().await;
            map.insert(request_id, entry)?
        };
        // Lock released before emit: PendingMap returned the change
        // description, so we don't need the lock held to read it.
        // The emit is still ordered strictly after the mutation —
        // devtools listeners see the event only once the mutation
        // has committed. The previous implementation emitted inside
        // the lock; the ordering relaxation is safe for our use
        // case (no listener races the mutation) and buys a shorter
        // lock hold time.
        self.emit(change);
        Ok(())
    }

    /// User responded. Remove the entry and deliver the decision
    /// via the oneshot. Returns `true` if an entry was found.
    pub async fn resolve(
        &self,
        request_id: &str,
        decision: PermissionDecision,
    ) -> bool {
        let change = {
            let mut map = self.inner.lock().await;
            map.resolve(request_id, decision)
        };
        let found = change.is_some();
        self.emit(change);
        found
    }

    /// 5-min timeout fired. Remove the entry without delivering a
    /// decision (the caller synthesises the deny). Returns `true`
    /// if an entry was found.
    pub async fn timeout(&self, request_id: &str) -> bool {
        let change = {
            let mut map = self.inner.lock().await;
            map.timeout(request_id)
        };
        let found = change.is_some();
        self.emit(change);
        found
    }

    pub async fn snapshot(&self) -> Vec<PendingEntryView> {
        let map = self.inner.lock().await;
        map.snapshot()
    }

    // ── helpers ─────────────────────────────────────────────────

    /// Emit the devtools event, or no-op in release builds.
    #[cfg(debug_assertions)]
    fn emit(&self, change: Option<PendingChange>) {
        if let Some(change) = change {
            let _ = self.app.emit(dev::PENDING_CHANGED, change);
        }
    }

    #[cfg(not(debug_assertions))]
    fn emit(&self, _change: Option<PendingChange>) {}
}

// ── Tests (pure core) ───────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{DecisionBehavior, PermissionBase};

    fn test_request(id: &str) -> PermissionRequest {
        PermissionRequest::SideEffect {
            base: PermissionBase {
                request_id: id.to_string(),
                session_id: "s".into(),
                agent: crate::agent::AgentId("a".into()),
                agent_display_name: "A".into(),
                cwd: None,
            },
            tool_name: None,
            tool_input: None,
            permission_suggestions: vec![],
        }
    }

    fn test_entry(id: &str) -> (PendingEntry, tokio::sync::oneshot::Receiver<PermissionDecision>) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        (
            PendingEntry {
                tx,
                request: test_request(id),
                agent_id: "a".into(),
            },
            rx,
        )
    }

    fn test_decision(id: &str, behavior: DecisionBehavior) -> PermissionDecision {
        PermissionDecision {
            request_id: id.into(),
            behavior,
            message: None,
            interrupt: None,
            updated_input: None,
            updated_permissions: None,
        }
    }

    #[test]
    fn insert_under_cap_succeeds() {
        let mut m = PendingMap::new();
        let (e, _rx) = test_entry("r1");
        assert!(m.insert("r1".into(), e).unwrap().is_some());
    }

    #[test]
    fn insert_at_cap_returns_cap_full() {
        let mut m = PendingMap::new();
        for i in 0..MAX_PENDING_REQUESTS {
            let (e, _rx) = test_entry(&format!("r{i}"));
            m.insert(format!("r{i}"), e).unwrap();
        }
        let (e, _rx) = test_entry("overflow");
        let err = m.insert("overflow".into(), e).unwrap_err();
        assert_eq!(err.current, MAX_PENDING_REQUESTS);
        assert_eq!(err.max, MAX_PENDING_REQUESTS);
    }

    #[test]
    fn resolve_delivers_decision_and_removes() {
        let mut m = PendingMap::new();
        let (e, mut rx) = test_entry("r1");
        m.insert("r1".into(), e).unwrap();

        let change = m.resolve("r1", test_decision("r1", DecisionBehavior::Allow));
        assert!(change.is_some());

        let received = rx.try_recv().unwrap();
        assert_eq!(received.request_id, "r1");
        assert!(matches!(received.behavior, DecisionBehavior::Allow));

        assert!(m.snapshot().is_empty());
    }

    #[test]
    fn resolve_missing_returns_none() {
        let mut m = PendingMap::new();
        assert!(m.resolve("ghost", test_decision("ghost", DecisionBehavior::Deny)).is_none());
    }

    #[test]
    fn timeout_removes_without_delivering() {
        let mut m = PendingMap::new();
        let (e, mut rx) = test_entry("r1");
        m.insert("r1".into(), e).unwrap();

        let change = m.timeout("r1");
        assert!(change.is_some());
        // oneshot sender was dropped (no send), so rx sees an error.
        assert!(rx.try_recv().is_err());
        assert!(m.snapshot().is_empty());
    }

    #[test]
    fn timeout_missing_returns_none() {
        let mut m = PendingMap::new();
        assert!(m.timeout("ghost").is_none());
    }

    #[test]
    fn snapshot_returns_views() {
        let mut m = PendingMap::new();
        let (e1, _rx1) = test_entry("r1");
        let (e2, _rx2) = test_entry("r2");
        m.insert("r1".into(), e1).unwrap();
        m.insert("r2".into(), e2).unwrap();

        let views = m.snapshot();
        assert_eq!(views.len(), 2);
        let mut ids: Vec<_> = views.iter().map(|v| v.request_id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["r1", "r2"]);
        assert_eq!(views[0].agent_id, "a");
    }
}
