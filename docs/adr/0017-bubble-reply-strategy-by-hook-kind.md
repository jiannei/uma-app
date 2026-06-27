# Bubble 三 kind 的 UI 形态与 reply 策略：协议层忠实映射

> 接续 [ADR-0011](./0011-permission-kind-and-update-entries.md) 定义 3-kind `PermissionRequest` 的判别联合，本 ADR 锁定每种 kind 在 bubble 里的 **UI 形态**和**回写 Claude Code 的 reply 形状**。所有决策的根是 Claude Code 官方 hook 协议（`PermissionRequest` / `permission_suggestions` / `updatedPermissions` / `updatedInput`），不引入新抽象层。

## Status

accepted — 2026-06-27（grilling session）

## Context

[ADR-0011](./0011-permission-kind-and-update-entries.md) 已锁定：

1. `PermissionRequest` 拆为 `SideEffect` / `Elicitation` / `PlanReview` 三 kind
2. `AlwaysAllowStore` 整层删除 —— "始终允许" 走 CC 协议层 `updatedPermissions`
3. 决策形状扁平 + 可选字段（`updated_input` / `updated_permissions` / `message` / `interrupt`）

但 **每种 kind 的具体 UI 形态** ADR-0011 没定：
- `SideEffect` 怎么把 `permission_suggestions` 渲染成按钮？每条 suggestion 一对一映射？
- `Elicitation` 怎么分步导航？多题是否一次显示？
- `PlanReview` 反馈文本是常驻还是触发式？plan 滚到底是否仍要 gating？

[ADR-0015](./0015-bubble-optimization-grilling.md)（v7 现状）虽然定了一些 UI（pill + expanded + 4 tool-aware renderer + 进度 dots + scroll unlock + alarm banner），但**没有基于协议层 reply 字段要求**做反向校准 —— 它做的是"看 CC 长什么样就照搬什么"，没问"协议层要求我们必须回什么"。

本 ADR 通过 6 个 Q 把 UI 形态和 reply 形状 1:1 绑定，**bubble 不发明新语义**。

## Decision

### Q1：scope = 审计/加固（A）

不重做架构、不扩 4th kind。审计 ADR-0011 落地后的 UI 是否如实反映协议层 reply 字段要求。

### Q2：3 kind 划分的真实依据 = reply 字段要求不同（A）

不是 "UX 风格不同"，是 **reply 字段必填项不同**：

| Kind | reply 必填 | 关键字段 |
|---|---|---|
| `SideEffect` | `behavior` | `updatedPermissions`（回显 `permission_suggestions[i]`） |
| `Elicitation` | `behavior: "allow"` + `updatedInput.answers` | 文档原话："仅返回 `'allow'` 不足够，必须通过 `updatedInput.answers` 提供答案" |
| `PlanReview` | `behavior` | `message`（reject 时强烈建议带，否则 CC 不知道为啥被拒） |

**三种 reply 形状本质不同** —— bubble 把它识别成 3 kind 是协议层要求，不是 UI 选择。

### Q3：`SideEffect` UI = plain text 列表（终简版 C）

```
┌─ Bash · rm -rf node_modules ───────  ✓ ↗ ─┐
└────────────────────────────────────────────┘
↓ expand
┌────────────────────────────────────────────┐
│ [Terminal] rm -rf node_modules             │
│                                            │
│ Allow once                                 │
│ Allow Bash "rm -rf" in this project        │
│ Allow Bash everywhere                      │
│ Deny                                       │
└────────────────────────────────────────────┘
```

**简化掉**：destination 颜色、危险模式 banner、Y/N/1/2 快捷键标注、destination 排序、suggestion 边框、图标。

**保留**：
- 命令 mono block 预览（决策依据）
- 4 行文字列表（核心交互）
- 焦点默认在 "Allow once"（最安全）
- 按 **CC 原序** 渲染 `permission_suggestions`（CC CLI 对话框本身就是按 specificity 递增排的）

**reply 字段映射（一对一）**：
- `Allow once` → `{ behavior: "allow" }`（不传 `updatedPermissions`）
- `Allow + suggestion[i]` → `{ behavior: "allow", updatedPermissions: [suggestions[i]] }`
- `Deny` → `{ behavior: "deny", message?: string }`

