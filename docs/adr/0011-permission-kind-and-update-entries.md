# PermissionRequest 拆 3-kind + 引入 PermissionUpdateEntry，删除 always-allow 缓存

把 `PermissionRequest` 从扁平 struct 改为按 `kind` 区分的 discriminated union（`SideEffect` / `Elicitation` / `PlanReview`），对齐 Claude Code hook 协议层把 `permission_suggestions` 作为输入、`updatedPermissions` 作为输出的"permission 更新"机制。同时删除 `AlwaysAllowStore`——Claude Code 自己维护 `destination: "session"` 的规则并 short-circuit 后续请求，机器人侧不需要独立缓存。

## Status

accepted — 2026-06-25（grilling session）

## Context

两个问题：

1. **气泡 UI 不能表达结构化请求**。当前 `permission-bubble.html` 对所有 permission 请求一视同仁：渲染 `agent_label + tool_name + JSON.stringify(tool_input) + 3 个按钮`。这对待普通工具（Bash/Edit/Write）够用，但对 Claude Code 的两类结构化请求**信息完全丢失**：
   - `AskUserQuestion`：`tool_input.questions[]` 含 `[{ question, header, options: [{label, description}], multiSelect }]`——JSON dump 不可读
   - `ExitPlanMode`：`tool_input` 含 plan 内容——用户需要在气泡里写"哪里要改"的反馈，JSON dump 完全不能用

2. **always-allow 是冗余层**。当前 `AlwaysAllowStore` 是 `HashMap<(AgentId, SessionId), HashSet<ToolName>>`，在 HTTP server 入口命中就 short-circuit 回 `allow`。但 Claude Code 的官方 hook 协议已经提供完整机制：
   - 输入字段 `permission_suggestions[]` 把"用户通常在对话框里看到的 always-allow 选项"主动喂给 hook
   - 输出字段 `updatedPermissions[]` 是"把这条建议应用到 agent 自己的 permission 系统"的官方机制
   - `destination: "session"` 的规则在 CC 进程内存里维护；CC 在发 hook 前会自己 evaluate session 规则，命中直接放行不发 hook
   - 我们的 `AlwaysAllowStore` 是**绕过协议自己造了个简化版**——既丢失结构（`addRules` 的 `ruleContent` / `setMode` / `addDirectories` 等），又和 CC 的真实状态存在不一致风险

## Decision

### 1. 新增 canonical 类型：`PermissionUpdateEntry`

对齐 Claude Code `PermissionRequest` hook 文档的 `permission_suggestions` / `updatedPermissions` 共享 schema：

```
addRules | replaceRules | removeRules | setMode | addDirectories | removeDirectories
```

每个 entry 自带 `destination ∈ { session, localSettings, projectSettings, userSettings }`。

**v1 范围**：uma-app 不主动合成任何 entry。`permission_suggestions` 仅作为 `SideEffect` variant 的字段透传——用户挑选后整条 entry 通过 `updatedPermissions` 原样回写给 Claude Code。`destination: "session"` 由 CC 自己维护并 short-circuit 后续请求；其他 destination 由 CC 自己负责持久化（写到 `.claude/settings.json` 等）。

### 2. canonical 类型：`PermissionRequest` 改为 discriminated union

按 `kind` 区分三种语义不同的请求：

| Kind | 触发条件 | 决策形状 |
|---|---|---|
| `SideEffect` | 普通工具调用（Bash/Edit/Write/Read/Glob/Grep/Task 等） | `allow` / `deny` / `deny + message?` / `allow + updatedPermissions` |
| `Elicitation` | Claude Code `AskUserQuestion` | `allow + updatedInput.answers` |
| `PlanReview` | Claude Code `ExitPlanMode` | `allow` / `deny + message` |

Rust 端用 `#[serde(tag = "kind", rename_all = "PascalCase")]` 序列化；共享字段（`request_id` / `session_id` / `agent` / `agent_display_name` / `cwd`）通过 `#[serde(flatten)]` 嵌入 base struct。

分类规则是 adapter 私有不变量：Claude Code adapter 按 `tool_name` 分支（`AskUserQuestion` → `Elicitation`；`ExitPlanMode` → `PlanReview`；其他 → `SideEffect`）。`PermissionKind` 枚举本身是 canonical vocabulary 的成员，不绑定特定 agent。

### 3. 气泡 UI 按 kind 分发

- `SideEffect`：渲染 `permission_suggestions` 为 suggestion 按钮 + Allow / Deny 主按钮；不合成 entry
- `Elicitation`：渲染多题表单（每题 radio + "Other" + 进度 1/N + 上一题/下一题 + 提交）
- `PlanReview`：渲染 plan 摘要 + Approve / Reject + "Tell Claude what to change" 切换到 textarea

单气泡窗口替换（不堆叠）；Dismiss 发 `deny`（保守语义）。

### 4. 决策 wire format：扁平 + 可选字段，对齐 CC 协议

