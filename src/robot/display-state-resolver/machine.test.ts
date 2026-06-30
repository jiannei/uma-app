// src/robot/display-state-resolver/machine.test.ts — Regression test
// for the XState machine construction.
//
// cf38681 hoisted RESET to the machine root and wrote
// `target: 'idle'`. XState v5's root node rejects bare relative child
// state names as targets — it needs `.idle` or `#robot.idle`. The bad
// config threw `Invalid target: "idle" is not a valid target from
// the root node` at `.createMachine()` time, which made `import
// './machine'` throw — which made Vue never mount RobotRoot, which
// made the robot window render as a blank `<div id="app">`.
//
// pure.ts tests don't catch this: they only exercise the pure helper
// functions, not the XState setup(...).createMachine(...) chain.
// This test guards that the exported machine config is constructible.

import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { displayStateResolver } from './machine';
import type { ThemeManifest } from '../display-state-types';

const minimalTheme: ThemeManifest = {
  name: 'test-theme',
  timings: {
    minDisplay: {},
    autoReturn: {},
    yawnDuration: 3000,
    wakeDuration: 1500,
    deepSleepTimeout: 600000,
    mouseIdleTimeout: 20000,
    mouseSleepTimeout: 60000,
  },
};

describe('displayStateResolver machine', () => {
  // Regression guard for cf38681 — bare `target: 'idle'` at the root
  // `on.RESET` threw `Invalid target: "idle" is not a valid target
  // from the root node`. The fix uses `target: '.idle'` (explicit
  // child-of-root syntax).
  it('constructs without "Invalid target" errors', () => {
    // displayStateResolver is built by setup({...}).createMachine({...})
    // at module load time. If the config has any invalid target, the
    // import above already throws — this assertion documents that.
    expect(displayStateResolver).toBeDefined();
  });

  it('createActor succeeds with a minimal theme input', () => {
    const actor = createActor(displayStateResolver, {
      input: { theme: minimalTheme },
    });
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  it('RESET event from idle transitions to idle', () => {
    const actor = createActor(displayStateResolver, {
      input: { theme: minimalTheme },
    });
    actor.start();
    actor.send({ type: 'RESET' });
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });
});