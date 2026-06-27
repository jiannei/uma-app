# Bubble 优化迭代 — 浮岛 + spring + 4 kind 视觉 token

`docs/adr/0014-tray-anchored-popover-bubble.md` 把权限气泡设计为 "tray-anchored popover + 1 队列头 + 4 固定 size"。本 ADR 记录 **2026-06-26 第二次 grilling session** 的优化迭代：把容器从 webview-sized 改成 content-sized 浮岛、补回 ADR-0013 阶段被撤回的几个安全/反馈机制、补 4 kind 视觉一致性。

## Status

accepted — extends ADR-0014 (2026-06-26，grilling session)

## Context

ADR-0014 决策 1-13 在 2026-06-26 那次 grilling 简化后落地到 `feat/bubble` 分支（commit df6c97f 起）。落地后用户跑了一段时间发现：

1. **webview-sized 容器（ADR-0014 决策 1 "整个 webview 是大圆角矩形"）**：弹窗 280×600pt 永久占位 = 屏幕上方一大块半透明黑；不像 "popover from tray" 而像 "半截窗口"
2. **撤回过度**：决策 6（PlanReview 滚到底才解锁）+ 决策 13.4（5min 超时 alarm 反馈）当时都被简化撤回；用户用后认为"撤回太多"
3. **queue 深度对用户隐形**：决策 3 的 tray 角标被位置去耦后撤销；现在 N=5 时用户看不到"还有几条"
4. **agent + session 来源缺失**：多 agent / 多 session 场景下，pill 只显示 tool_name + summary，agent identity 完全在 wire format 里没用上

这次 grilling 在 ADR-0014 已落地的代码基础上找出**第三条路**：

- **架构层**：window 永远 max=600pt + content 用 motion-v spring 动画高度 → iOS Dynamic Island 真正架构化（不只是视觉）
- **交互层**：补回 4 个撤回的安全/反馈机制（PlanReview scroll unlock + alarm overlay + chevron queue depth + agent chip in expanded）
- **视觉层**：在 `src/styles/bubble.css` 加 `:root` + `.dark` 双套 token；hairline border 解决 dark-on-dark / white-on-white 可见性

## Decision

### 1. 架构：content-sized 浮岛（推翻 ADR-0014 决策 1 部分）

| 项 | ADR-0014 | 本 ADR |
|---|---|---|
| Window 大小 | webview-sized = 280×600pt 永久 | **永远 max** = 280×600pt |
| Content 大小 | webview-sized (填充整个 webview) | **content-sized**（80pt pill / 多屏扩展）|
| 高度动画 | Rust `set_bubble_size` IPC 调用 + 即时 resize | **motion-v spring**（stiffness 280 / damping 24 / mass 1）|
| 视觉隐喻 | "window 是 bubble" | "window 是 container，content 是 bubble" ≈ iOS Dynamic Island |

**实施**：在 `src/bubble/BubbleApp.vue` 把 `.bubble-root` 设为 webview-sized 透明 + `pointer-events: none`；新增 `.bubble-content` 是 content-sized + 有 background + `pointer-events: auto`；用 motion-v `<motion.div>` 包裹并动画高度。

### 2. Rust 端：删除 `set_bubble_size` IPC

不再需要从 JS 端 IPC 改 window size。`src-tauri/src/lib.rs`：
- 删除 `set_bubble_size` Tauri command
- 删除 `invoke_handler` 注册
- window `inner_size(280.0, 80.0)` → `inner_size(280.0, 600.0)`（永远 max）

### 3. 决策模型补回 4 个机制

#### 3.1 chevron `› N` 队列深度感知（B.1 + B.2 α + A.3 i）

撤回 ADR-0014 决策 3（tray icon 角标）时没有替代方案。本 ADR 在 pill 右侧 ✗ 按钮紧跟 `› N` chevron：

- 仅当 `queue.length > 1` 时显示
- 点击 → `submitDecision("deny", {})` 当前 + advance（FIFO by arrival time，**不**挑肥拣瘦）
- 视觉：12pt `›` + 11pt 数字，muted → foreground hover + background tint + scale 0.95 active

#### 3.2 SideEffect expand 死路修复（B.3 iv + B.4 + A.8 i）

撤回 ADR-0014 决策 11 "不做工具风险分级"。本 ADR 把 expand 变成**信息密度**而非决策重：

- pill 右侧 affordance icon 改 `Info`（不是 chevron）
- SideEffectBubble 重写为 4 个 tool-aware renderer + JSON fallback：
  - **Bash**：`Terminal` icon + mono 命令块（路径用 `text-foreground/90` 高亮）
  - **Edit/MultiEdit**：`Pencil` + file_path + `+N -M lines` caption
  - **Write**：`FilePen` + file_path + `N chars` caption
  - **Read**：`Eye` + file_path + `lines N-M` caption（无 preview，wire format 不含文件内容）
  - **其他**：`Info` + `JSON.stringify(input, null, 2)`

