# 权限气泡重设计为"灵动岛式"极简 UX

权限气泡从"360×200 固定窗口 + JSON 详情 + 3 按钮"重设计为"灵动岛式药丸 + 按 kind 自适应主操作 + tray 图标下方位置跟随"，跨平台位置策略接受 macOS 顶部 / Windows 底部的原生差异，"类似灵动岛"是视觉/行为隐喻（药丸形态 + 展开过渡 + 多源堆叠）而不是地理约束。

## Status

accepted — 2026-06-25（grilling session）

## Context

ADR-0011 把 `PermissionRequest` 拆成 SideEffect / Elicitation / PlanReview 三种 kind 并按 kind 分发 UI，但**气泡的形态本身没变**——还是 360×200 固定窗口，对所有 kind 渲染"agent label + tool_name + JSON dump + 按钮"。这在两种场景下尤其痛：

1. **高频 SideEffect（Bash/Edit/Write/Read/Glob/Grep）**：用户每天面对几十次，每次都要"扫一眼 JSON 决定 Allow/Deny"——但 tool_input 里 80% 的内容用户**根本不关心**（"Bash 跑 npm test" vs "Bash 跑 rm -rf"才是真正决策点）。
2. **跨 kind 形态统一**：Elicitation 是多题表单，PlanReview 是 plan + 反馈——它们跟 SideEffect 用同一个 360×200 窗口显得**形态错位**。

参考 iPhone Dynamic Island 的设计语言（药丸形态、自适应展开、永远可见、视觉锚点），把气泡重设计为：
- **默认药丸**（~280×44）——只显示"工具图标 + 摘要 + 主操作"
- **按需展开**——click ⓘ 详情区进入全功能 UI
- **位置跟随 tray**——跨平台位置由 tray 图标决定（macOS 顶部、 Windows 底部），"灵动岛"是视觉/行为隐喻而非地理约束

## Decision

### 1. 设计范围

**全部 3 种 kind**（SideEffect + Elicitation + PlanReview）都走极简药丸设计。Elicitation/PlanReview 的"主操作"是"开始答 / 审阅 plan"——它们药丸上的"开始" / "审阅"键点击 = 展开。

### 2. 药丸主操作按 kind 分发（方案 C）

| Kind | 药丸布局 | 药丸主操作 |
|---|---|---|
| SideEffect | `[ⓘ 图标 + 工具名] [Allow] [Deny]` | 双键直接决策（不展开） |
| Elicitation | `[ⓘ 图标 + "问 N 题"] [开始]` | 单键 = 展开进表单 |
| PlanReview | `[ⓘ 图标 + "Plan ready"] [审阅]` | 单键 = 展开进 plan + 反馈 |

### 3. 窗口架构：单 webview 动态 resize

- 一个 Tauri webview（`permission-bubble.html`），CSS 控制药丸/展开形态
- 4 个固定 size 切换：药丸 280×44、SideEffect 展开 480×260、Elicitation 展开 720×480、PlanReview 展开 800×600
- 切换用 Rust 端 spring lerp 350ms 配 cubic-bezier(0.32, 0.72, 0, 1)（iOS 灵动岛曲线）
- 长内容走**内部 ScrollArea**——window size 永远固定

### 4. 位置策略：始终固定在 tray 图标正下方

**实现时简化（推翻 grill 时区分 normal/mini 模式的方案）**：
- **始终**：药丸在 tray 图标正下方 8pt，水平居中
  - 位置 = (tray.x + tray.width/2 - pill.width/2, tray.y + tray.height + 8)
- **不跟随 robot 窗口移动**（normal mode 拖 robot 不影响 bubble 位置）
- **不区分 mini mode**（mini 模式 toggle 不影响 bubble 位置）
- 每次 bubble show 时由 BubbleApp 调 `get_bubble_position` Rust command 拿一次位置

**简化理由**（实现时决定）：
- 跟 robot 走 = 药丸位置"飘忽"（用户拖 robot 时药丸跟着跳）
- 跟 mini mode 走 = 增加状态机分支但视觉收益小
- 始终跟 tray = 心智最简单："bubble 永远在 tray 旁边"，**用户**也能预测

**跨平台位置由 tray 决定**（ADR-0013 决策 G1）：
- macOS：tray 在顶部 menu bar → 药丸在屏幕顶部
- Windows：tray 在底部任务栏 → 药丸在屏幕底部
- Linux：tray 由 DE 决定（GNOME/KDE 顶部 panel）
- "类似灵动岛"是视觉/行为隐喻，不是"必须在屏幕顶部"的硬约束

**已知 follow-up**：
- 高 DPI 设备的 scale factor 处理（macOS 默认 1.0 缩放 OK；Windows/Linux 高 DPI 可能不准）
- Linux fallback 行为（tray.rect() 永远 None 时退到屏幕右下角，**已实现**）

### 5. 多气泡策略：单气泡 + 队列角标（H1）

- 始终只显示一个药丸（当前 request）
- 药丸**左侧**有 `+N` 圆角矩形徽章（macOS Sonoma 风格），显式 hover 高亮
- 点击角标 = 循环切到队列里下一个 request
- HTTP server `MAX_PENDING_REQUESTS = 50`，前端维护队列 mirror
- 队列**纯 FIFO**——不按风险/agent/session 分组

### 6. 药丸分两区布局（K1）

- 左侧 ⓘ 详情区：工具图标 + 摘要
- 右侧决策区：Allow/Deny（或单键"开始/审阅"）
- **单击 ⓘ 区** = 展开进全功能 UI
- **单击决策键** = 直接决策
- **焦点默认在 ⓘ 区**（不是 Allow 按钮）——避免 Enter 一键误 Allow

