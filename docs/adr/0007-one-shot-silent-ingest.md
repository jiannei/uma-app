# One-shot 期间的事件处理：silent ingest + SessionEnd 例外

ADR-0006 用 XState v5 重写 DisplayStateResolver 时，one-shot 子机的 `on.AGENT_HOOK` **没有转移定义**——这意味着 one-shot 期间到达的 `AGENT_HOOK` 事件被 XState v5 **就地消费，不冒泡**。这导致 (a) `SessionEnd` 期间会丢失 `sleeping` 转移，(b) 其它 session 的事件也进不来。本 ADR 收敛这块的行为。

## Status

accepted — 2026-06-24（grilling session）

## Context

`display-state-resolver.ts` 在 one-shot 期间的实际行为（修正前）：

```ts
oneShot: {
  initial: 'attention',
  states: {
    attention: {
      after: { attentionAutoReturn: { target: '#robot.idle', actions: ['clearOneShot'] } },
      on: {
        RESET: { target: '#robot.idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
        // ⚠️ 没有 AGENT_HOOK
      },
    },
    error:        { /* 同上 */ },
    notification: { /* 同上 */ },
  },
}
```

XState v5 的语义：子状态没注册的事件**就地消费，不冒泡到父状态**。所以 one-shot 期间 `AGENT_HOOK` 全部被吞。具体后果：

1. **SessionEnd 错失** — `idle` / `working` / `building` / `subagentGroove` / `juggling` 都注册了 `{ guard: 'sessionEnded', target: 'sleeping', actions: 'clearSession' }`，但 one-shot 子机没有。SessionEnd 到达时事件被吞，session 不从 `sessions` 映射清掉，计时到点后回到 `idle` 而不是 `sleeping`。**显式的 sleep 错失**，且 sessions 映射留着僵尸 session。
2. **新 session 进入不了** — 另一 session 的 `ToolCallStart` / `UserPromptSubmit` 被吞，`ingestEvent` 不跑，那个 session 不进 `sessions` 映射。one-shot 结束后回到 `idle`，**新事件的聚合结果根本没机会被呈现**。
3. **`STATE_PRIORITY_ORDER` 失效** — 设计意图是"多个活跃 session 选最高优先级"，但 one-shot 期间新 session 进不来，3s/5s 计时器一过，聚合的是**过时的快照**。

## Decision

one-shot 期间采用 **silent ingest + 退出时 recompute** 行为。具体规则：

- **非 SessionEnd 的 `AGENT_HOOK`：** 走 `ingestEventSilent` action。`computeIngestUpdate` 计算出新的 `sessions` / `activeSubagents`，**但 `displayState` 和 `activeOneShot` 不动**——当前 one-shot 视觉继续，计时器照常跑。
- **`SessionEnd`：** one-shot 必须立刻收尾。转移 target 为 `#robot.sleeping`，actions 为 `['clearSession', 'clearOneShot']`。不等计时器。
- **退出 one-shot（autoReturn 计时到点）：** actions 改为 `['clearOneShot', 'recomputeDisplay']`。`recomputeDisplay` 调 `recomputeDisplayState(context.sessions)` 把显示同步到 silent ingest 期间累积的最新聚合。**显示不会停留在 one-shot 触发那一刻的过期快照上。**

实现细节：

- `computeIngestUpdate` 抽出来作为纯函数（放在 `recomputeDisplayState` 旁边），`ingestEvent` 和 `ingestEventSilent` 都消费它——避免重复。
- `ingestEvent` = `computeIngestUpdate` + `displayState: recomputeDisplayState(...)`。
- `ingestEventSilent` = `computeIngestUpdate`（displayState 留空，assign 不覆盖）。
- `recomputeDisplay` 是新 action，用于"重新把 displayState 同步到 sessions 聚合"的场景。

```ts
// oneShot 子机的标准形状
attention: {
  after: {
    attentionAutoReturn: {
      target: '#robot.idle',
      actions: ['clearOneShot', 'recomputeDisplay'],
    },
  },
  on: {
    AGENT_HOOK: [
      { guard: 'sessionEnded', target: '#robot.sleeping', actions: ['clearSession', 'clearOneShot'] },
      { actions: 'ingestEventSilent' },
    ],
    RESET: { target: '#robot.idle', actions: 'clearAll' },
    THEME_CHANGED: { actions: 'swapTheme' },
  },
}
```

## Consequences

**正面：**
- SessionEnd 在任何状态下都能正确走到 `sleeping`，sessions 映射不留僵尸。
- one-shot 期间其它 session 的事件被静默记入，退出后立刻看到新聚合。
- `STATE_PRIORITY_ORDER` 在 one-shot 退出后立刻生效——如果期间有 error 进来，退出后会显示 error，而不是已经过时的 attention。

**负面 / 权衡：**
- 严格说仍然不是"实时聚合"——one-shot 期间如果另一个 session 进入了更高的 `STATE_PRIORITY_ORDER` 状态（比如 error），**新 error 不会立即打断当前 one-shot**。它会先被 silent ingest 到底层，等计时到点退出后通过 `recomputeDisplay` 一次性呈现。
- 视觉延迟：one-shot 触发后最长 `autoReturn.duration`（默认 5s）才能看到最新底层状态。对绝大多数场景可接受——one-shot 本身就是"短暂插播"。

**有意不做的：**
- **不做高优先级 preemption**。如果 one-shot.attention 期间来了个 toolFailed，不切到 oneShot.error；选择是 (i) 静默 + 退出时显示 error，或 (ii) 立刻打断。选了 (i)——理由：one-shot 是"先看这个"的视觉缓冲，立刻打断会让庆祝动画永远跑不完。如果以后想换 preemption，规则是清晰的（按 STATE_PRIORITY_ORDER 抢占），改动是局部的。
- **不修改 `STATE_PRIORITY_ORDER` 来反映 one-shot 期间的"应有"状态**。displayState 期间是 one-shot 值，sessions 映射是真实值，recompute 时按 sessions 走。

## Alternatives considered

- **α 行为（"忽略一切"）：** one-shot 期间所有事件被吞，仅在 oneShot.* 加 SessionEnd 例外转移。比 β 简单，但**不做底层更新**——退出时还是回到 idle 不会 recompute，所以 one-shot 期间累积的新事件影响全丢。否决。
- **γ 行为（"任何事件打断"）：** 任何 `AGENT_HOOK` 取消 one-shot 计时器，重新评估显示。最简单，但视觉上 one-shot 永远跑不完——任何 ToolCallEnd 都会打断 attention 庆祝。否决。
- **β 行为（silent ingest + 退出 recompute）= 选定。** 视觉契约保留（one-shot 跑完），底层契约不丢（新事件影响体现在退出后）。
