# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: "Clawd on Desk" — a Tauri desktop pet for AI coding agents

A transparent, always-on-top animated pet that lives on the user's desktop and reacts to events from Claude Code (or other agents) via HTTP webhooks. Includes a system tray, a settings window, and a permission-request "bubble" that pauses the agent until the user approves/denies.

## Tech stack

- **Shell / windows**: Tauri 2 (Rust) — three webview windows
- **Frontend**: Vue 3 (`<script setup>` SFCs) + TypeScript + Vite
- **Backend HTTP**: `axum` 0.7 over `tokio` (loopback only, port `17373`)
- **Persistence**: `tauri-plugin-store` (`settings.json` in app data dir)
- **Package manager**: bun (see `beforeDevCommand` / `beforeBuildCommand` in `src-tauri/tauri.conf.json`)

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

Override the hook server port by setting `UMA_PET_PORT` before launching Tauri (read by both `lib.rs` and `hook_installer.rs`; the installer uses this to write the correct URL into `~/.claude/settings.json`).

There is **no test suite** — no `cargo test` target, no Vitest config. Linting is `cargo clippy` for Rust and `vue-tsc --noEmit` (already part of `bun run build`) for TypeScript.

## Architecture

### Three webview windows (`src-tauri/tauri.conf.json`)

| label        | entry           | geometry  | behavior |
|--------------|-----------------|-----------|----------|
| `main`       | `index.html` → `src/main.ts` → `src/App.vue` | 800×600, hidden | Settings UI. Close button is intercepted and hides instead of exiting. |
| `pet`        | `pet.html`      | 200×200, transparent, always-on-top, no decorations | The animated mascot. Body is `pointer-events: none`; only a centered 144×144 `#hit-zone` is draggable. Supports edge-snap to right side → "mini mode" (160×160) with peek-on-hover. |
| `pet-bubble` | `pet-bubble.html` | 360×200, transparent, always-on-top, hidden by default | Permission request dialog. Shown only while a request is in flight; auto-hidden after response or 5-minute timeout. |

There is also a `pet-hit.html` file in repo root — a separate hit-zone window for drag testing. It is **not** registered in `tauri.conf.json`, so it is dead/legacy code. Don't extend it.

### Vite multi-page config

`vite.config.ts` declares three Rollup inputs — `main`, `pet`, `pet-bubble` — that map to the three HTML entry files. When adding a new HTML entry, register it here too.

### Backend layout (`src-tauri/src/`)

