# Adopt XState v5 for the DisplayStateResolver

引入 XState v5 + `@xstate/vue` 作为 DisplayStateResolver 的实现。machine 定义在 `src/pet/pet-machine.ts`，timings 从 `context.theme` 注入；消解 `EVENT_TO_STATE` / `STATE_PRIORITY` 两个数据导出，保留 `ALL_STATES` / `SUBAGENT_TOOLS` 给 theme-manager 和 devtools 用，session 跟踪走 `assign` 风格留在 machine context。

## Status

accepted — 2026-06-24（grilling session）

## Context

`src/pet/state-machine.js` 当前是 ~400 行手写实现，覆盖 4 个 canonical event → display state 的简单聚合。三个真实缺口让它与参考实现 [uma-pet](https://github.com/.../uma-pet) 不一致：

1. **Sleep sequence 缺失** —— `theme.json` 已声明 `yawning` / `dozing` / `collapsing` / `sleeping` / `waking` 五个状态和对应 asset，但 SM 不消费；当前 `SessionEnd → sleeping` 是单跳。
2. **Auto-return / min-display 缺失** —— reference 的 `setState` 用 `theme.timings.minDisplay` / `autoReturn` 抑制低优先级替换并让 one-shot 自动回退；当前 SM 把 `attention` 的时长 hardcode 成 `ONESHOT_DURATION_MS = 1500`。
3. **`theme.timings` 完全没被消费** —— theme.json 已经写好了所有时长（`yawnDuration: 3000`、`wakeDuration: 1500`、`deepSleepTimeout: 600000`、`mouseIdleTimeout: 20000`、`mouseSleepTimeout: 60000`），但 SM 没读。改主题时长 = 改完不生效。

手写实现要把 ① session 跟踪 ② priority 聚合 ③ timer 调度 ④ priority guard（pendingState 抑制低优先级替换） ⑤ DND 集成 ⑥ sleep sequence 推进 全塞在一个类里，每加一个特性都在同一个文件改；规模过了"plain JS 仍可读"的边界。

## Decision

引入 **XState v5** + **`@xstate/vue`** 作为 DisplayStateResolver 实现。具体设计：

- **machine 定义在 `src/pet/pet-machine.ts`**。不是 JSON、不是独立 schema 文件。guard/action 必须是真正的 TS 函数（要引用 adapters、theme-manager、devtools helpers）；type-safe 才能让 ADR-0001 的 8 canonical event 在 machine.events 里被 TS 编译期校验。
- **timings 通过 `setup({ delays })` 从 `context.theme` 注入**：
  ```ts
  setup({
    delays: {
      yawnDuration: ({ context }) => context.theme.timings.yawnDuration,
      wakeDuration: ({ context }) => context.theme.wakeDuration,
      collapseDuration: ({ context }) => context.theme.timings.collapseDuration,
      mouseIdleTimeout: ({ context }) => context.theme.timings.mouseIdleTimeout,
      // 每个 one-shot state 一个 delay 名
      attentionAutoReturn: ({ context }) => context.theme.timings.autoReturn.attention,
      notificationAutoReturn: ({ context }) => context.theme.timings.autoReturn.notification,
      // ...
    }
  })
  ```
  XState v5 的 delay 在状态被**进入那一刻**求值；进入后 timer 跑起来，delay 值被冻结。后续 theme 切换不影响 in-flight timer —— 这是 [Consequences](#consequences) 里讨论的取舍。
- **theme 切换通过 `THEME_CHANGED` 事件触发 `assign`**。不需要 `actor.stop() + recreate`；下一个进入状态的 timer 会读到新值。
- **`EVENT_TO_STATE` / `STATE_PRIORITY` 数据导出消解**。前者变成 `machine.config.states` 的内嵌 transitions；后者由 transition 数组顺序 + guards 隐式表达（first-match-wins），不再是数字。theme-manager / devtools panel 改用 `actor.getSnapshot()` / `actor.subscribe()` 拿状态。
- **`ALL_STATES` / `SUBAGENT_TOOLS` 保留为导出**。前者是 `Object.keys(machine.config.states)` 的 typed view，theme-manager 仍用它注册 fallback；后者跟 SM 无关，是 session-domain 知识（哪些 tool name 算 subagent），devtools panel 仍要消费。
- **session 跟踪走 `assign` 风格，住 machine context**。`Map<AgentId, Map<SessionId, SessionEntry>>` 变成 `Record<\`${aid}:${sid}\`, SessionEntry>` plain object（key 复合），update 是 O(1) spread。
- **不引入 child actor**（不"每 session 一个 sub-FSM"）。本仓 session 数量 ≤ 20，guard 检视 context.sessions 就够；actor 模型是为大几十个 actor + 跨 actor 通信设计的，撑不起。

## Considered Options

- **Option A：hand-rolled 解释器 + theme.json 驱动**。`setup` 函数接受 `{ states, transitions, delays }`，自己写 ~50 行解释器 + tick scheduler。timings 从 theme 注入；状态图形态在 JSON。代价：guard/action 走字符串名 + registry（类型不安全）；"加一个 guard"要改 JSON + registry 两处；JSON 表达力不够写复杂 lambda。最终选了 Option B，因为同样的扩展力用 XState 不需要重新发明声明式语法。
- **Option B：XState v5 + `@xstate/vue`** ✅。成熟、维护活跃、有 TS 类型、有 `@xstate/inspect` 可视化、~25KB gzip。代价：引入依赖；学习曲线；某些 XState 概念（actor / invoke）本仓用不上。
- **Option C：`@xstate/fsm`**。XState 的极简子集（~3KB），只支持 flat states + transition，没 `after` timer。代价：要自己写 timer 调度；不如 XState v5 完整。
- **Option D：Rust FSM crate（`rust-fsm` / `statig`），把 SM 搬到 Rust 端**。代价：渲染多一跳 IPC 延迟（sleep sequence 是亚秒级）；前端 devtools panel 的"事件注入 + 状态检查"工作流要重新设计；theme 加载要从 Rust 启动期 load。ADR-0001 关心的是"SM 只看 canonical"，translation layer 在 Rust 已经守住边界，没必要把 SM 也搬过去。

## Consequences

- **`theme.timings` 真正被消费**。改 theme.json 的 `yawnDuration` → 下一次进入 yawning 状态用新值（in-flight timer 用旧值，见下）。
- **in-flight theme 切换 timer 冻结旧值**。XState v5 的 delay 在状态进入时求值；用户在 `idle` 跑了 30s 准备 yawning，中途切换主题把 `mouseIdleTimeout` 从 60s 改到 10s，已经跑的 30s timer 不会重置。这是可接受的 fallback —— 撞上的概率低，下一次 sleep cycle 自然用新值。如果用户真的急，ta 直接关 DND 更快。
- **bundle 增加 ~25KB gzip**（xstate core）。`@xstate/vue` 额外 ~2KB。Tauri app 已经 ship Vue 3 + Tauri runtime，25KB 量级可忽略。
- **`EVENT_TO_STATE` / `STATE_PRIORITY` 消失**。devtools panel 的"priority 数字"视图要改写成 transition 链展示。`ALL_STATES` / `SUBAGENT_TOOLS` 不动。
- **state-machine.js 改名为 `pet-machine.ts` + `pet-machine-types.ts`**（machine 定义 + 派生类型分开）。旧的 `STATE_PRIORITY` / `EVENT_TO_STATE` 常量彻底删除；ALL_STATES / SUBAGENT_TOOLS 留下。
- **未来扩展有现成路径**：
  - mini mode = 在 `idle` / `working` / `sleeping` 等节点下挂 `mini-idle` / `mini-working` / `mini-sleep` 子状态，用 hierarchy
  - parallel session 子状态机 = 走 `invoke` + actor（如果未来 session 数量爆炸、actor 模型真的值得）
  - Stately 可视化编辑器 = 接 `@xstate/inspect`，dev panel 拿到真实状态图（替换现在的文字状态表）
- **公开 `@xstate/vue` 集成面**：`<script setup>` 用 `useMachine(() => createPetMachine({ theme }))` 拿 `snapshot` / `send`，subscribe 自动管理生命周期。pet.html 里替换手写 listener 注册。