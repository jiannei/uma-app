# Canonical hook event vocabulary (8 events)

宠物内部用 8 个 canonical 事件名（`SessionStart` / `SessionEnd` / `UserPromptSubmit` / `ToolCallStart` / `ToolCallEnd` / `AgentTurnEnd` / `Notification` / `PermissionRequest`）表达 agent 端发来的状态变化事实，所有 `Agent` adapter 必须把自己的原始事件翻成这 8 个之一，状态机只看 canonical 形式。

## Status

accepted — 2026-06-24（grilling session）

## Context

未来支持多 agent（Codex、Gemini、Kiro 等），各 agent 的事件词汇差异显著：Claude Code 用 `PreToolUse` / `PostToolUse`（camelCase），Codex 用 `pre_tool_use` / `post_tool_use`（snake_case），Gemini 用 `BeforeAgent` / `AfterTool`（不同命名），Kiro 用 `preToolUse` / `postToolUse`（小写开头）。如果状态机直接吃原始事件，要么按 agentId 分叉（每个 agent 一份 `EVENT_TO_STATE`），要么用某个 agent 的事件名做 canonical（"以谁的词汇为准"是历史偶然，不是技术选择）。

## Decision

定义 8 个 canonical 事件（见 [CONTEXT.md](../../CONTEXT.md) 的 `HookEvent` 词条）。关键设计选择：

- **`PostToolUse` + `PostToolUseFailure` 合并为 `ToolCallEnd(success: bool, error?)`** —— 一个事件两种结果。理由：Gemini 只有一个 `AfterTool` 配 success 字段，合并后跨 agent 一致。
- **subagent 不进 canonical** —— Claude Code 的 subagent 是通过 Task 工具识别（不是 native 事件），把它做成 canonical 等于把 Claude Code 的实现细节提升为协议。状态机继续把 `Task` 工具的 `ToolCallStart` / `ToolCallEnd` 视为 subagent 计数信号。
- **`UserPromptSubmit` 不分两个事件** —— 一些 agent 把"用户提交"和"agent 开始思考"拆成两个事件，adapter 折叠成一个。
- **`Stop` 改名为 `AgentTurnEnd`** —— `Stop` 是 Claude Code 内部词汇（stop hook 触发），其他 agent 不一定用这个名字。`AgentTurnEnd` 直指用户心理模型。

## Considered Options

- **Option 1：Claude Code 的词汇 = canonical**。今天 0 改动，但"以谁为准"答案不是技术性的；将来想换 canonical 要重做。
- **Option 3：状态机里 per-agent 维护**。不做语义对齐，状态机被 agent 维度打散。
- 选了 Option 2：自定 canonical 词汇，与任何具体 agent 解耦。

## Consequences

- 状态机 `EVENT_TO_STATE` 需要重写（从 11 个 Claude Code 事件 → 8 个 canonical 事件名）。
- Claude Code adapter 几乎变成 passthrough（事件名已经是 camelCase，但 `Stop` → `AgentTurnEnd` 需要翻译；`PostToolUse` / `PostToolUseFailure` 合并需要翻译）。
- 每个新 agent 的 adapter 都得加翻译层 —— 但这是一次性成本，新加 agent 时反而简单（对照 canonical 词汇翻译即可）。
- canonical 词汇本身变成"产品 API 表面"，未来调整（比如 `AgentTurnEnd` 改 `AgentTurnPause`）会波及所有 adapter，更名要慎重。
