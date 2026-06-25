# Uma on Desk

桌面机器人产品 —— 一个常驻桌面的小角色，通过 HTTP webhook 观察一个或多个 AI 编码代理的活动，并用动画、状态切换、权限气泡反映它们的工作。

## Language

**Session**:
一个 AI 编码代理在某一台主机上的单一运行实例，由 `(host, agentId, sessionId)` 三元组唯一标识。一个 session 有自己的生命周期（`SessionStart` → 若干中间事件 → `SessionEnd`），可以调用工具、请求权限、派生子代理。

实现上 DisplayStateResolver 用 flat `Record<SessionKey, SessionEntry>`；`SessionKey` 是 2 段模板字面量类型 ``${agent}:${session_id}``（`display-state-types.ts`），`host` 暂不在 key 里——uma-app 现阶段只服务 loopback，host 默认为 `'loopback'`。未来接 webui 来源时 key 升级为 3 段（``${host}:${agent}:${session_id}``），升级路径见 ADR-0009。
_Avoid_: conversation（对话回合）、work unit（任务单元）、thread

**Subagent**:
由 session 通过 Task 工具派生出的嵌套代理。其生命周期挂在父 session 内部，不构成独立 session。显示状态由"同一 session 内活跃 subagent 数量"驱动：首次 Task START → `subagent-groove`；叠到 ≥2 → `juggling`；某次 Task END 后仍 ≥1 → `building`（其它 subagent 还在跑）；最后一个 END → `working`（回到普通工作态）。`building` 永远不和"0 个 subagent"同时出现——0 时是 `working` 或 `idle`。
_Avoid_: child session、nested session、task（与 Claude Code 的 Task 工具同名时尤其要避免）

**DisplayState**:
机器人当前展示的姿态/动画，描述"**用户应该看到什么**"，而不是"agent 在干什么"。由所有活跃 session 的内部事件经过优先级聚合后解析得到。常见值：`idle` / `thinking` / `working` / `building` / `attention` / `error` / `notification` / `sleeping` / `waking` / `juggling` / `subagent-groove` / `carrying` / `yawning` / `dozing` / `collapsing`。
DisplayState 的解析由 **DisplayStateResolver** 承担；它的执行参考 `theme.timings`（`autoReturn`、`yawnDuration`、`wakeDuration` 等）以决定 one-shot 自动回退时长和 sleep sequence 推进节奏。

**Base DisplayState by canonical event**:
以下映射是**产品语义决策**（"SessionStart 让 robot 表达'我醒着'而不是'我正在想'"），不是实现细节。DisplayStateResolver 的 `deriveStateFromEvent` 是当前实现载体，改动时请同步本表：

| Canonical event | Base DisplayState | 含义 |
|---|---|---|
| `SessionStart` | `idle` | session 启动，robot 准备接活 |
| `SessionEnd` | `sleeping` | session 结束，robot 进入睡眠序列 |
| `UserPromptSubmit` | `thinking` | 用户提交输入，agent 开始处理 |
| `ToolCallStart` | `working` | agent 调用工具，正在执行 |
| `ToolCallEnd` | `working` | 工具返回，状态保持"在工作"直到下一个事件 |
| `AgentTurnEnd` | `idle` | agent 一轮结束，回到等待 |
| `Notification` | `notification` | one-shot 入口（带 `autoReturn` 自动回退） |
| `PermissionRequest` | `notification` | one-shot 入口（走气泡 UI） |

注意：`ToolCallEnd` 的 `success=false` 在 DisplayStateResolver 内被独立短路为 `error`（one-shot），不进 `working`；`isSubagentToolStart/End` 的衍生状态（`subagent-groove` / `juggling` / `building`）也覆盖上表基线。完整优先级见 `STATE_PRIORITY_ORDER`（`display-state-resolver.ts`）。
_Avoid_: agent state（agent state 是触发源；display state 是视觉呈现，两者不应混用）、status

