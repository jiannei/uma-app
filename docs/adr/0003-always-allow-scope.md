# "始终允许" 的 scope 是 per (agent, session, tool)，in-memory only

权限气泡里"始终允许"按钮的语义是：**对于该 agent 的该 session 的该工具名，所有调用自动放行**；规则**仅存于 pet 进程内存**，`HashMap<(AgentId, SessionId), HashSet<ToolName>>`，应用退出即清空。MVP 范围内有意不持久化到 `settings.json`。

## Status

accepted — 2026-06-24（grilling session）

## Context

当前 `http_server.rs` 的 `always_allow: Arc<Mutex<HashSet<String>>>` 是**全局 + 仅工具名 + 进程内存**的简化实现。多 agent 时代这个语义不够用：Claude Code 的 `Bash` 和 Codex 的 `bash` 语义不同，不该共享；同一 agent 的两个不同 session 也不该互相污染。MVP 用户体验需要"少打扰"（已信任的工具不要再弹窗），但又不能跨 agent 串味、不能跨重启复活（用户重启后看到弹窗是预期行为，不是 bug）。

## Decision

Scope = (agent, session, tool)，in-memory only。

- **数据结构**：`HashMap<(AgentId, SessionId), HashSet<ToolName>>`，按 session 关闭时清空该 session 的子集
- **生命周期**：进程内有效；pet 重启后清空（与 MVP 范围一致）
- **不持久化**：故意不写入 `settings.json`，避免跟 Claude Code / Codex 自己的 permission 系统产生认知冲突

## Considered Options

- **A. 工具名 × app 生命周期**（当前实现）—— 简单但跨 agent / 跨 session 串味，Claude Code 窗口的"始终允许 Bash"会影响 Codex 的 `bash`
- **C. 工具名 + 工具输入指纹 × session** —— 太严，每次 `npm install` 都要点；工具指纹是启发式的、跨版本不稳定
- **D. 工具名 × 用户 × 持久** —— 写到 `settings.json`，跨重启所有 session 共享。跟 Claude Code / Codex 自己的 permission 系统行为重叠，且与"重启后看到弹窗是预期"的 MVP 取舍冲突
- 选了 B。

## Consequences

- session 关闭时必须清理该 session 的 allow 子集，否则内存泄漏。session 生命周期的判定接 `SessionEnd` canonical 事件。
- bubble UI 的"始终允许"按钮文案可以保持不变（用户心智模型不需要因为多 agent 变化），但**底层数据结构必须改**。
- MVP 阶段不暴露"清空所有 always allow"的设置入口；如果未来需要，加在 settings 窗口里。
- 如果未来要支持持久化（D 选项），这是 UX 升级，不应该悄悄改 —— 走新的 ADR 流程。