```rust
pub struct PermissionDecision {
    pub request_id: String,
    pub behavior: Behavior,  // Allow | Deny
    pub message: Option<String>,
    pub interrupt: Option<bool>,
    pub updated_input: Option<serde_json::Value>,
    pub updated_permissions: Option<Vec<PermissionUpdateEntry>>,
}
```

后端 `build_permission_response` 直接包 `{ hookSpecificOutput: { hookEventName, decision } }` envelope 转发。

### 5. 前端 UI 库：Reka UI（headless primitives）+ 现有 Catppuccin CSS 变量

气泡 / settings / devtools 共用一个 UI 库以保证长期视觉一致性。选 **Reka UI** 而非 shadcn-vue：

- **Reka UI**：headless primitives（a11y + 键盘导航 + ARIA roles），自带样式由我们用 Catppuccin CSS 变量写
- **不引 Tailwind**：shadcn-vue 强制 Tailwind utility classes，等于给项目加一套完整 utility-first 体系，与现有 scoped CSS 风格分叉
- **bundle 友好**：Reka UI tree-shake 按需引入，每个 primitive ~5-10KB；不引 Tailwind 省 ~50KB

**v1 迁移范围**：bubble + settings（`App.vue`）；devtools 保持手写，v2 再迁。Reka UI 实际用到的 primitive：RadioGroup / Textarea / Progress / ScrollArea / Switch / Dialog / Tooltip / Toggle / Card / Separator / Label——按需 `import` 即可。

### 6. uma-pet 复用策略：port 结构 + 数据，不 port vanilla JS 代码

uma-pet 的 bubble renderer 经过 0.6-0.9 多个 release 沉淀，结构 / 数据 / 边界情况处理 / 多语言字典都是可复用的。但 **vanilla JS 实现本身不直接复制**——uma-pet 用 vanilla JS 是因为它多 BrowserWindow 堆叠 + ephemeral + 无框架历史包袱；我们 v1 选单窗口替换 + Vue 3 + TS 栈，**复用它的结构 + 数据，不复用它的实现语言**。

具体复用：
- DOM 结构（`#card` / `#toolPill` / `#commandBlock` / `#elicitationForm` 等占位 div）
- `formatDetail`（按 tool_name 分支格式化 tool_input：Bash command / Edit file_path / Glob pattern）
- `suggestion label` 生成（`addRules` → "Always allow Bash in /dir/"、`setMode` → "Switch to plan mode"）
- `BUBBLE_STRINGS` 多语言字典（v1 只 en + zh）
- Elicitation 边界情况：Other textarea / ArrowUp 回到上一个 radio / 进度 1/N
- PlanReview "Tell Claude what to change" 切换模式

不复用：
- `innerHTML` 字符串拼接（用 Vue SFC `<template>` 替代）
- vanilla JS state management（用 Vue `ref` / `reactive`）
- Electron IPC 桥（用 Tauri event `permission-request`）

### 7. 删除项

- `AlwaysAllowStore`（`Arc<Mutex<HashMap<...>>>`）整个移除
- `clear_always_allow_session` Tauri command 移除
- HTTP server 的 always-allow 命中检查路径移除
- 气泡的 "Always" 按钮移除（v1 不合成 entry）
- "始终允许"产品语义从文档/CONTEXT.md 移除（见 ADR-0003 归档）

## Consequences

### 优点

- **气泡 UX 显著改善**：结构化请求按 kind 渲染，告别 JSON dump
- **协议层对齐**：1:1 映射 CC hook 协议，零翻译层
- **数据单一来源**：CC 维护 session 规则，我们只透传，无一致性风险
- **代码量净减少**：AlwaysAllowStore + 命中检查 + 合成逻辑全部删除
- **未来 agent 易接入**：`PermissionKind` 是 canonical vocabulary 成员；Codex/Kimi 等接入时各自的"用户输入收集"工具映射到 `Elicitation`，各自"plan 审批"工具映射到 `PlanReview`

### 代价

- 重写 `parse_permission_payload`（Claude Code adapter 按 kind 分支）
- 重写气泡 renderer：拆 3 个 .vue SFC（`SideEffectBubble.vue` / `ElicitationBubble.vue` / `PlanReviewBubble.vue`），用 Reka UI primitive 处理 a11y + 键盘导航
- `respond_permission` Tauri command 入参扩展为扁平 struct + 可选字段
- ADR-0003 归档为 SUPERSEDED
- `permission_suggestions` 字段不是所有 agent 都会有（Codex 等可能需要各自 schema）；v1 只服务 Claude Code，后续 agent 接入时扩展

### 范围外（明确不做）

- 不合成任何 entry（包括 `destination: "session"` 的 `addRules`）
- 不引入多通知渠道抽象（不接 `tauri-plugin-notification` / `notify-rust`）；v1 只用气泡窗口
- 不堆叠多气泡（继续单窗口替换）
- 不持久化 session 规则（由 CC 端 `destination: "session"` 保证）
- 不做 ruleContent 的正则/glob 匹配（按 CC 协议层语义只支持精确字符串匹配）