**SleepSequence**:
机器人进入睡眠的有序中间态序列：`idle → yawning → dozing → collapsing → sleeping`。每站时长从 `theme.timings` 读取（`yawnDuration` / `deepSleepTimeout` / `collapseDuration`），到达 `sleeping` 后等待外部唤醒触发。唤醒走反向短路径：`sleeping → waking → idle`（`waking` 一步直达 idle，不重新 yawning）。
**进入条件：**只有**最后一个活跃 session** 关闭才入 sleep。多 session 场景下，部分 session 关闭时 DisplayStateResolver 只 `clearSession` 不离开当前状态，robot 继续反映剩余 session 的活动；最后一个 session 关闭时再走 SleepSequence。`sessionEndedAndIsLast` guard 负责这一区分（参见 `display-state-resolver.ts`）。当前实现下 SleepSequence 立即触发，**没有 idle → sleep 的冷却延迟**——这在单 session 场景下体验正确，多 session 场景下可能"session 关了 robot 立刻睡"略不自然，follow-up 见 ADR-0010 草案。
_Avoid_: sleep animation（动画是实现）、sleep pipeline（pipeline 是实现）、DND sequence（DND 是触发源之一，不是序列本身）

**OneShotState**:
进入后会在 `theme.timings.autoReturn[state]` 时长后**自动回到基础聚合状态**的 DisplayState。典型成员：`attention`（AgentTurnEnd 后的庆祝）、`notification`（PermissionRequest / Notification 事件）、`error`（ToolCallEnd 失败）。
和 SleepSequence 的差别：one-shot 是**单跳 + 自动回退**，sleep sequence 是**多跳 + 等待唤醒**。
**期间事件处理（ADR-0007，β 行为）：**one-shot 期间到达的非 SessionEnd `AGENT_HOOK` 走 silent ingest——只更新底层 `sessions` / `activeSubagents`，不动 `displayState` / `activeOneShot`，当前 one-shot 显示继续，计时器照常走完；计时到点后回到 `idle` 时**重新聚合**显示，所以新事件的影响不会丢。`SessionEnd` 是例外：立刻取消 one-shot、清掉 session、直接走 `sleeping`，不等计时器。详细权衡见 ADR-0007。
_Avoid_: transient state（太泛）、alert state（与 notification 重叠）、highlight state（实现角度）

**DisplayStateResolver**:
把 `(active sessions, recent events, theme.timings)` 解析成单个 DisplayState 的组件。它持有 session 跟踪、sleep sequence 推进、one-shot 自动回退；消费者（renderer、devtools panel、bubble）订阅它的输出，但从不直接读它内部的 transition / priority 表。
_Avoid_: state machine（实现概念，不要混进 domain）、FSM（同上）、aggregator（聚合只是其中一个职责，sleep sequence 和 one-shot 不属于"聚合"语义）

**HookEvent**:
机器人与 agent 之间一次状态变化的事实。**8 个 canonical 事件名**（与具体 agent 解耦，是所有 adapter 翻译的目标）：

| Canonical | 字段 | 含义 |
|---|---|---|
| `SessionStart` | `session_id, cwd?, model?, transcript_path?` | session 启动 |
| `SessionEnd` | `session_id, reason?` | session 结束（`reason` ∈ `user-requested` / `clear` / `error`） |
| `UserPromptSubmit` | `session_id, prompt?, model?` | 用户提交输入，agent 开始工作 |
| `ToolCallStart` | `session_id, tool_name, tool_input?, tool_use_id?` | agent 调用工具 |
| `ToolCallEnd` | `session_id, tool_use_id?, success?: bool, error?` | 工具返回（`success=false` 即失败；`success` 缺失视为成功） |
| `AgentTurnEnd` | `session_id, reason?` | agent 完成一轮，等待用户 |
| `Notification` | `session_id, message?` | agent 给用户的非阻塞提示 |
| `PermissionRequest` | `session_id, request_id` | 见 PermissionRequest 词条（按 kind 区分结构：SideEffect / Elicitation / PlanReview） |

agent 发出的**原始事件**（如 Claude Code 的 `PreToolUse` camelCase、Codex 的 `pre_tool_use` snake_case）由该 agent 的 `Agent` adapter 翻译为 canonical 事件；状态机只看 canonical 形式。
_Avoid_: state event、agent event、raw event（这两个层是 adapter 关心的；状态机只看 canonical）

