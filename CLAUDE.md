# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: "Uma on Desk" — a Tauri desktop robot for AI coding agents

A transparent, always-on-top animated robot that lives on the user's desktop and reacts to events from Claude Code (or other agents) via HTTP webhooks. Includes a system tray, a settings window, and a permission-request "bubble" that pauses the agent until the user approves/denies.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels, default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Tech stack

- **Shell / windows**: Tauri 2 (Rust) — three webview windows
- **Frontend**: Vue 3 (`<script setup>` SFCs) + TypeScript + Vite
- **Backend HTTP**: `axum` 0.7 over `tokio` (loopback only, port `17373`)
- **Persistence**: `tauri-plugin-store` (`settings.json` in app data dir)
- **Package manager**: bun (see `beforeDevCommand` / `beforeBuildCommand` in `src-tauri/tauri.conf.json`)
- **Structural search**: `mcp__codegraph__*` (29 files indexed) — 回答"X 是怎么工作的"这类问题时，优先使用 `codegraph_context` / `codegraph_trace`，而不是 grep + read 循环。

## Build / dev / run commands

Frontend (Vite) — bun is the package manager:

```
bun install
bun run dev              # vite dev server on :1420 (feeds Tauri)
bun run build            # vue-tsc type-check + vite build → dist/
bun run preview          # serve dist/ for local browser preview
bun run tauri dev        # launch full Tauri app in dev (runs vite + cargo)
bun run tauri build      # build a release bundle
```