#### 3.3 PlanReview 滚到底才解锁 Approve（B.7 iv + A.5 a）

撤回 ADR-0014 决策 6（撤回太彻底）。本 ADR 重新启用并增强：

- plan < 一屏 → 始终 canApprove
- plan ≥ 一屏 → canApprove = `scrollProgress >= 0.99`
- 进度条 2pt sticky 在 plan 区域底部；完成时变 `--bubble-allow` 绿
- 用户点 ✓ 太早（!canApprove）→ `scrollToBottom()` 强制滚到底，下一次点击再 approve

#### 3.4 5min 超时 alarm 闪烁（B.8 iii + A.6 i）

撤回 ADR-0014 决策 13.4（撤回太彻底）。本 ADR 重新启用并改为 overlay pill：

- 新组件 `src/bubble/AlarmBanner.vue`：`position: absolute; inset: 0` 覆盖 pill 区域
- `AlarmClock` icon 14pt，ease-in-out 闪烁 0.4s × 4 = 1.6s
- 之后 fade-out 200ms → advance queue
- 1.6s 内 pill 不响应点击（`pointer-events: auto` 在 banner 上）

### 4. agent + session 在 expanded view 头部（B.9 iii + A.7 i）

撤回 ADR-0014 决策 3 时没考虑 multi-agent。本 ADR 加 `ExpandedHeader`：

- 新组件 `src/bubble/ExpandedHeader.vue`：24pt 横条
- 仅在 expanded 时显示（在 expanded-section 顶部，pill 下方，expanded content 上方）
- 内容：`[AgentIcon] agentDisplayName · <session 前 4 字符>`
- AgentIcon 映射（`src/bubble/agent-icons.ts`）：
  - `claude-code` → `Sparkles`（Anthropic 视觉）
  - `cursor` → `MousePointer2`（Cursor 品牌）
  - 其他 → `Cpu`（fallback）

### 5. Elicitation 进度 dots（B.5 ii + B.6 ii.b + A.4 a）

撤回 ADR-0014 决策 8（撤回时引入"v1 简化"）。本 ADR 用更简单的顶部 progress bar：

- ElicitationBubble 顶部加 `Q3 / 5  ● ● ● ○ ○`
- 3 态视觉（per A.4 a 中性 token）：
  - **current**：`--bubble-text` filled 8pt
  - **answered**：`--bubble-text-muted` filled 6pt
  - **pending**：`--bubble-text-muted` hollow 6pt
- dot 可点跳转（hover scale 1.25）
- 不引入"已答折叠 + 剩余预览"复杂状态机（撤回 ADR-0014 决策 8 的撤回再撤回）

### 6. CSS token 集中化（A.2 ii）

撤回 ADR-0014 决策 12.3/12.4（token 散在每个 Vue 文件 `var(...)` fallback）。本 ADR 集中到 `src/styles/bubble.css`：

```css
:root {
  /* Light mode tokens (预留) */
  --bubble-bg: rgba(255, 255, 255, 0.85);
  ...
  --bubble-border: rgba(0, 0, 0, 0.06);  /* A.2: light mode hairline */
}
.dark {
  /* Dark mode tokens (实际生效 — permission-bubble.html 强制 dark) */
  --bubble-bg: rgba(28, 28, 30, 0.78);
  ...
  --bubble-border: rgba(255, 255, 255, 0.12);  /* A.2: dark mode hairline */
}
```

新增 `--bubble-border` token 解决 dark-on-dark / white-on-white 可见性（A.2 ii）。

### 7. 类型 narrowing helper（C 段收尾）

`src/types/permission.ts` 加 discriminated union predicates：

```ts
export function isSideEffect(r: PermissionRequest): r is SideEffectRequest { ... }
export function isElicitation(r: PermissionRequest): r is ElicitationRequest { ... }
export function isPlanReview(r: PermissionRequest): r is PlanReviewRequest { ... }
```

替代 `as SideEffectRequest` / `as ElicitationRequest` / `as PlanReviewRequest` 强转。`<component :is>` dispatch 的 `:request="current"` 仍用 `as any`（Vue 3 known limitation for union types in component props）。

### 8. 模板 DRY（C.1 α+β）

撤回 ADR-0014 决策 13.5 暗含的"3 kind 各自模板分支"。本 ADR 用 `<component :is>` 统一：