**PermissionRequest**:
代理在做出不可自动推断的决策前向用户发起的一次性交互：可能是 SideEffect 的授权（执行敏感工具）、Elicitation 的输入收集（`AskUserQuestion`）、或 PlanReview 的计划审批（`ExitPlanMode`）。客户端通过 `POST /agents/{id}/permission` 阻塞等待机器人回传决定，由气泡 UI 按 kind 渲染。

canonical 结构是一个按 `kind` 区分的 discriminated union（详见 [ADR-0011](./docs/adr/0011-permission-kind-and-update-entries.md)）：

| Kind | 触发条件 | 决策形状 |
|---|---|---|
| `SideEffect` | 普通工具调用（Bash/Edit/Write/Read/Glob/Grep/Task 等） | `allow` / `deny` / `allow + updatedPermissions` |
| `Elicitation` | Claude Code `AskUserQuestion` | `allow + updatedInput.answers` |
| `PlanReview` | Claude Code `ExitPlanMode` | `allow` / `deny + message` |

分类规则是 adapter 私有不变量：Claude Code adapter 按 `tool_name` 分支（`AskUserQuestion` → `Elicitation`；`ExitPlanMode` → `PlanReview`；其他 → `SideEffect`）。`PermissionKind` 枚举本身是 canonical vocabulary 的成员，不绑定特定 agent。

Claude Code 的 `permission_suggestions` 字段（仅 `SideEffect` 携带）原样透传到气泡 UI，用户挑选后整条 entry 通过 `updatedPermissions` 回传给 agent——CC 负责持久化（由 entry 自带的 `destination` 字段决定）。机器人侧**不**维护额外的 session-rule 缓存；CC 喂的 `permission_suggestions` 原样接收并透传，CC 自己维护 `destination: "session"` 规则并 short-circuit 后续请求。"始终允许"作为产品语义已被删除（见 [ADR-0003](./docs/adr/0003-always-allow-scope.md) 归档）。
_Avoid_: tool approval、permission bubble、始终允许（已删除概念）

**PermissionKind**:
`PermissionRequest` discriminated union 的 tag 枚举。三种值：`SideEffect` / `Elicitation` / `PlanReview`。**枚举本身是 canonical vocabulary 的成员**——不绑定特定 agent；具体哪个 `tool_name` 映射到哪个 kind 由各 adapter 的私有分类规则决定（Claude Code adapter 按 `tool_name` 分支）。其他 agent（Codex/Kimi 等）接入时按各自协议定义等价映射，但 `PermissionKind` 这个枚举保留 canonical 身份。

**PermissionUpdateEntry**:
canonical vocabulary 的成员，对齐 Claude Code `PermissionRequest` hook 协议层的"permission 更新"原子操作。6 种类型：`addRules` / `replaceRules` / `removeRules` / `setMode` / `addDirectories` / `removeDirectories`；每个 entry 自带 `destination ∈ {session, localSettings, projectSettings, userSettings}`。`session` 目的地是"agent 进程内存里、会话结束清掉"——这正是 CC 端 short-circuit 后续请求的机制。

来源：[Claude Code hooks 文档](https://code.claude.com/docs/zh-CN/hooks)。该枚举作为初始 vocabulary；其他 agent 的等价机制后续接入时按同样 6 种结构翻译或扩展。

**v1 不主动合成 entry**：uma-app 只透传 agent 喂的 `permission_suggestions`，用户挑选后原样回写。`session` 目的地由 agent 自己维护；其他 destination 由 agent 自己负责持久化。
_Avoid_: permission rule（rule 只是 entry 里的一个字段，不是 entry 本身）、always-allow entry（"始终允许" 已删除）

**Agent**:
机器人支持的一种 AI 编码助手。在 Tauri 端以 **in-process adapter** 形式实现（每 agent 一个 `adapters/<agent>.rs` 模块），封装 (a) 该 agent 的身份与配置文件位置、(b) hook 的 install/uninstall 流程、(c) 该 agent 原始 hook payload → 内部 `HookEvent` 的归一化逻辑。机器人在 Tauri 编译期通过 `KNOWN_AGENTS` 静态注册已知 agent；目前只服务 `claude-code`，但其他 agent 可在不重写状态机/事件流的前提下后续接入。状态机只看到已归一化的 `HookEvent`，不感知具体 agent 的事件词汇。
_Avoid_: provider、source、adapter-as-runtime-plugin（adapter 是编译期模块，不是运行时插件）