Rust (only run via the `tauri` script — don't invoke `cargo run` directly because the frontend dist must exist or vite must be running):

```
cd src-tauri && cargo check
cd src-tauri && cargo clippy
```

Override the hook server port by setting `UMA_PET_PORT` before launching Tauri (read by both `lib.rs` and `adapters/claude_code.rs`; the installer uses this to write the correct URL into `~/.claude/settings.json`).

There is **no test suite** — no `cargo test` target, no Vitest config. Linting is `cargo clippy` for Rust and `vue-tsc --noEmit` (already part of `bun run build`) for TypeScript.

## Architecture

### Three webview windows (`src-tauri/tauri.conf.json`)

| label        | entry           | geometry  | behavior |
|--------------|-----------------|-----------|----------|
| `main`       | `index.html` → `src/main.ts` → `src/App.vue` | 800×600, hidden | Settings UI. Close button is intercepted and hides instead of exiting. |
| `robot` | `robot.html` | 200×200, transparent, always-on-top, no decorations | The animated mascot. Body is `pointer-events: none`; only a centered 144×144 `#hit-zone` is draggable. Supports edge-snap to right side → "mini mode" (160×160) with peek-on-hover. |
| `permission-bubble` | `permission-bubble.html` | 360×200, transparent, always-on-top, hidden by default | Permission request dialog. Shown only while a request is in flight; auto-hidden after response or 5-minute timeout. |

### Vite multi-page config

`vite.config.ts` declares four Rollup inputs — `main`, `robot`, `permission-bubble`, `devtools` — that map to the HTML entry files. When adding a new HTML entry, register it here too.

### Backend layout (`src-tauri/src/`)

- **`lib.rs`** — Tauri entry point. Defines:
  - `Settings` struct (mirrors what's stored in plugin-store — does NOT include per-agent install state; read that from `list_agents` instead)
  - `SettingsStore`, `BubblePositionStore`, `PendingStore`, `AlwaysAllowStore` shared state
  - `#[tauri::command]` handlers: `get_settings`, `set_theme`, `set_dnd`, `set_bubble_position`, `respond_permission`, `list_agents`, `check_agent_installed`, `install_agent_hook`, `uninstall_agent_hook`, `clear_always_allow_session`
  - `setup` hook: loads persisted settings, registers a `CloseRequested` interceptor on the main window (prevents exit), spawns the HTTP server, installs the tray.
- **`agent.rs`** — defines the `Agent` trait (id / display_name / config_path / install / uninstall / parse_state_payload / parse_permission_payload / build_permission_response) and the `KNOWN_AGENTS` compile-time registry. State machine and HTTP server only deal with the canonical `HookEvent` / `PermissionRequest` types — they never touch agent-specific DTOs. See [CONTEXT.md](./CONTEXT.md) and [ADR-0002](./docs/adr/0002-in-process-agent-adapter.md).
- **`adapters/`** — one module per supported agent. `adapters/claude_code.rs` holds all Claude-Code-specific DTOs (`ClaudeCodeHookPayload`, `ClaudeCodePermissionPayload`), validation, the `translate_event` function that maps Claude Code's event names to the canonical 8-event vocabulary, and the `Agent` trait impl. Adding a new agent = new file under `adapters/` + one line in `KNOWN_AGENTS`.
- **`http_server.rs`** — axum router bound to `127.0.0.1:17373`. Routes:
  - `GET /health`
  - `POST /agents/{id}/state` — non-blocking; looks up the agent by `:id`, calls `adapter.parse_state_payload`, broadcasts `agent-hook-event` to all windows + emits to the `robot` window. Unknown agent id → 404.
  - `POST /agents/{id}/permission` — blocking (up to 5 min); inserts a `oneshot::Sender` into `PendingStore`, emits `permission-request` (with the canonical `PermissionRequest` payload, including `agent` and `agent_display_name`) to the bubble window, awaits a response, then writes the agent-specific permission response (e.g. Claude Code's `{hookSpecificOutput.decision.behavior}`) back. The "always" decision adds the tool to the per-(agent, session) `AlwaysAllowStore`, drained automatically on `SessionEnd` (see [ADR-0003](./docs/adr/0003-always-allow-scope.md)).
  - Security: bound to loopback, no auth, length caps in each adapter's `validate()` method, `MAX_PENDING_REQUESTS = 50` to cap the pending map.
- **`tray.rs`** — system tray with Theme submenu, DND / Sound check items, Mini / Settings / Quit items. Left click shows the menu; menu events mutate the shared `SettingsStore` and broadcast the corresponding Tauri event.

### Frontend layout (`src/`)

- **`App.vue`** — settings window. Loads from `plugin-store` on mount, also re-syncs from Rust via `get_settings`. Calls `list_agents` and renders one card per known agent with its `display_name`, `config_path`, install/uninstall button, and current `is_installed` state. Toggles write back to the store and (where relevant) invoke a Rust command. Theme / DND / bubble-position changes flow through Tauri commands; sound / auto-start bypass Rust and write to plugin-store directly.
- **`robot/display-state-resolver.ts`** — XState v5 machine definition for the DisplayStateResolver. Consumes the **canonical 8-event vocabulary** (`SessionStart` / `SessionEnd` / `UserPromptSubmit` / `ToolCallStart` / `ToolCallEnd` / `AgentTurnEnd` / `Notification` / `PermissionRequest`) and resolves them to display states. Tracks sessions in context via flat `Record<\`${aid}:${sid}\`, SessionEntry>` (replaces the old nested `Map<AgentId, Map<SessionId, SessionEntry>>` from B1). Sleep sequence (`idle → yawning → dozing → collapsing → sleeping`) and one-shot auto-return (attention / error / notification) are first-class transitions driven by `theme.timings` via `setup({ delays })`; in-flight timers freeze their delay value (XState v5 evaluates at state-entry). See [ADR-0006](./docs/adr/0006-adopt-xstate-for-display-state-resolver.md).
- **`robot/display-state-types.ts`** — shared types: `HookEvent`, `SessionEntry`, `SessionKey`, `DisplayState`, `ThemeManifest`, `ThemeTimings`, `MachineSnapshot`, `PermissionRequest`, `StateChangeEvent`. Replaces the old ambient `state-machine.d.ts`.
- **`robot/display-state-constants.ts`** — runtime constants (`ALL_STATES`, `SUBAGENT_TOOLS`, `CANONICAL_EVENTS`, `UNKNOWN_AGENT`, `DEFAULT_THEME`). Single source of truth — replaces hand-rolled duplicates in SyntheticFirePanel and theme-manager's `DEFAULT_STATES`.
- **`robot/RobotRoot.vue`** — Vue SFC hosting the entire robot runtime (theme manager, sprite, sound, drag, mini mode, Tauri event listeners, XState subscription via `useMachine`). Replaces ~250 lines of inline `<script>` that previously lived in `robot.html`.
- **`robot/theme-manager.js`** — `ThemeManager` class. Themes are registered programmatically (in `RobotRoot.vue`) — each theme is `{ name, states: { <displayState>: { file, type } } }`. The `displayHintMap` field in `theme.json` is **not** consumed by this manager (it's an artifact of a larger upstream theme spec that the current PoC ignores) — when adding a new theme here, define the `states` map inline in the `registerTheme(...)` call.
- **`robot.html`** — thin Vue shell: robot DOM (`#hit-zone` + `#robot-container` + `<img>` + `<object>`) + `createApp(RobotRoot).mount('#app')`. All runtime logic moved to `RobotRoot.vue`.

### Themes

Lives under `themes/<id>/`:

- `theme.json` — full spec (viewBox, eyeTracking, workingTiers, miniMode, objectScale, fileOffsets, …). Most of these are unused by the current PoC but kept for spec compatibility.
- `assets/` — sprite files referenced by the manifest.

Two themes ship in-tree:

- **`uma`** — pixel crab mascot, SVGs.
- **`calico`** — AI-generated APNG cat.

To add a new theme, create the directory + `assets/`, then register the state→file map in the `themeManager.registerTheme(...)` block inside `robot.html`, and add a `{ id, name, emoji }` entry in the `themes` array of `src/App.vue`.

### Tauri event names (Rust → JS)

| Event                | Emitted by                                                | Consumed by                              |
|----------------------|-----------------------------------------------------------|------------------------------------------|
| `theme-change`   | `set_theme` cmd, tray theme menu                          | `robot.html` (ThemeManager), bubble        |
| `dnd-change`     | `set_dnd` cmd, tray DND toggle                            | `robot.html` (pauses sounds)               |
| `toggle-mini`    | tray "Mini Mode" item                                     | `robot.html` (resize/edge-snap)            |
| `agent-hook-event`   | `POST /agents/{id}/state` handler (canonical `HookEvent`) | `robot.html` (StateMachine)                |
| `permission-request` | `POST /agents/{id}/permission` handler (canonical `PermissionRequest`) | `permission-bubble.html`                        |
| `tauri://move`       | built-in (window moved)                                   | `robot.html` (post-drag edge-snap check)   |

JS → Rust: bubble calls `invoke('respond_permission', { decision: { request_id, decision, reason } })`. App.vue calls the `set_*` commands for user preferences and the `*_agent_hook` / `list_agents` commands for agent management. The robot window invokes `clear_always_allow_session` on `SessionEnd` to drain the in-memory allow set.

### "始终允许" 仅在 (agent, session) 范围内有效

权限气泡里的"始终允许"会把工具名加进 `AlwaysAllowStore`（内存的 `HashMap<(agent_id, session_id), HashSet<tool_name>>`）。同 agent 的同一 session 内重复调用同一工具会被自动放行；session 关闭时由 `robot.html` 监听 `SessionEnd` 调用 `clear_always_allow_session` 清空。**不会**持久化到 `settings.json`，应用重启后会清空。这是 MVP 范围内有意为之 —— 如果用户重启后又看到弹窗，或者关闭重开同一个 session 又被问，是预期行为，不是 bug。详见 [ADR-0003](./docs/adr/0003-always-allow-scope.md)。

### `~/.claude/settings.json` ownership

`adapters/claude_code.rs` is the only thing that mutates the user's `hooks` block for Claude Code. Uninstall is scoped to entries matching the `http://127.0.0.1:` URL prefix (more precisely, `http://127.0.0.1:{port}/agents/claude-code/...`), so re-running install is safe and uninstall leaves any other hooks the user has configured alone. A `.json.bak` is written before each save.

---

# Behavioral guidelines (Karpathy-inspired)

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
