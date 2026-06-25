# Idle → sleep delay (proposal draft)

Follow-up to the Q9 grilling session. ADR-0009 covered the **multi-host** dimension. This ADR is the **time** dimension of "when should the robot sleep after sessions go quiet."

## Status

proposed draft — 2026-06-24（grilling session）

This is a **stub**, not a complete ADR. It records (a) the open question, (b) the design space, and (c) the implementation outline. A full ADR requires deciding the design questions below and ideally running the proposal past real multi-session usage first.

## Why this exists

Q9 changed `sessionEnded` → `sleeping` to be conditional on "this is the last active session." That fixes a clear correctness bug: the robot no longer falls asleep while other sessions are still working. But it leaves a softer question open:

> When the last active session ends, should the robot go to sleep **immediately**, or **after a short idle window**?

The current code (post-Q9) goes to sleep **immediately** on the last `SessionEnd`. This matches the single-session "I closed the chat → robot sleeps" mental model. But:

- An `AgentTurnEnd` → `SessionEnd` sequence often fires back-to-back (the agent signals "I finished" and then closes the session). The aggregate state was `idle` for a few hundred ms before the `SessionEnd` arrived. With the new guard, sleep fires immediately and the user never sees the brief `idle` pause.
- A multi-session user with two `SessionEnd`s in flight (e.g., a user runs `/clear` in two terminals nearly simultaneously) sees the robot yawning through one session's close, then immediately yawning again through the other — instead of settling into `idle` for a moment and then entering sleep once.

Both are mild UX nits, not bugs. The product question is whether they matter enough to justify the added complexity.

## Design space

Three options on the spectrum from "simplest" to "most flexible":

### Option 1: No delay (current behavior, post-Q9)

Last `SessionEnd` → immediate sleep. Simple, predictable, but no `idle` pause.

### Option 2: Fixed delay

Add `idleToSleepDelay` to `theme.timings` (sibling of `deepSleepTimeout` etc.). Default e.g. `5000`ms. After the last `SessionEnd` clears, the resolver enters a new state `idle` (or stays in `idle`) and a 5-second timer arms; if no new event arrives, transition to `yawning`.

Pros: simple. Cons: hard-coded delay feels arbitrary; the user might want 0ms for some themes and 30s for others.

### Option 3: Theme-decorated delay

Same as Option 2, but expose the delay on each theme's `stateDecoration`/`minDisplay` map. The `idle` state's min display time is what gates the sleep transition.

Pros: theme-driven, fits the existing `minDisplay` vocabulary. Cons: requires thinking through whether `minDisplay.idle = 0` should mean "skip idle" or "no min display for idle," and how this composes with the existing `autoReturn` semantics.

## Open questions

### OQ1. Do users actually want an idle pause?

Without a real multi-session user, this is speculation. The right way to find out is ship Q9 (current behavior, no delay) for a while, gather observation, then revisit. ADR-0010 is a placeholder for that future decision.

### OQ2. If we add a delay, where does the timer live?

The natural place is the `idle` state's `after` transition: "after `idleToSleepDelay`, target `yawning`". But this conflicts with the existing `idle` state's AGENT_HOOK transitions (any AGENT_HOOK from a new session should preempt the timer and cancel the sleep). XState v5 handles this naturally — `after` timers are cancelled by any state transition out of `idle`, and any AGENT_HOOK that targets a non-`idle` state would preempt. We'd need to verify: if the AGENT_HOOK targets `idle` (e.g., `UserPromptSubmit` → `thinking`... no wait, that targets `thinking`), would the timer still fire? In v5, self-targeted transitions cancel timers. So we'd need to be careful about which guards/actions target `idle` vs which target elsewhere.

### OQ3. Interaction with `clearAll` (RESET)

The `RESET` event target is `idle` (from every state, including `sleeping` via the oneShot states). If we add a delay from `idle` to `yawning`, then `RESET` → `idle` would immediately arm the sleep timer. That seems wrong — RESET should reset to a "fresh idle" state, not a "5-seconds-then-sleep" idle. We'd need to distinguish the two `idle` states (one entered from "real" SessionEnd, one from RESET), or have RESET clear any pending timer.

## Implementation outline (when we get there)

Likely shape:

1. Add `idleToSleepDelay?: number` to `ThemeTimings` in `display-state-types.ts`. Default applied at delay-fn level (like `collapseDuration`).
2. Add an `idle` state's `after` transition with the new delay, target `yawning`. This requires that the existing `idle` state's `RESET` action explicitly clears the timer (XState v5 should handle this automatically when RESET exits `idle`, but verify).
3. Update `state-decoration` documentation / theme specs to describe the new timing field.
4. Verify multi-session behavior: end one of two sessions → resolver stays in `idle` (or whatever the surviving aggregate is), does NOT arm the sleep timer.
5. Verify RESET behavior: trigger RESET from any state → idle → no sleep timer armed.
6. (Optional) Expose a "force sleep now" tray item for users who want to skip the delay.

## Recommendation

**Do not implement this now.** Q9 (immediate sleep on last SessionEnd) is the correct baseline. Add ADR-0010 to track the open question. If multi-session usage becomes a real thing and users complain about the immediate-sleep behavior, then write a proper ADR with empirical data and pick one of Options 1/2/3.