### 7. 决策后存活：fade-out 0.4s（M4）

- 鼠标按下 Allow/Deny → 药丸整体透明度 → 0 over 0.4s
- 零文字反馈（不显示"已通过"）——纯视觉动画
- 反馈期内新 request 到达 → 直接替换（M4 不阻塞队列推进）

### 8. 5 分钟超时：自动 deny（P1）

- HTTP server 阻塞 5min 后 → 后端自动给 agent 返回 `{behavior: "deny", message: "User did not respond within 5 minutes"}`
- 药丸变橙色"⏰ 已超时"反馈 → 1s 后 fade out
- 不做 30s 倒计时警告（避免视觉负担）

### 9. 键盘快捷键：基础键锁定 + 扩展键可改（R3）

- **不可改**（产品承诺）：`Enter` / `Esc` / `Tab`
- **可改**（settings UI 录制）：suggestion 数字键（1-9）、队列切换（`[` `]`）、`Cmd+Enter = Allow`
- 焦点策略：药丸出现时 `set_focus()` 抢焦点，默认焦点在 ⓘ 区
- Windows 需要 `AllowSetForegroundWindow` 配合（Windows 前台限制）

### 10. DND 模式不影响气泡（S1）

- DND 只影响 robot 自身的声音/动画（保持现有行为）
- permission 气泡永远正常工作——DND 是"不要被打扰"（被动通知），permission 是"必须响应"（agent 阻塞等决策），两者语义不同
- iPhone 类比：勿扰模式下闹钟仍响

### 11. 不做工具风险分级（T1）

- 读类/写类视觉统一——不分级
- 读类的"零决策成本"红利**不**通过主操作键数量实现
- 分级作为未来增强（v2）——v1 保持极简统一

### 12. Tauri 工程实现

- **tray 图标坐标**（X2）：平台特定
  - macOS：Tauri `TrayIcon::position()` API
  - Windows：包装 `Shell_NotifyIconGetRect`（Win 7+，2026 年不需考虑 Win 7 兼容）
  - Linux：包装 DBus `org.kde.StatusNotifierItem.GetItemGeometry`（v1 只支持 KDE/GNOME）
- **透明背景**（Y1）：`transparent: true` + `decorations: false` + `backdrop-filter: blur(20px) saturate(180%)`
  - CSS 降级：`@supports not (backdrop-filter: blur(20px))` fallback 到实色半透明
- **webview 焦点**（Z1）：气泡出现 → `set_focus()` 抢焦点 + 默认焦点 ⓘ 区 + 配滑入动画
- **resize 动画**（AA2）：Rust 端 spring lerp 350ms cubic-bezier(0.32, 0.72, 0, 1)

## Consequences

### 优点

- **决策路径更短**：SideEffect 一键 Allow/Deny 不展开，**高频路径**最优化
- **视觉锚点清晰**：药丸永远在视野自然落点（robot 旁边 / tray 下方），不"丢"
- **跨 kind 心智一致**：三种 kind 共享"药丸"隐喻，区别只在主操作
- **跨平台原生亲和**：macOS 顶部（灵动岛感）/ Windows 底部（跟系统通知一致）
- **审计能力预留**：决策完成时 emit Tauri event 给未来 audit logger 订阅（不实现持久化）

### 代价

- **工程实现量大**：tray position 平台特定实现 / 毛玻璃跨平台降级 / spring lerp Rust 端代码
- **macOS mini mode 仍需适配刘海**：tray 图标位置被刘海影响需要额外处理
- **Windows 焦点限制**：`AllowSetForegroundWindow` 需要最近用户交互该进程
- **快捷键记忆成本**：基础键锁定 + 扩展键可改的边界用户不一定理解

### 范围外（明确不做）

- **audit log 持久化**（a 方向）：这次只预留 hook point，不落盘不展示。建 `.scratch/feature-audit-log/issue.md` 跟踪
- **工具风险分级**（D 方案精神）：v1 统一形态
- **多气泡堆叠分裂**：单气泡 + 队列角标
- **倒计时警告**：5min 超时不做 30s 警告
- **Win 7 兼容**：tray position API 用 Win 7+ `Shell_NotifyIconGetRect`
- **Linux 非主流 DE**：v1 只测 KDE/GNOME

## Known Risks

- **Tauri 2 `TrayIcon::position()` Windows/Linux 实际行为未验证**——文档未明确说是否提供，实现时先验证；不可用就包装平台 API
- **Win 10 早期版本（< 1809）毛玻璃性能差**——`backdrop-filter: blur` 在老 DWM 上掉帧；CSS 降级只是视觉降级，**性能**降级需要评估
- **Linux Wayland 透明支持参差**——很多合成器（Mutter 尤其）限制窗口透明；Wayland 用户可能看到"硬切"边缘
- **Windows `AllowSetForegroundWindow` 限制**——用户最近没交互 uma 进程会被 Windows 拒绝；uma 进程需要保活策略
- **Spring lerp 主循环漂移**——`tokio::time::interval` 不精确；用 `tauri::async_runtime::spawn` + 手动 `Instant::now()` 控制
- **MacBook 刘海机器 tray 位置**——刘海区域的 tray 图标 y 略低，药丸 y 跟着偏移即可，但需要先实测

## Follow-ups

- `.scratch/feature-audit-log/issue.md` —— 跟踪 audit log 持久化
- 工具风险分级（v2 增强）
- 30s 超时倒计时（如果用户反馈"超时太突兀"再考虑）
- 多气泡灵动岛分裂（如果队列频繁 > 5 再考虑）
- Linux 更多 DE 适配（Hyprland / swaybar / XFCE）
