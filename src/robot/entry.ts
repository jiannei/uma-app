// src/robot/entry.ts — robot window entry.
//
// Mirrors src/main.ts / src/bubble/main.ts: pull in the per-window
// CSS (robot.css — minimal, no theme tokens or shadcn-vue) then mount
// the SFC. The robot window is the only one of the three that doesn't
// use a Tauri-decorated chrome — body has `pointer-events: none` so the
// whole 200×200 sprite is click-through except for the per-asset
// hit-zone (see ADR-0004). That class is applied in robot.html, not here.

import { createApp } from "vue";
import RobotRoot from "./RobotRoot.vue";
import "../styles/robot.css";

createApp(RobotRoot).mount("#app");