- **`lib.rs`** — Tauri entry point. Defines:
  - `Settings` struct (mirrors what's stored in plugin-store)
  - `SettingsStore`, `BubblePositionStore`, `PendingStore` shared state
  - `#[tauri::command]` handlers: `get_settings`, `set_theme`, `set_dnd`, `set_bubble_position`, `pet_permission_response`, `check_hook_installed`, `install_claude_hook`, `uninstall_claude_hook`
  - `setup` hook: loads persisted settings, registers a `CloseRequested` interceptor on the main window (prevents exit), spawns the HTTP server, installs the tray.
- **`http_server.rs`** — axum router bound to `127.0.0.1:17373`. Routes:
  - `GET /health`
  - `POST /state` — non-blocking; broadcasts `agent-hook-event` to all windows + emits to the `pet` window.
  - `POST /permission` — blocking (up to 5 min); inserts a `oneshot::Sender` into `PendingStore`, emits `permission-request` to the bubble window, awaits a response, then writes the Claude-Code-shaped `{hookSpecificOutput.decision.behavior}` JSON back. The "always" decision also adds the tool name to an in-memory always-allow set (lost on restart — intentional MVP scope).
  - Security: bound to loopback, no auth, length caps in DTO `validate()` methods, `MAX_PENDING_REQUESTS = 50` to cap the pending map.
- **`hook_installer.rs`** — reads/writes `~/.claude/settings.json`. Adds HTTP-hook entries under `hooks.<Event>` with URL prefix `http://127.0.0.1:`. Idempotent: `add_http_hook` skips if the URL is already present. Uninstall removes only entries whose URL starts with our prefix — leaves other hooks untouched and creates a `.json.bak` backup before writing.
- **`tray.rs`** — system tray with Theme submenu, DND / Sound check items, Mini / Settings / Quit items. Left click shows the menu; menu events mutate the shared `SettingsStore` and broadcast the corresponding Tauri event.

### Frontend layout (`src/`)

- **`App.vue`** — settings window. Loads from `plugin-store` on mount, also re-syncs from Rust via `get_settings`. Toggles write back to the store and (where relevant) invoke a Rust command. Theme / DND / bubble-position changes flow through Tauri commands; sound / auto-start bypass Rust and write to plugin-store directly.
- **`pet/state-machine.js`** — pure-JS class `StateMachine` that maps Claude Code event names → display states. Tracks per-session state, active subagent counts (Task/Agent tool invocations map to `juggling` / `subagent-groove` / `building`). `STATE_PRIORITY` resolves which state to show when multiple sessions are active (error > notification > attention > … > idle). Exposes `EVENT_TO_STATE`, `ALL_STATES`, `STATE_PRIORITY`, `SUBAGENT_TOOLS` for callers.
- **`pet/theme-manager.js`** — `ThemeManager` class. Themes are registered programmatically (in `pet.html`) — each theme is `{ name, states: { <displayState>: { file, type } } }`. The `displayHintMap` field in `theme.json` is **not** consumed by this manager (it's an artifact of a larger upstream theme spec that the current PoC ignores) — when adding a new theme here, define the `states` map inline in the `registerTheme(...)` call.
- **`pet.html`** — wires `ThemeManager` + `StateMachine` together, listens for `agent-hook-event` and `pet-theme-change` Tauri events, runs the drag/edge-snap/mini-mode logic, and triggers 10s-cooldown sound effects. Asset paths resolve to `themes/<themeId>/assets/...`.

### Themes

Lives under `themes/<id>/`:

- `theme.json` — full spec (viewBox, eyeTracking, workingTiers, miniMode, objectScale, fileOffsets, …). Most of these are unused by the current PoC but kept for spec compatibility.
- `assets/` — sprite files referenced by the manifest.

Two themes ship in-tree:

- **`clawd`** — pixel crab mascot, SVGs.
- **`calico`** — AI-generated APNG cat.

To add a new theme, create the directory + `assets/`, then register the state→file map in the `themeManager.registerTheme(...)` block inside `pet.html`, and add a `{ id, name, emoji }` entry in the `themes` array of `src/App.vue`.

### Tauri event names (Rust → JS)

| Event                | Emitted by                                   | Consumed by                              |
|----------------------|----------------------------------------------|------------------------------------------|
| `pet-theme-change`   | `set_theme` cmd, tray theme menu             | `pet.html` (ThemeManager), bubble        |
| `pet-dnd-change`     | `set_dnd` cmd, tray DND toggle               | `pet.html` (pauses sounds)               |
| `pet-toggle-mini`    | tray "Mini Mode" item                        | `pet.html` (resize/edge-snap)            |
| `agent-hook-event`   | `POST /state` handler                        | `pet.html` (StateMachine)                |
| `permission-request` | `POST /permission` handler                   | `pet-bubble.html`                        |
| `tauri://move`       | built-in (window moved)                      | `pet.html` (post-drag edge-snap check)   |

JS → Rust: bubble calls `invoke('pet_permission_response', { decision: { request_id, decision, reason } })`. App.vue calls the various `*_claude_hook` / `set_*` commands.

### Legacy / unused files

- `hooks/claude-hook.js` — a standalone Node script that posts to `http://127.0.0.1:17373/hook/event`. The current HTTP server exposes `/state` and `/permission` (no `/hook/event`), and `hook_installer.rs` installs direct HTTP-hook entries into `~/.claude/settings.json` rather than referencing this script. This file is a leftover from an earlier hook design and is not invoked anywhere in the current flow.
- `pet-hit.html` — separate hit-zone window registered nowhere. Debug-only artifact.

### `~/.claude/settings.json` ownership

`hook_installer.rs` is the only thing that mutates the user's `hooks` block. Uninstall is scoped to entries matching the `http://127.0.0.1:` URL prefix, so re-running install is safe and uninstall leaves any other hooks the user has configured alone. A `.json.bak` is written before each save.

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
