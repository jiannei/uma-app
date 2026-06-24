# Developer tools (dev mode) panel

为改 uma-app 本身的开发者提供运行时调试面板：4 个 panel（StateMachine 检视器 / 事件流日志 / PendingStore + AlwaysAllowStore / 手动合成事件发射器）外加一个 Reset 按钮；编译期 `dev-tools` Cargo feature + Vite `import.meta.env.DEV` 双门控，发布构建里代码、UI、Tauri 命令、事件**全部不存在**；dev 构建启动时 devtools 窗口自动 `.show()`，**运行时无任何 UI gate / toggle / 按钮**——开发模式就是"启动就有，关掉只能重启 app"。

## Status

accepted — 2026-06-24（grilling session）

**Supersedes**: 2026-06-24 — D1 / D2 / D5 三个决策在实现完成后被推翻。原设计要求"运行时用户 toggle 控制面板 + 按钮驱动打开窗口"，实际首轮 UI 验证时被用户否决（"不需要设置，开发模式默认打开就行"）。D3 / D4 / D6 / D7 / D8 不变。各被推翻的决策下方有 `> **Override**` 块记录变更原因。

## Context

调试 uma-app 本身的现状只能靠 `cargo run` 看 `tracing` 日志 + 手动开 Claude Code 复现，缺一个能直接观察内部状态的面板。具体痛点：

- 状态机 `Map<AgentId, Map<SessionId, SessionEntry>>` 是 JS 端纯内存结构，出了 bug 没有任何方式"看进去"——只能加 `console.log` 重启。
- adapter 翻译（Claude Code `PreToolUse` → canonical `ToolCallStart`）出错时，agent 端到状态机之间的中间产物不可见。
- PendingStore / AlwaysAllowStore 是 Rust 端 `HashMap`，permission 流程卡住时只能加 `dbg!` 宏重启。
- 想测状态机对某个 canonical 事件的反应，必须开一个真 Claude Code session 制造事件，不能针对性输入。

约束：
- 必须是**编译期门控**——绝不能泄漏到发布构建（生产用户看不到内部状态）。
- 必须**对运行时其他窗口（主要是 pet）无副作用**——dev 工具不能改生产代码路径的语义。
- 实现成本要匹配收益——这是个开发者工具，不是产品功能，不值得投入半年。

## Decision

### D1. 范围：纯编译期门控，无运行时 UI

调试面板的存在与否是**开发态特性**，不是产品功能。在 dev 构建里**无任何 gate**——启动即用。在发布构建里**代码、UI、Tauri 命令、事件全部不存在**（编译期移除）。

> **Override（原决策已废）**：原设计要求 Settings 窗口里有"Developer Mode" toggle + "Open DevTools" 按钮。实施后被用户否决——多一个 toggle 是噪音，没有"关闭 dev mode" 的真实场景（开发就是开发，不需要运行时切换）。**新设计：dev 模式就是 dev 模式，没有开关。**

### D2. 生命周期：纯编译期门控

- 编译期：`dev-tools` Cargo feature + Vite `import.meta.env.DEV`。任一为关 → 整个 dev 路径（Rust 命令、事件、JS 模块、HTML entry）从产物中移除。
- 运行期：dev 构建里无任何运行时开关。`Settings.dev_mode` 字段**不存在**（既不在 Rust `Settings` struct 里，也不在 plugin-store 里，也不在 JS 端 `Settings` interface 里）。

> **Override（原决策已废）**：原 D2 要求"混合（编译期决定面板是否存在，运行时 toggle 决定面板内容）"。理由不再成立——既然没有运行时 toggle，dev 面板内容在 dev 构建里永远填充，发布构建里整个不存在。

### D3. 包含的 panel：1 + 2 + 4 + 5

- **Panel 1 — StateMachine 检视器**：实时显示 dev 窗口本地 StateMachine 实例的 `Map<AgentId, Map<SessionId, SessionEntry>>` 全量、当前解析出的 `DisplayState`、事件优先级。
- **Panel 2 — 事件流日志**：每个进入的 `agent-hook-event` / `devtools-synthetic-event` 落盘一份（环形 buffer 1000 条），含时间戳、agent、session_id、事件名、payload 摘要、synthetic 标记。
- **Panel 4 — PendingStore + AlwaysAllowStore**：当前 pending 权限请求列表、(agent, session) → 工具名集合。
- **Panel 5 — 手动合成事件发射器**：表单选 agent / session_id / 事件名 / payload → 通过 `devtools-synthetic-event` Tauri 事件广播。

砍掉的两个候选：
- **Panel 3（HTTP 服务器面板）** ——和 Panel 2 高度重叠（每个事件都来自 HTTP），真正的增量只有延迟和错误码，走 `tracing` 更轻量。
- **Panel 6（设置 dump）** ——完全和 Settings 窗口本身重复，零增量。

### D4. 独立 devtools webview 窗口

新增第 4 个 webview（`label: "devtools"`），200×800 或类似紧凑尺寸，compile-time gated 注册到 `tauri.conf.json` 和 `vite.config.ts`。**不放在主设置窗口里**——4 个 panel 加起来信息量大，混在用户设置 UI 里既污染体验又难以并排观察。