- 3 个 kind 通过 `expandedComponent` computed 按 `current.kind` dispatch
- `expandedRef` 是 `{ goNextOrSubmit?, getFeedback?, canApprove?, scrollToBottom? }` 通用类型
- 加新 kind 时只改 `expandedComponent` switch + 新组件 `defineExpose` 对应方法

## Consequences

### 优点（vs ADR-0014 落地版）

- **浮岛形态真"灵动岛"** —— 容器不动 content 弹动，跨 macOS / Windows / Linux 视觉一致
- **撤回的 4 个机制补回** —— 队列可见 / PlanReview 防呆 / 超时反馈 / agent provenance 全部到位
- **motion-v spring 视觉重量感** —— 短程弹得"活泼"、长程弹得"稳重"，对齐 ADR-0014 决策 7 表里的预测
- **CSS token 集中** —— 未来 light mode 切换只改 `:root` 块
- **类型 narrowing helpers** —— 减少强转，提升代码可维护性

### 代价（vs ADR-0014 落地版）

- **新增 motion-v 依赖**（`package.json` `motion-v: ^2.3.0`）—— ~20kb gzip
- **撤回 4 个机制带来 UI 复杂度** —— chevron / progress bar / scroll unlock / alarm overlay 都是新交互
- **dark mode only** —— `:root` light token 预留但未启用；permission-bubble.html 强制 `<html class="dark">`

### 推翻 / 撤回的 ADR-0014 决策

| ADR-0014 决策 | 本 ADR 状态 |
|---|---|
| 决策 1（webview-sized container）| **推翻**：content-sized + motion-v |
| 决策 3（tray icon 角标）| **保留撤回**（位置去耦后无意义）→ 改为 pill 内 chevron |
| 决策 6（PlanReview 滚到底 unlock）| **撤回撤回** —— 重新启用（B.7 iv）|
| 决策 8（Elicitation 折叠预览）| **保留撤回**（v1 简化）→ 改为顶部 progress dots（更简单）|
| 决策 11（不做工具风险分级）| **保留撤回** → 改为 4 tool-aware renderer |
| 决策 13.4（alarm icon 闪烁）| **撤回撤回** —— 重新启用（B.8 iii + A.6 overlay）|

## V2 follow-up（不在本 ADR 范围）

- **键盘模型** —— ADR-0014 决策 10 deferred；数字键 1-9 / `Cmd+Enter` / `[`/`]` 队列切换
- **工具风险分级** —— 读 / 写差异化 auto-allow；本 ADR 不做
- **规则编辑器** —— `permissionSuggestions` UI；保存到 projectSettings / userSettings
- **macOS mini mode 联动** —— 之前撤回的 tray 移动 → bubble 重定位；可重新评估
- **Linux Wayland 详细 fallback** —— 之前撤回的 per-DE 包装；v1 接受降级

## Files changed

| 文件 | 改动 |
|---|---|
| `package.json` | + `motion-v: ^2.3.0` |
| `src-tauri/Cargo.toml` | 无 |
| `src-tauri/src/lib.rs` | 删 `set_bubble_size` 命令；window 初始 280×600 |
| `src/bubble/BubbleApp.vue` | 重写为 motion-v 浮岛 + `<component :is>` + ExpandedHeader + AlarmBanner |
| `src/bubble/BubblePill.vue` | + chevron `› N` 按钮 + `queueDepth` prop + `skip` emit |
| `src/bubble/ElicitationBubble.vue` | + progress dots bar + CSS |
| `src/bubble/PlanReviewBubble.vue` | 重写：scroll unlock + canApprove + scrollToBottom + progress bar |
| `src/bubble/SideEffectBubble.vue` | 重写：4 tool-aware renderer + JSON fallback |
| `src/bubble/AlarmBanner.vue` | **新增**：5min 超时闪烁 overlay |
| `src/bubble/ExpandedHeader.vue` | **新增**：agent + session provenance 横条 |
| `src/bubble/agent-icons.ts` | **新增**：Sparkles / MousePointer2 / Cpu 映射 |
| `src/bubble/format-side-effect.ts` | **新增**：tool-aware classifier |
| `src/bubble/format-detail.ts` | `firstStringValue` 改为 export |
| `src/styles/bubble.css` | + `:root` + `.dark` 双套 `--bubble-*` token + `--bubble-border` |
| `src/types/permission.ts` | + `isSideEffect` / `isElicitation` / `isPlanReview` predicates |

## Related ADRs

- ADR-0014 tray-anchored-popover-bubble —— 本 ADR 之前的设计基线
- ADR-0013 dynamic-island-permission-bubble —— 更早的设计，被 ADR-0014 替代
- ADR-0011 permission-kind-and-update-entries —— `PermissionRequest` discriminated union 定义