**`toolName` 渲染分类**保留（ADR-0015 决策 3.2 的 `format-side-effect.ts` 4 类：`bash` / `edit` / `write` / `read` / `json` fallback）—— 用于命令 mono block 的内容提取，不影响按钮列表形态。

### Q4：`Elicitation` UI = 分步导航 + pill → 唯一提交入口（A + C 组合）

```
┌─ Claude Code needs input ──────────  →  ✗ ─┐  ← pill: 永远显示 → 触发 goNextOrSubmit
│ Q3 / 5: Which test runner?                 │       ↗ 在 ask 场景下永远隐藏
└────────────────────────────────────────────┘
↓ expand
┌────────────────────────────────────────────┐
│  ● ● ● ○ ○                                │
│                                            │
│ Which test runner do you prefer?           │
│ ○ Jest (default, fast)                     │
│ ● Vitest (ESM-native)                      │
│ ○ Other: [____________]                    │
│                                            │
│ ← Back                                     │  ← 只在 activeIndex > 0 时显示
└────────────────────────────────────────────┘
```

**多题处理**：一次一题（顶部 `Q<n> / <total>` + 进度 dots），分步比滚动更不疲劳。

**底部永远不显示 Next/Submit 按钮** —— pill 上的 `→` 是 ask 场景下唯一的"提交"入口。底部只放 `← Back`（仅 `activeIndex > 0` 时出现）。

**`→` 按钮动态语义**：
- `activeIndex < questions.length - 1` → 触发 `activeIndex++`（"Next"）
- `activeIndex === questions.length - 1` → 触发 `emit("submit", buildUpdatedInput())`（"Submit"）

**`Other` 处理**：每题最后一项固定是 "Other" + 文本输入；选 Other 时单选切到文本输入；multiSelect 时 Other 文本可空（不强制填，因为 multiSelect 可以只勾 Other 不填文本 = "我选其他但还没想好"）。

**`canProceed` 判断**：
- singleSelect：必须选了一项（含 Other + 文本）
- multiSelect：至少选了一项

**reply 字段映射**：
```ts
{
  behavior: "allow",
  updatedInput: {
    questions: [...request.questions],
    answers: { [question_text]: answer_text }  // 用 label 字符串不用 index
  }
}
```

**关键约束**：`updatedInput.answers` 必填 —— 协议明确"仅 `'allow'` 不足够"。

**`↗ chevron` 永远隐藏**（ask 场景下）：一个 ask request 含 N 题，"skip 跳到下一题" 不存在 —— "下一题" 是 `→` 按钮的工作（`goNextOrSubmit`），"下一个 permission request" 是另一个 tool 调用的权限，**ask 内部不涉及**。隐藏 `↗` 避免误用。

### Q5：`PlanReview` UI = 永久 feedback textarea + scroll-to-bottom gating（A）

```
┌─ Plan Review ─────────────────────  ✓ ↗ ─┐
└──────────────────────────────────────────┘
↓ expand
┌──────────────────────────────────────────┐
│ ## Refactor auth                         │
│ 1. Extract session middleware...         │  ← plan 文本（scrollable）
│ 2. ...                                   │
│ ──────────────────── [progress bar]      │  ← ≥ 一屏时显示
├──────────────────────────────────────────┤
│ Tell Claude what to change (optional):   │  ← feedback textarea（永久显示）
│ [_________________________________]      │
└──────────────────────────────────────────┘
```

**feedback 永远在 expanded 底部**（不触发弹窗）—— 70%+ reject 都有具体反馈，textarea 常驻省一次点击。

**scroll-to-bottom gating 保留**（ADR-0015 决策 3.3）：
- plan < 一屏 → `canApprove = true`
- plan ≥ 一屏 → `canApprove = scrollProgress >= 0.99`
- `!canApprove` 时 `pill →` 触发 `scrollToBottom()` 强制滚到底，下一次点击再 approve

