# DevTools 整合到主窗口

把 devtools 从独立 webview 窗口整合进主窗口 sidebar nav（第 6 项，仅 dev 模式出现）。同时把 Rust 侧 gate 从 Cargo feature `dev-tools` 切换到 `cfg(debug_assertions)`，让"dev-only"自动跟 build profile 走，不再需要手动 `--features dev-tools`。

## Status

accepted — 2026-06-25（grilling session）

**部分修订 [ADR-0005](./0005-dev-tools.md)**：
- D4（独立 devtools webview 窗口）被本文档取代
- D5（启动时自动 `.show()`）不再适用（devtools 不再是独立窗口）
- D10（dev panel 独立于 robot）仍然有效 —— devtools 作为 App.vue 的子组件，仍在 `main` webview 里，与 `robot` webview 的 XState 实例保持分离

## Context

ADR-0005 建立的独立 devtools 窗口在半年使用后暴露了几个问题：

1. **桌面视觉干扰**：独立 800×600 窗口 + 启动时自动 `.show()` 让 dev 模式下桌面永远多一个窗格。无法真正"关掉"（只能 hide，下次启动又回来）。
2. **Cargo feature 心智负担**：开发者每次 `cargo build` / `cargo run` 都要记得加 `--features dev-tools`。忘了就"怎么 devtools 不见了"。
3. **启动时自动 show 的反作用**：原本设计是"dev 模式默认就有 devtools"的便捷，但实际 dev 调试时 80% 的时间在看 robot 或 IDE，devtools 窗口反而是遮挡。

约束：
- 仍然必须"dev-only"——release 构建里**零 devtools 代码、零 devtools UI、零 devtools 命令**。
- 不能引入新的"忘记开"问题。

## Decision

### D1. DevTools 整合进主窗口 sidebar nav

主窗口（800×680，原 800×600）sidebar nav 第 6 项 "🔧 DevTools"。
- 用 `import.meta.env.DEV` 控制 nav 项是否出现（conditional spread）
- DevToolsApp 作为 App.vue 的子组件嵌入，dynamic import + `defineAsyncComponent`
- `v-if="isDev"` 让 release build 完全不渲染（配合 dynamic import 让 Vite tree-shake 掉 DevToolsApp.vue + 5 panels + XState machine）
- `v-show="activeNav === 'devtools'"` 保留 devtools 状态（切 tab 不 unmount）—— theme editor dirty state / XState context 都保留

### D2. Rust 侧 gate 改用 `cfg(debug_assertions)`

- 删除 `Cargo.toml` 里的 `dev-tools = []` feature
- 所有 `#[cfg(feature = "dev-tools")]` → `#[cfg(debug_assertions)]`
- `cargo build`（dev profile）自动启用；`cargo build --release` 自动禁用
- 不再有"忘记 `--features dev-tools`"的问题

保留的 dev-only commands（`devtools_get_pending` / `devtools_fire_synthetic_permission` / `theme_load` / `theme_save`）—— DevToolsApp 嵌进 App.vue 后仍然会调用。

### D3. 删除独立 devtools 窗口

- 删除 devtools 窗口创建代码（lib.rs L677-710）
- 删除 `devtools.html` / `src/devtools/main.ts`
- 删除 `vite.config.ts` 的 devtools rollup entry
- `capabilities/default.json` 从 windows 数组里删除 `"devtools"`

### D4. Event log panel 删除

DevTools 从 6 个 panel 减到 5 个（StateMachine / Visual Debug / Stores / Synthetic Fire / Theme Editor）。Event log panel 删除 —— 用户判断 Rust CLI 输出（`eprintln!`）可替代前端 event log。

Devtools layout 从固定 2×3 grid 改为 flex wrap（`flex: 1 1 320px; min-width: 280px`）—— 5 panel 在宽屏下一行 2-3 个，窄屏 1 个，自适应。

### D5. 主窗口尺寸 800×600 → 800×680

给 tab 切换 / devtools 嵌入留垂直空间。Release 用户看 settings 页面也变大 80px，稀疏 layout 影响很小。dev / release 统一尺寸。

## Consequences

### 正面

- **零心智负担的 dev-only**：build profile 决定一切，开发者不用记任何 flag
- **桌面更干净**：dev 模式下不再有独立 devtools 窗口挡着
- **release 构建更干净**：DevToolsApp 通过 dynamic import + `import.meta.env.DEV` 完全从 release bundle 里消除（Vite tree-shake）
- **devtools 状态天然保留**：`v-show` 切 tab 不 unmount，theme editor 编辑到一半切走再切回来还在
- **Event log 简化**：CLI 输出 + state machine panel 状态足够调试，少一个 panel

### 负面 / 代价

- **`cfg(debug_assertions)` 不可逆**：不能发 release profile 但带 devtools 的调试包（要调试只能走 dev profile）。半年内没遇到这种需求，接受。
- **主窗口尺寸变大 80px**：release 用户 settings 页面稀疏了 80px。可接受。
- **`v-show` + `display: none` 副作用**：ThemeEditorPanel 内部如果有 `ResizeObserver` 或 `getBoundingClientRect` 调用，`display: none` 时尺寸是 0，切回来可能触发错误 resize。实现时检查；必要时换 `visibility: hidden` 或 `<KeepAlive>`。

### 实现清单

- `src/App.vue`：加 DevTools nav 项 + section + dynamic import
- `src/devtools/DevToolsApp.vue`：样式调整（height 100%）、删 EventLogPanel、layout 改 flex wrap
- `src/devtools/panels/EventLogPanel.vue` / `devtools.html` / `src/devtools/main.ts`：删除
- `vite.config.ts`：删 devtools entry
- `src-tauri/Cargo.toml`：删 `dev-tools = []` feature
- `src-tauri/capabilities/default.json`：删 "devtools" window 引用（不删会让 Tauri 启动报错）
- `src-tauri/src/lib.rs`：所有 `feature = "dev-tools"` → `debug_assertions`；删 devtools 窗口创建；主窗口尺寸 800×680
- `src-tauri/src/http_server.rs`：2 处 cfg 替换
- `CLAUDE.md` / `docs/adr/0005-dev-tools.md`：文档同步
