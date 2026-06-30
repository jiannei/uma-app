// src-tauri/src/devtools.rs — Dev-only Tauri commands. The whole
// module is gated by `cfg(debug_assertions)` so release builds
// don't carry these.
//
// What lives here:
//   - `devtools_get_pending` — snapshot the in-memory permission
//     store for the dev panel's initial render. Live updates flow
//     through `dev::PENDING_CHANGED` Tauri events (emitted at
//     every mutation point). The panel calls this on mount, then
//     subscribes to the events for incremental updates.
//
//   - `devtools_fire_synthetic_permission` — inject a synthetic
//     permission request of the given `kind` into PendingStore +
//     emit `permission-request` to the bubble. Lets the dev panel
//     drive each of the 3 bubble renderers (SideEffect /
//     Elicitation / PlanReview) without needing a real CC session
//     + hook call. Clicking Allow / Deny in the bubble completes
//     the flow through `respond_permission` (the oneshot sender
//     we insert is dropped on the receive side, but
//     `respond_permission` still removes the entry from the store
//     cleanly).
//
// Bug fix (Q3 of the lib.rs split design): the synthetic fixture
// used to hardcode `AgentId("claude-code")` + `"Claude Code"` +
// `"claude-code"` in 3 places. That violates the "fixture is
// agent-agnostic" principle — the synthetic path is supposed to
// exercise the bubble's per-KIND render path, not bind to one
// specific adapter. The 3 hardcoded strings now derive from
// `agent::KNOWN_AGENTS[0]`, so the synthetic payload automatically
// tracks whichever agent ships first.

#[cfg(debug_assertions)]
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(debug_assertions)]
use crate::agent;
#[cfg(debug_assertions)]
use crate::events::prod;
#[cfg(debug_assertions)]
use crate::pending_store::{PendingEntry, PendingEntryView, PendingStore};

/// Snapshot the in-memory permission store for the dev panel's
/// initial render. `PendingStore::snapshot` returns the same
/// `PendingEntryView` list the panel expects.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn devtools_get_pending(
    store: State<'_, PendingStore>,
) -> Result<Vec<PendingEntryView>, String> {
    Ok(store.snapshot().await)
}

