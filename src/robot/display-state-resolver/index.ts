// src/robot/display-state-resolver/index.ts — Barrel re-export. External
// consumers (`RobotRoot.vue`, `DevToolsApp.vue`, devtools panels, tests)
// keep importing from `./display-state-resolver` — this barrel routes
// to the right module without exposing the pure/machine split.

export {
  displayStateResolver,
  type DisplayStateResolverInput,
} from './machine';

export {
  STATE_PRIORITY_ORDER,
  sessionKeyOf,
  recomputeDisplayState,
  deriveStateFromEvent,
  subagentStateFor,
  computeIngestUpdate,
  type PureIngestEvent,
} from './pure';