### D5. 访问模式：启动时自动 show，关闭 = hide（重启 app 重开）

- dev 构建启动时，Rust `setup` hook 里在创建 devtools webview 后立即 `.show().unminimize().set_focus()`。
- dev 窗口的生命周期**绑死在 app 进程**上：关闭 = hide（复用 `pet-bubble` 的 `CloseRequested` 拦截模式），重新点显示 = **只能重启 app**。
- 没有"Open DevTools"按钮——按钮不存在，重新打开窗口的唯一路径是重启进程（对一个开发者工具来说这是可接受的代价）。
- 不进托盘菜单——托盘已经有 5 个 item，再加一个挤。

> **Override（原决策已废）**：原 D5 要求"按钮驱动"——dev_mode 开 → Settings 窗口出现"Open DevTools"按钮 → 用户点击 → 窗口 show。改成自动 show 后整个交互链消失：少一次点击，少一个状态，少一个 UI 元素。

### D6. 合成事件：全局广播 + 信封包装

合成事件通过**新 Tauri 通道** `devtools-synthetic-event` 广播给所有窗口（包括 pet），dev 窗口和 pet 各自的 StateMachine 实例都照常处理。**pet 在 dev 模式下会响应合成事件**——这是 dev 工具的目的就是看系统反应，不让宠物反应等于砍一半调试能力。

表示上用**信封**包 canonical `HookEvent`：
```
{ event: HookEvent, synthetic: true, source: "devtools" }
```
- `HookEvent` 的 8 个 canonical 字段保持纯粹（这是和所有 agent adapter 的契约）。
- `synthetic` / `source` 是事件总线层 + Panel 2 日志的元数据。
- 状态机**不感知** `synthetic` 这个概念——它就是事件，进来了就处理。
- 真实事件走 `agent-hook-event`（不带信封），合成事件走 `devtools-synthetic-event`（带信封），两条管道物理分离。

### D7. Reset：dev 面板的 "Reset State Machine" 按钮

点一下广播 `devtools-reset` 事件，两个 StateMachine 实例都清空全部 session 状态 + Panel 2 事件日志**一并清空**。

`devtools-reset` **不是 canonical `HookEvent`**——它是控制平面操作（"管理员命令"），不进 8 字段的契约里。编译期 gated，发布构建里 Rust 不注册这个事件。

### D8. 数据同步：开窗 snapshot + 之后事件驱动

Panel 4 住在 Rust 侧，dev 面板需要 IPC 才能看。同步模型：

- 新增 compile-time gated Rust 命令：
  - `devtools_get_pending() -> Vec<PendingEntry>`
  - `devtools_get_always_allow() -> HashMap<(AgentId, SessionId), HashSet<String>>`
- 新增 compile-time gated Tauri 事件：
  - `devtools-pending-changed` —— `PendingStore` insert / remove 时 emit
  - `devtools-always-allow-changed` —— `AlwaysAllowStore` insert / clear 时 emit
- Dev 面板 `onMounted` 时调两个 snapshot 命令初始化，之后订阅两个事件增量更新。

Panel 1 / 2 / 5 都在 JS 侧（本地 StateMachine 实例 + 环形 buffer + Tauri 事件发射），不需要 Rust 介入。

## Considered Options

### D1 范围层

- Option A：运行时用户开关 + 隐藏。**（原决策，已废）** 实施后被推翻：toggle 是噪音，没有真实关闭场景。
- **Option B：纯编译期门控** ← 选。dev 模式就是 dev 模式，无运行时开关。
- Option C：mock agent / 事件模拟器。**否**：这是测试脚手架，不是调试面板。
- Option D：纯粹的 `tauri dev` 体验优化。**否**：范围太松，且大部分与 B 重叠。

### D2 生命周期层

- Option (a) 纯运行时设置。**否**：和 D1 B 矛盾，且发布构建里也存在 → 有泄露内部状态给生产用户的风险。
- **Option (b) 纯编译期 flag** ← 选。`dev-tools` Cargo feature + `import.meta.env.DEV` 任一为关 → 整个 dev 路径从产物中移除。
- Option (c) 混合（原 D2 决策，已废）。**否** (a) / (b) 的原因正是 (c) 失败的原因——混合增加了 UI 复杂度（toggle 状态、面板内容 gate）但没解决任何真实问题。

### D3 panel 范围层

- 全 6 个 panel。**否**：3 和 6 是冗余。
- 只 1 + 2（最简）。**否**：漏掉 4 等于权限流程不可调试，漏掉 5 等于不能针对性测状态机。
- 1 + 2 + 4 + 5 ← 选。

### D4 窗口形态层

- 主设置窗口加一个 dev tab。**否**：4 个 panel 信息量大，混进用户 UI 污染体验，且调试时要常开 + 切换到其他设置项很难受。
- 独立 webview 窗口 ← 选。
- pet 窗口加调试 overlay。**否**：pet 窗口 `pointer-events: none`，加 overlay 干扰命中区域（参见 [ADR-0004](./0004-per-file-hitbox.md)）。