**reply 字段映射**：
- `pill →` (Approve) → `{ behavior: "allow" }`（plan 已在 `tool_input`，**不传** `updatedInput`）
- `pill ✗` (Reject) → `{ behavior: "deny", message: <feedback 文本> }`（feedback 为空时 message = `""`，仍带 message 字段让 CC 知道是 user 主动 reject）
- `pill ↗` (skip + advance) → 队列 >1 时显示；`{ behavior: "deny", message: "" }`（skip = reject this plan + advance）

### Q6：5min timeout = 默认 deny + 静默（B）

**移除 ADR-0015 决策 3.4 的 `AlarmBanner` 闪烁机制**。

5min 内用户不响应 → bubble 自动 `{ behavior: "deny", message: "Request timed out" }` + 弹出下一个 request（如果有）或关闭。

**不闪 alarm banner** —— "用户没看见所以闪烁提醒" 是噪音；5min 够长，用户要么看见了已决策、要么离开电脑，不闪也无所谓。

**reply 字段**：`{ behavior: "deny", message: "Request timed out" }` —— 带 message 让 CC 知道是 timeout，不是用户主动 deny。

### 三个 kind 的按钮策略统一表

| 按钮 | `SideEffect` | `Elicitation` | `PlanReview` |
|---|---|---|---|
| `pill →` | Allow once（焦点默认） | Next / Submit（`goNextOrSubmit`） | Approve |
| `pill ✗` | Deny | Deny（带 message） | Reject（带 feedback） |
| `pill ↗ chevron` | 队列 >1 时显示 | **永远隐藏** | 队列 >1 时显示 |
| 底部 | （空） | `← Back`（仅 `activeIndex > 0`） | feedback textarea（永久） |
| 顶部 | 命令 mono block | Q dots + 当前题 | plan 文本（scrollable） |

### Reply 形状统一为 4 种

```ts
type BubbleDecision =
  | { requestId: string, behavior: "allow" }                                                    // Allow once / Approve
  | { requestId: string, behavior: "allow", updatedPermissions: PermissionUpdateEntry[] }      // Allow + rule（SideEffect）
  | { requestId: string, behavior: "allow", updatedInput: { questions, answers } }             // Submit（Elicitation）
  | { requestId: string, behavior: "deny", message: string };                                   // Deny / Reject（所有 kind）
```

后端 `build_permission_response` 直接把这 4 种包成 CC `hookSpecificOutput.decision` envelope 转发：
- `behavior` → `decision.behavior`
- `updatedPermissions` → `decision.updatedPermissions`
- `updatedInput` → `decision.updatedInput`
- `message` → `decision.message`

## Consequences

### 优点

- **协议层 1:1 映射** —— 零翻译层，每种 reply 形状直接对应协议字段
- **UI 极简** —— 三 kind 共享同一 pill 形态（→ / ✗ / ↗），expanded 底部按 kind 各 1 个组件（`Allow 列表` / `Back` / `feedback textarea`）
- **"始终允许" 路径完全打通** —— `permission_suggestions[i]` → 第 i 个 plain text 按钮 → `updatedPermissions[suggestions[i]]`，用户可一键"yes and remember"
- **"始终允许" 安全性** —— 默认焦点在 "Allow once"，用户必须主动按 Tab + Enter 才能点到 "Allow everywhere"
- **CC CLI 对话框 UX 复用** —— 用户的"在 Claude Code 对话框见过"的 muscle memory 直接迁移到 bubble

### 代价

- **撤回 ADR-0015 决策 3.2 的部分内容** —— 4 tool-aware renderer 简化为 plain text 列表（renderer 只用于命令 mono block 的内容提取，按钮列表不再分类）
- **撤回 ADR-0015 决策 3.4** —— `AlarmBanner` 整个组件删除
- **撤回 ADR-0015 决策 4** —— `ExpandedHeader`（agent + session provenance）删除（多 agent 场景罕用，省 24pt bar）
- **撤回 ADR-0015 决策 5 进度 dots 的部分增强** —— dot 点击跳转保留（hover scale 1.25 砍掉，行为不变）
- **撤回 ADR-0015 决策 6 集中 CSS token 的一部分** —— 删除 `--bubble-bg` / `--bubble-border` 等 token（改用项目原有 Catppuccin 变量）
- **CLAUDE.md 第 158-167 行 AlwaysAllowStore 描述未更新** —— 与 ADR-0011 + 本 ADR 不一致，需要清理

