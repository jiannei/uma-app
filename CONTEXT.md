# Uma on Desk

桌面机器人产品 —— 一个常驻桌面的小角色，通过 HTTP webhook 观察一个或多个 AI 编码代理的活动，并用动画、状态切换、权限气泡反映它们的工作。

## Language

**Session**:
一个 AI 编码代理在某一台主机上的单一运行实例，由 `(host, agentId, sessionId)` 三元组唯一标识。一个 session 有自己的生命周期（`SessionStart` → 若干中间事件 → `SessionEnd`），可以调用工具、请求权限、派生子代理。

实现上状态机用**嵌套 Map**（`Map<AgentId, Map<SessionId, SessionEntry>>`）按 agent 维度分桶；`host` 暂不参与 key（uma-app 现阶段只服务 loopback，等接 webui 来源再加）。
_Avoid_: conversation（对话回合）、work unit（任务单元）、thread

**Subagent**:
由 session 通过 Task 工具派生出的嵌套代理。其生命周期挂在父 session 内部，不构成独立 session。机器人通过"同一 session 内并发 subagent 数量"决定显示状态（0 → `building`，1 → `subagent-groove`，≥2 → `juggling`）。
_Avoid_: child session、nested session、task（与 Claude Code 的 Task 工具同名时尤其要避免）

**DisplayState**:
机器人当前展示的姿态/动画，描述"**用户应该看到什么**"，而不是"agent 在干什么"。由所有活跃 session 的内部事件经过优先级聚合后解析得到。常见值：`idle` / `thinking` / `working` / `building` / `attention` / `error` / `notification` / `sleeping` / `waking` / `juggling` / `subagent-groove` / `sweeping` / `carrying` / `yawning` / `dozing` / `collapsing`。
DisplayState 的解析由 **DisplayStateResolver** 承担；它的执行参考 `theme.timings`（`autoReturn`、`yawnDuration`、`wakeDuration` 等）以决定 one-shot 自动回退时长和 sleep sequence 推进节奏。
_Avoid_: agent state（agent state 是触发源；display state 是视觉呈现，两者不应混用）、status

**SleepSequence**:
机器人进入睡眠的有序中间态序列：`idle → yawning → dozing → collapsing → sleeping`。每站时长从 `theme.timings` 读取（`yawnDuration` / `deepSleepTimeout` / `collapseDuration`），到达 `sleeping` 后等待外部唤醒触发。唤醒走反向短路径：`sleeping → waking → idle`（`waking` 一步直达 idle，不重新 yawning）。
_Avoid_: sleep animation（动画是实现）、sleep pipeline（pipeline 是实现）、DND sequence（DND 是触发源之一，不是序列本身）

**OneShotState**:
进入后会在 `theme.timings.autoReturn[state]` 时长后**自动回到基础聚合状态**的 DisplayState。典型成员：`attention`（AgentTurnEnd 后的庆祝）、`notification`（PermissionRequest / Notification 事件）、`error`（ToolCallEnd 失败）、`sweeping`（/clear）。
和 SleepSequence 的差别：one-shot 是**单跳 + 自动回退**，sleep sequence 是**多跳 + 等待唤醒**。
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
| `ToolCallEnd` | `session_id, tool_use_id?, success: bool, error?` | 工具返回（`success=false` 即失败） |
| `AgentTurnEnd` | `session_id, reason?` | agent 完成一轮，等待用户 |
| `Notification` | `session_id, message?` | agent 给用户的非阻塞提示 |
| `PermissionRequest` | `session_id, tool_name, tool_input, request_id` | 工具调用前的敏感权限请求 |

agent 发出的**原始事件**（如 Claude Code 的 `PreToolUse` camelCase、Codex 的 `pre_tool_use` snake_case）由该 agent 的 `Agent` adapter 翻译为 canonical 事件；状态机只看 canonical 形式。
_Avoid_: state event、agent event、raw event（这两个层是 adapter 关心的；状态机只看 canonical）

**PermissionRequest**:
代理在执行敏感工具前向用户请求授权的一次性交互。客户端通过 `POST /permission` 阻塞等待机器人回传决定（`allow` / `deny`），由气泡 UI 呈现。
_Avoid_: tool approval（不要把"工具"和"请求"混在一起说）、permission bubble（bubble 是 UI 形态，不是请求本身）

**Agent**:
机器人支持的一种 AI 编码助手。在 Tauri 端以 **in-process adapter** 形式实现（每 agent 一个 `adapters/<agent>.rs` 模块），封装 (a) 该 agent 的身份与配置文件位置、(b) hook 的 install/uninstall 流程、(c) 该 agent 原始 hook payload → 内部 `HookEvent` 的归一化逻辑。机器人在 Tauri 编译期通过 `KNOWN_AGENTS` 静态注册已知 agent；目前只服务 `claude-code`，但其他 agent 可在不重写状态机/事件流的前提下后续接入。状态机只看到已归一化的 `HookEvent`，不感知具体 agent 的事件词汇。
_Avoid_: provider、source、adapter-as-runtime-plugin（adapter 是编译期模块，不是运行时插件）