/// Inject a synthetic permission request of the given `kind`. `kind`
/// is one of "SideEffect" / "Elicitation" / "PlanReview".
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn devtools_fire_synthetic_permission(
    app: AppHandle,
    store: State<'_, PendingStore>,
    kind: String,
) -> Result<String, String> {
    use crate::agent::{
        Destination, ElicitationQuestion, PermissionBase, PermissionRequest,
        PermissionUpdateEntry, RuleBehavior, RuleSpec,
    };
    use serde_json::json;

    // The fixture is agent-agnostic — read agent id + display name
    // from the first registered agent rather than hardcoding
    // Claude Code. When a second adapter ships, this fixture
    // automatically uses whichever adapter ships first.
    let first_agent = agent::KNOWN_AGENTS
        .first()
        .ok_or_else(|| "no agents registered".to_string())?;
    let agent_id_str = first_agent.id().to_string();
    let agent_display_name = first_agent.display_name().to_string();

    let request_id = format!(
        "synth-perm-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let base = PermissionBase {
        request_id: request_id.clone(),
        session_id: "synth-session".into(),
        agent: agent::AgentId(agent_id_str.clone().into()),
        agent_display_name: agent_display_name.into(),
        cwd: Some("/tmp".into()),
    };

    let request = match kind.as_str() {
        "SideEffect" => PermissionRequest::SideEffect {
            base,
            tool_name: Some("Bash".into()),
            tool_input: Some(json!({
                "command": "rm -rf /tmp/synth-test",
                "description": "Synthetic SideEffect (dev panel test)"
            })),
            permission_suggestions: vec![PermissionUpdateEntry::AddRules {
                rules: vec![RuleSpec {
                    tool_name: "Bash".into(),
                    rule_content: Some("rm -rf /tmp/*".into()),
                }],
                behavior: RuleBehavior::Allow,
                destination: Destination::Session,
            }],
        },
        "Elicitation" => PermissionRequest::Elicitation {
            base,
            tool_name: "AskUserQuestion".into(),
            tool_input: Some(json!({
                "questions": [
                    { "question": "Which database?", "header": "DATABASE",
                      "multiSelect": false,
                      "options": [
                        { "label": "PostgreSQL", "description": "Relational, ACID, great for complex queries" },
                        { "label": "SQLite",    "description": "File-based, zero-config, great for small apps" },
                        { "label": "MongoDB",   "description": "Document store, flexible schema" }
                      ]
                    },
                    { "question": "Set up migrations?", "header": "MIGRATIONS",
                      "multiSelect": false,
                      "options": [
                        { "label": "Yes, use a migration tool", "description": "Add sqlx-cli or similar" },
                        { "label": "No, manual schema only",    "description": "I'll write SQL by hand" }
                      ]
                    }
                ]
            })),
            questions: vec![
                ElicitationQuestion {
                    question: "Which database?".into(),
                    header: "DATABASE".into(),
                    multi_select: false,
                    options: vec![
                        agent::ElicitationOption {
                            label: "PostgreSQL".into(),
                            description: "Relational, ACID, great for complex queries".into(),
                            preview: None,
                        },
                        agent::ElicitationOption {
                            label: "SQLite".into(),
                            description: "File-based, zero-config, great for small apps".into(),
                            preview: None,
                        },
                        agent::ElicitationOption {
                            label: "MongoDB".into(),
                            description: "Document store, flexible schema".into(),
                            preview: None,
                        },
                    ],
                },
                ElicitationQuestion {
                    question: "Set up migrations?".into(),
                    header: "MIGRATIONS".into(),
                    multi_select: false,
                    options: vec![
                        agent::ElicitationOption {
                            label: "Yes, use a migration tool".into(),
                            description: "Add sqlx-cli or similar".into(),
                            preview: None,
                        },
                        agent::ElicitationOption {
                            label: "No, manual schema only".into(),
                            description: "I'll write SQL by hand".into(),
                            preview: None,
                        },
                    ],
                },
            ],
        },
        "PlanReview" => PermissionRequest::PlanReview {
            base,
            tool_name: "ExitPlanMode".into(),
            tool_input: Some(json!({
                "plan": "# Implementation Plan\n\n1. Add a database abstraction layer\n2. Wire up migrations\n3. Update connection pooling\n4. Add integration tests"
            })),
            plan_content: Some(
                "# Implementation Plan\n\n1. Add a database abstraction layer\n2. Wire up migrations\n3. Update connection pooling\n4. Add integration tests".into(),
            ),
        },
        other => return Err(format!("unknown kind: {other}")),
    };

    // Insert into PendingStore with a oneshot. The rx is dropped
    // (no one listens) — that's fine, `respond_permission` removes
    // the entry from the store cleanly either way.
    //
    // Using `PendingStore::insert` (rather than opening the mutex
    // directly) gives us the devtools `PENDING_CHANGED` emit for
    // free — fixing the previous wart where the synthetic path
    // bypassed the emit.
    let (tx, _rx) = tokio::sync::oneshot::channel::<agent::PermissionDecision>();
    let entry = PendingEntry {
        tx,
        request: request.clone(),
        agent_id: agent_id_str.clone(),
    };
    store
        .insert(request_id.clone(), entry)
        .await
        .map_err(|_| "pending queue at capacity".to_string())?;

    let payload = serde_json::to_value(&request)
        .map_err(|e| format!("serialize synthetic request: {e}"))?;
    // The bubble window starts hidden. Make sure it's shown — the
    // HTTP path does this in handle_permission; the dev-tools
    // synthetic path bypasses HTTP, so we show it here.
    if let Err(err) = crate::http_server::show_bubble_window(&app) {
        eprintln!("[devtools] failed to show bubble window: {err}");
    }
    if let Some(bubble) = app.get_webview_window("permission-bubble") {
        match bubble.emit(prod::PERMISSION_REQUEST, payload.clone()) {
            Ok(()) => eprintln!(
                "[devtools] synthetic emitted to bubble webview (request_id={request_id})"
            ),
            Err(e) => eprintln!(
                "[devtools] synthetic emit to bubble FAILED: {e}"
            ),
        }
    } else {
        eprintln!("[devtools] synthetic permission-bubble webview NOT FOUND");
    }
    match app.emit(prod::PERMISSION_REQUEST, payload) {
        Ok(()) => eprintln!(
            "[devtools] synthetic emitted app-wide (request_id={request_id})"
        ),
        Err(e) => eprintln!("[devtools] synthetic app.emit FAILED: {e}"),
    }
    eprintln!(
        "[devtools] synthetic permission fired: kind={kind} request_id={request_id}"
    );
    Ok(request_id)
}