### D5 访问模式层

- (i) Toggle 驱动（dev_mode on → 窗口自动出现）。**否**：原决策路径，已废。dev_mode 字段不存在。
- (ii) 按钮驱动（dev_mode on → Settings 出现"Open DevTools"按钮）。**否**：原决策路径，已废。按钮不存在。
- (iii) 托盘菜单驱动。**否**：托盘已经 5 个 item，再加一个挤。
- (iv) 首次自动 + 之后手动。**否**：和现在的"启动自动 show"接近但"之后手动"是多余的——重启 app 即可。
- **(v) 启动时自动 show** ← 选。dev 构建启动时 Rust `setup` 直接调 `.show().unminimize().set_focus()`，无任何用户交互。关闭 = hide（拦截 + hide），重开 = 重启 app。

### D6 合成事件作用域 / 表示层

**作用域：**
- (a) 仅本地（pet 无感）。**否**：dev 工具的目的就是看系统反应，不让宠物反应等于砍掉一半调试能力。
- (b) 全局广播 ← 选。
- (c) 每次可选（默认本地）。**否**：增加 UI 复杂度，多数人不会用 checkbox。

**表示：**
- (α) 污染 canonical（`HookEvent` 加 `_synthetic: bool`）。**否**：破坏和 agent adapter 的契约，状态机要决定是否看这个字段。
- (β) 信封包装 ← 选。**否** (α) 的原因正好是 (β) 的理由。

### D7 Reset 层

- (a) Reset 按钮 ← 选。
- (b) 每次手动合成 SessionStart 前先发 SessionEnd。**否**：用户负担，容易忘。
- (c) Session 加 TTL。**否**：改了状态机核心行为，影响真实事件处理路径。
- (d) 不管。**否**：dev 会话里点几下就状态污染，体验差。

### D8 同步模型层

- (i) 轮询。**否**：浪费 + 延迟。
- (ii) 纯事件驱动。**否**：dev 窗口打开时是空的，要等下一个事件。
- (iii) 开窗 snapshot + 事件驱动 ← 选。
- (iv) 仅 snapshot（手动刷新）。**否**：体验差。

## Consequences

### 实现成本

- **Rust 端**：
  - `Cargo.toml` 加 `dev-tools` feature
  - `lib.rs` / `http_server.rs` / 状态 store 改动点全部加 `#[cfg(feature = "dev-tools")]` gate
  - 4 个新 Tauri 命令（`devtools_get_*` 等）+ 4 个新事件（`devtools-*-changed` / `devtools-synthetic-event` / `devtools-reset`）
  - `PendingStore` / `AlwaysAllowStore` 的所有 insert / remove / clear 调用点（`http_server.rs` permission handler + `clear_always_allow_session`）加 compile-time gated emit
- **Tauri 配置**：
  - `tauri.conf.json` 新 webview `devtools` 声明（编译期 gated）
  - `vite.config.ts` 新 Rollup input
- **前端**：
  - 新 `devtools.html` 入口 + 新 Vue SFC 树（4 个 panel + Reset 按钮 + 事件日志环形 buffer）
  - pet.html 加 `devtools-synthetic-event` 监听 + `devtools-reset` 监听
  - 新增 1 个共享 JS 模块：把 `state-machine.js` 抽到 dev 窗口也能 import
  - **主设置窗口无任何 dev 相关 UI**（override 后的简化）

### 长期影响

- 状态机从 pet 窗口独占 → pet 窗口 + dev 窗口各持一份。两者通过同一 `agent-hook-event` 流保持镜像，但 dev 窗口会"污染"——合成事件会让 dev 窗口的 StateMachine 进入合成状态。
- 编译期 feature flag 增加了一个产品维度，未来如果需要"alpha 测试版"也可以复用同一个机制（代价：feature 多到一定数量后 `cfg` 分支会污染代码可读性）。
- 4 个 webview（main / pet / pet-bubble / devtools）是这个项目目前的极限——再加一个需要重新评估 Tauri 多 webview 的性能开销。
- dev 窗口启动时自动 show 是不可逆的——用户关掉后只能重启 app 重开。这是 dev 工具的合理代价，因为：(1) 调试本就是高频重启场景，(2) 没有"暂时关掉 dev 模式" 的合理需求。

### 已知边界

- Dev 窗口的 StateMachine 不会被 `clear_always_allow_session` 影响（那是真实 session 的清理路径）。dev 窗口自己维护的是合成 session 状态，只能通过 `devtools-reset` 清。
- 合成事件不会触发 `permission-request` 通道（Panel 5 的表单只产生 8 个 canonical 事件之一，**不能**直接产 `PermissionRequest`）——这是为了避免 dev 模式意外弹出真气泡。如果要测权限流程的真路径，用真 Claude Code session。
- 编译期 feature 关时，dev 窗口的 HTML entry 仍然存在于 `dist/`（Vite 不会因为 `import.meta.env.DEV` 删除文件），但 Tauri 不会注册这个 webview，URL 永远不会被加载。