### 范围外（明确不做）

- 不合成任何 `PermissionUpdateEntry`（包括 `destination: "session"` 的 `addRules`）—— 完全靠 CC 自己的 `permission_suggestions` 推送
- 不做 keyboard shortcut 系统（Y / N / 1 / 2 / Cmd+Enter / 数字键）—— 鼠标点击 + Enter 触发 focus 按钮够用
- 不做 tool 风险分级（`rm -rf` / `sudo` / `curl|sh` 警告 banner）—— 让用户自己读命令
- 不做 destination 颜色 / 标签 —— suggestion 文字本身已隐含 destination（`in <dir>` = localSettings / `everywhere` = userSettings）
- 不做 multiSelect All / None 按钮 —— multiSelect 用户自己勾选
- 不堆叠多气泡（单窗口替换保持）—— ADR-0014 决策 1
- 不持久化任何 session 规则（由 CC 端 `destination: "session"` 保证）—— ADR-0011 决策 1
- 不接 `tauri-plugin-notification` / `notify-rust`（v1 只用气泡窗口）—— ADR-0011 范围外

## 推翻 / 撤回的 ADR 决策

| ADR 决策 | 状态 |
|---|---|
| ADR-0014 决策 1（webview-sized container）| **保留**（content-sized 浮岛）|
| ADR-0014 决策 6（PlanReview 滚到底 unlock）| **保留** |
| ADR-0014 决策 10（keyboard model）| **保留撤回**（v1 不做）|
| ADR-0015 决策 3.1（chevron `› N` 队列深度）| **保留** |
| ADR-0015 决策 3.2（SideEffect 4 tool-aware renderer 重写 expanded）| **撤回撤回** → 简化为 plain text 列表（renderer 只用于 mono block）|
| ADR-0015 决策 3.3（PlanReview scroll unlock）| **保留** |
| ADR-0015 决策 3.4（`AlarmBanner` 5min alarm 闪烁）| **撤回** → 改静默默认 deny |
| ADR-0015 决策 4（agent + session provenance）| **撤回** → 不显示（罕用）|
| ADR-0015 决策 5（Elicitation 进度 dots 增强）| **保留**（dot 跳转）/ **撤回**（hover scale 1.25）|
| ADR-0015 决策 6（CSS token 集中）| **部分撤回**（`--bubble-bg` / `--bubble-border` 删）|
| ADR-0015 决策 7（discriminated union predicates）| **保留** |
| ADR-0015 决策 8（`<component :is>` dispatch）| **保留** |

## V2 follow-up（不在本 ADR 范围）

- **`setMode` suggestion 处理** —— CC 可能推 `setMode`（"Switch to plan mode" / "Auto-accept edits"）类型的 suggestion，跟 `addRules` 行为不同，UI 需要区分
- **multiSelect All/None 按钮** —— 多题多选场景加快速选择
- **tool 风险分级** —— 读 / 写 / 网络 / 危险命令差异化 auto-allow
- **轻量 keyboard shortcut** —— `Y` / `N` / `Enter` / `Esc` 四个最常用即可
- **macOS mini mode 联动** —— ADR-0014 决策 11 deferred，可重新评估
- **Linux Wayland 详细 fallback** —— ADR-0014 决策 13 deferred，v1 接受降级
- **light mode** —— 气泡强制 `<html class="dark">` 是临时方案，未来加 `:root` light token

## Related ADRs

- [ADR-0011](./0011-permission-kind-and-update-entries.md) —— `PermissionRequest` 3-kind 判别联合 + `AlwaysAllowStore` 删除（**前置**，本 ADR 接续）
- [ADR-0014](./0014-tray-anchored-popover-bubble.md) —— tray-anchored popover 容器架构（**保留**决策 1）
- [ADR-0015](./0015-bubble-optimization-grilling.md) —— v7 优化迭代（**部分撤回**）
- [ADR-0003](./0003-always-allow-scope.md) —— AlwaysAllowStore 历史（**已 SUPERSEDED by ADR-0011**）
