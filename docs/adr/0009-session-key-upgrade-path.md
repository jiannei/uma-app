# Session key upgrade path for multi-host support

CONTEXT.md describes a Session as uniquely identified by `(host, agentId, sessionId)`, but the implementation key (`SessionKey` in `display-state-types.ts`) is currently only 2 segments: `${agent}:${session_id}`. This ADR records the upgrade path for when webui (or any other remote-source) starts emitting events with a non-loopback `host` field, and the open product question about how subagent relationships behave across hosts.

## Status

proposed — 2026-06-24（grilling session）

## Context

Current `SessionKey` (`display-state-types.ts:69-70`):

```ts
/** Composite key replaces nested Map<AgentId, Map<SessionId, ...>>. */
export type SessionKey = `${string}:${string}`;
```

`sessionKeyOf` (`display-state-resolver.ts:73-76`):

```ts
function sessionKeyOf(event: HookEvent): SessionKey {
  const aid = event.agent || UNKNOWN_AGENT;
  return `${aid}:${event.session_id}`;
}
```

The CONTEXT.md tuple says 3 components, but the type and the function are 2. The third (`host`) is conceptually present in the domain model — a session is "an AI coding agent's single run on a specific host" — but the resolver hard-codes `'loopback'` as the only host it ever sees.

When webui (or any HTTP source other than a Tauri-local Claude Code) starts emitting `HookEvent`s, two things will need to change:

1. The event payload must carry a `host` field. Currently it doesn't.
2. The key, the map structure, and every consumer that reads `SessionKey` need to take the host into account.

This ADR captures the **destination** (what 3-segment key looks like) and the **unknowns** (cross-host subagent, what "host" semantically is) so the next person who picks up the multi-host work isn't starting from zero.

## Decision

### Key schema

When host becomes first-class, `SessionKey` upgrades to:

```ts
export type SessionKey = `${string}:${string}:${string}`;
//                                    ^host  ^agent ^session_id
```

`sessions` and `activeSubagents` stay **flat `Record<SessionKey, ...>`** — no nested map by host. The flat structure has worked well for the 2-segment case (ADR-0006 explicitly chose it over `Map<AgentId, Map<SessionId, ...>>`); adding a host segment to the key string is a smaller change than re-nesting.

`sessionKeyOf` becomes:

```ts
function sessionKeyOf(event: HookEvent & { host: string }): SessionKey {
  const host = event.host || 'loopback';
  const aid = event.agent || UNKNOWN_AGENT;
  return `${host}:${aid}:${event.session_id}`;
}
```

`host` defaults to `'loopback'` so existing single-source code paths don't need conditional logic — they just always pass through and the empty value gets the same default it always had.

### Wire format

`HookEvent` gains `host: Option<String>` (Rust) / `host?: string` (TS). Same `#[serde(default)]` pattern as `subagent` (ADR-0008). Existing single-source senders don't need to change — they just emit events without the field and the resolver treats them as `'loopback'`.

### Consumer changes (when host lands)

- `display-state-resolver.ts` — type changes above.
- `display-state-types.ts` — `SessionKey` template literal widens, `HookEvent` adds `host?`.
- `RobotRoot.vue` and any dev panel that displays `SessionKey` — display format becomes `host:agent:session_id` instead of `agent:session_id`.
- `SyntheticFirePanel.vue` (devtools) — form gains an optional `host` field (default `loopback`) so manual testing can target the new path.

### No migration

The resolver's `sessions` map is in-memory and resets on app restart. There is no persisted state to migrate. When host is added, the next session start populates the map with 3-segment keys from scratch.

## Open questions (to resolve when host lands)

### OQ1. What does `host` semantically mean?

Three plausible readings:

- **Physical machine name** — `host = hostname`. Two Claude Code instances on the same Mac via different terminals would collide.
- **Source identifier** — `host = "loopback"` for Tauri-local, `host = "webui"` for browser-driven. One host per source kind. Two terminals in two Tauri windows would still collide.
- **Fully-qualified session origin** — `host = "tauri-window-3"` or `host = "webui-tab-7"`. Per-launch identifier. Never collides.

The CONTEXT tuple's "a single run on a specific host" suggests reading 1 or 2. Reading 3 is the most defensive but pushes a UX/identity decision onto the user (where do host names come from?). **To resolve when webui spec is written — not blocking this ADR.**

### OQ2. Subagent cross-host behavior

CONTEXT.md says "其生命周期挂在父 session 内部". This is unambiguous when the agent and its subagents run in the same process — which is true for every currently-supported agent (Claude Code's Task tool spawns in-process). The question is: **if webui ever drives an agent on machine B that's a subagent of a session on machine A, does the subagent count toward the parent's `juggling` / `subagent-groove` / `building` aggregate?**

Three options:

- **(A) Subagent always counts toward parent**, even cross-host. Aggregate display state is a global view.
- **(B) Subagent only counts toward parent if same host**. Cross-host subagents are independent.
- **(C) Subagent always treated as independent session**. Parent's subagent count is always 0.

Currently, this is moot — Claude Code doesn't do cross-host subagents. But if webui ever does, this decision is product-shaped, not engineering-shaped. **Block on OQ1 first, then pick (A)/(B)/(C) based on what "host" means.**

### OQ3. Session lifecycle across hosts

When the app starts up, the resolver begins with empty `sessions`. If a previous app instance had sessions on host A, do we need to recover? **Currently no** — the resolver doesn't persist session state. If we add host, this question stays the same. The new question is: when the user runs `uma-app` on two different machines, do they expect to see each other's sessions? Almost certainly not — each Tauri instance is its own observer. So **no cross-host session sharing**. The host dimension in the key is for disambiguation within a single observer process, not for federation.

## Alternatives considered

- **Nested `Record<host, Record<SessionKey, ...>>`**: more structured but every aggregate (priority walk, subagent count, sleep triggers) would have to iterate the outer host dimension. The flat 3-segment key gives the same disambiguation at lower cost.
- **Per-host resolver instances**: doesn't help — there's no per-host state that wants to be isolated.
- **Host baked into `session_id` at the agent layer**: would force agents to generate unique session IDs across hosts. Leak of observer concerns into agent protocol.

## Verification (when this lands)

- `cargo check` and `bunx vue-tsc --noEmit` clean after the type widening.
- Manual: run Claude Code in a Tauri window, then run webui in a browser pointed at the same robot. Both should produce separate `host:agent:session_id` entries in the dev panel's session list.
- Cross-host subagent test (if/when a webui agent supports it): see OQ2 verdict.
