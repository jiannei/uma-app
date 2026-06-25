# Subagent semantic moves from canonical resolver to per-adapter flag

`HookEvent` gains a `subagent: bool` field that the agent adapter sets when it recognises the tool call as a subagent spawn. The canonical resolver reads the flag instead of consulting agent-specific tool names. The constant `SUBAGENT_TOOLS` (previously in `display-state-constants.ts`) is removed.

## Status

accepted — 2026-06-24（grilling session）

## Context

Before this change, the resolver detected a subagent-spawning tool by checking a hardcoded set in the canonical layer:

```ts
// src/robot/display-state-constants.ts
export const SUBAGENT_TOOLS: ReadonlySet<string> = new Set([
  'Task', 'Agent', 'task',
]);
```

The resolver used `SUBAGENT_TOOLS.has(event.tool_name)` in four places (`computeIngestUpdate`, `isSubagentToolStart` guard, `isSubagentToolEnd` guard, `hasTwoOrMoreSubs` guard).

**This violates ADR-0002 / CONTEXT.md ("Agent" / "HookEvent"):**

> 状态机只看到已归一化的 `HookEvent`,不感知具体 agent 的事件词汇。

`Task` / `Agent` / `task` are Claude Code-specific tool names. They leaked into the canonical resolver. Adding a second agent (e.g. Codex) would have forced the resolver to either grow the set with that agent's tool names (more leak) or carry per-agent knowledge in the canonical layer (architectural rot).

## Decision

**`HookEvent` gets a `subagent: Option<bool>` field (Rust) / `subagent?: boolean` (TS).** The Claude Code adapter sets it on the wire:

- `PreToolUse` (→ `ToolCallStart`): `subagent = is_subagent_tool(tool_name)`
- `PostToolUse` / `PostToolUseFailure` (→ `ToolCallEnd`): same
- All other event types: `subagent = None` (omitted on the wire)

`is_subagent_tool` lives in the adapter:

```rust
// src-tauri/src/adapters/claude_code.rs
const SUBAGENT_TOOL_NAMES: &[&str] = &["Task", "Agent", "task"];

fn is_subagent_tool(tool_name: Option<&str>) -> bool {
    match tool_name {
        Some(name) => SUBAGENT_TOOL_NAMES.contains(&name),
        None => false,
    }
}
```

The resolver's four `SUBAGENT_TOOLS.has(...)` call sites collapse to `event.subagent === true`. `SUBAGENT_TOOLS` is deleted from `display-state-constants.ts`.

The dev panel (`SyntheticFirePanel.vue`) gets a `subagent` checkbox on `ToolCallStart` / `ToolCallEnd` rows so manual testing still drives the juggling / groove / building states.

## Consequences

**正面：**
- `display-state-constants.ts` 不再含 agent 词汇,真正成为 canonical 层。
- 加 Codex / 其它 agent 时,新 adapter 自己 `is_subagent_tool`,resolver 一行不动。
- Resolver 的 guard 从"先查 tool_name 字符串集合"降级为"读 boolean 字段",计算成本几乎为零(可哈希,可位运算)。
- Wire format 单字段: `subagent: true` / `subagent: false` / 字段缺失(老发送方兼容)。

**负面 / 权衡：**
- HookEvent 的字段集多了一个,doc / 调试输出更宽一点。eprintln! 在 http_server.rs 加了一行 subagent 输出用于调试。
- Rust 端 `translate_event` 没改签名——它还是 `(String, Option<bool>, Option<String>)`。`parse_state_payload` 单独算 subagent 字段(根据 `event_type` 和 `payload.tool_name`)。理由: `translate_event` 只翻译 event 名,subagent 决策需要 payload.tool_name,在调用 `translate_event` 之后做更干净。

**有意不做的：**
- **不把 subagent 抽成 enum**。`bool` 足够,claude-code 只有"派生 vs 不派生"两态。如果以后有"派生类型"(explore / plan / general-purpose),可以升级为 `subagent_kind: Option<&'static str>`,但当前 YAGNI。
- **不保留 `SUBAGENT_TOOLS` 字符串集合在前端**。它在 canonical 层没用了——Claude Code 的工具名变化时,前端不需要任何改动,只要重启 Rust 端(其实是 `cargo build` 之后重启 Tauri dev)。

## Alternatives considered

- **(a) Adapter reports enum / subagent_kind:** 表达力更强,但当前阶段 YAGNI。
- **(b) Agent 注册时声明 subagent 工具名:** 增加一层 registry 桥(Rust KNOWN_AGENTS → 前端常量),但前端不需要这个——前端只读 bool。b 是 over-engineering for a single bool。
- **(c) 保留 SUBAGENT_TOOLS 当前形态,加注释:** 0 改 resolver,但架构违例持续存在。下个加新 agent 的人会再撞同样的墙。
- **(d) HookEvent.subagent: bool — 选定。** 最小改动,把决策点下沉到唯一有资格做决策的层(adapter),canonical 层不掺和 agent 词汇。

## Verification

- `cargo check` 在 src-tauri 干净。
- `bunx vue-tsc --noEmit` 干净。
- 端到端手动测试:
  1. `bun run tauri dev`
  2. 在 Claude Code 里调一次 `Task` 工具 → resolver 路径:`ToolCallStart` + `subagent: true` → 期望进 `subagentGroove`(单 subagent)。
  3. 同时再调一个 `Task` → 第二个 `ToolCallStart` + `subagent: true` → 期望进 `juggling`(≥2)。
  4. 关闭一个 → 期望回到 `building`(还剩 1)。
  5. 关闭最后一个 → 期望回到 `working`。
  6. dev panel:在 SyntheticFirePanel 选 `ToolCallStart` + 勾上 `subagent` 复选框 → 期望同样进 `subagentGroove`。
