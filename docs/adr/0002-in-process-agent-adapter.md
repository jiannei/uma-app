# In-process agent adapter (B 模式)

每个 agent 在 Tauri 进程内有一个 Rust adapter 模块（`src-tauri/src/adapters/<agent>.rs`），封装 (a) agent 身份与配置文件位置、(b) hook 的 install/uninstall 流程、(c) 该 agent 原始 hook payload → canonical `HookEvent` 的归一化逻辑。Agent 通过编译期 `KNOWN_AGENTS: &[&dyn Agent]` 静态注册，运行时不可热加载。

## Status

accepted — 2026-06-24（grilling session）

## Context

uma-app 当前只支持 Claude Code 一个 agent，但用户明确表示会演化成多 agent（"像 uma-pet 那样"）。uma-pet 走的是**外部 hook 脚本**路线（每个 agent 一个 `hooks/<agent>-hook.js` Node.js 脚本，外部进程跑），Tauri 端只接收已归一化事件。uma-app 是 Tauri 团队自己掌控的桌面应用，"加新 agent"的责任应该落在 Tauri 代码里 —— 不应该把 agent 逻辑外迁到用户机器上的脚本。

事件归一化的"位置"是核心架构选择 —— 在哪一层把 agent 私有事件翻译成统一格式决定了：
- 状态机是否需要感知 agent 差异
- 加新 agent 是不是要重编 / 改外部脚本
- 部署物复杂度

## Decision

Tauri 内置 adapter，每 agent 一个 Rust 模块。HTTP server 收到 raw payload 后**按 agentId 路由到对应 adapter**，adapter 解析并归一化成 canonical `HookEvent`，再喂给状态机。状态机只看 canonical 形式，**不感知具体 agent 的事件词汇**。

## Considered Options

- **Option A：外部 hook 脚本**（uma-pet 的方式）。每个 agent 的 hook 脚本作为独立 Node.js / shell 进程跑，自己翻译事件后 POST 到 Tauri HTTP。Tauri 极薄，但 agent 逻辑散落在用户机器上，"加 agent" ≠ "改 Tauri 代码"。
- **Option C：每 agent 独立状态机**。不归一化，状态机按 agentId 复制，每 agent 自己的 `EVENT_TO_STATE`，meta 层聚合。B 模式的"状态机不感知 agent"承诺就破了。
- **Option D：配置驱动**（`agents.toml` + 解释器）。所有 agent 行为在 TOML 配置里，状态机按配置查表。失去类型安全，"复杂逻辑用表达式"那个洞很快变成漏洞。
- 选了 Option B：in-process adapter，编译期静态注册。

## Consequences

- 加新 agent = 在 `adapters/<agent>.rs` 写一个新模块 + 在 `KNOWN_AGENTS` 注册一行，**必须重编 Tauri**。这是有意的约束 —— agent 适配逻辑跟 Tauri 版本同步发布，避免"agent 脚本跟 Tauri 行为漂移"的分布式一致性问题。
- `Agent` trait 是一等公民：每 agent 都得实现同一组方法（`id` / `display_name` / `config_path` / `is_installed` / `install` / `uninstall` / `parse_state_payload` / `parse_permission_payload` / `build_permission_response`）。trait 演进时所有 adapter 同步更新，编译期保证。
- 部署物是单一 Tauri 二进制，**没有**"用户装完 Tauri 还得装 N 个 agent hook 脚本"的体验问题。
- 不能热加载 agent —— 改 adapter 必须重编发版。如果未来要支持第三方写 agent 插件（用户 / 公司内其他团队），这个 ADR 需要 revisit 并升级到"plugin model"，目前不预设。
