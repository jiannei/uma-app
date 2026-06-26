# 权限气泡重设计为 tray-anchored popover

权限气泡从 ADR-0013 的"macOS 系统对话框 + spring lerp + 4 size 切换"重设计为"tray icon 数字角标 + 永远锚定 tray 水平中线的 popover + 1 队列头 + 完全弹性高度 + spring 弹性动画 + popover 内承载全部 3 种 kind"。"类似灵动岛"从 ADR-0013 的"视觉隐喻"升级为"tray 锚点不变 + 弹性的真实物理隐喻"——popover 永远从 tray icon 长出来。

## Status

accepted — supersedes ADR-0013 (2026-06-26，grilling session)

## Context

ADR-0013 把权限气泡设计成"macOS 系统对话框" + 4 个固定 size 切换 + 350ms spring lerp，配 +N 角标（macOS Sonoma 风格）。代码实现走了一条**完全不同的路**（Sonner toast 堆叠 + 480×360 固定 webview + click-through + 工具风险分级 3s auto-allow），代码跟 ADR-0013 至少有 4 处矛盾：

| 项 | ADR-0013 | 代码实际 |
|---|---|---|
| 多气泡策略 | 始终只显示一个药丸 + `+N` 角标 | Sonner 多 toast 堆叠 |
| 工具风险分级 | 不做（T1 明确拒绝） | **做了**——低风险 3s auto-allow |
| 窗口尺寸 | 4 个固定 size 切换 + spring lerp | 永久固定 480×360 + click-through |
| 键盘 | Enter / Esc / Tab 锁定 | 只挂了 Esc |
| 5min 超时反馈 | 橙色"⏰ 已超时"反馈 | 只 dismiss toast，**无反馈** |

代码偏离 ADR-0013 不是偶然——它解决了 ADR-0013 的一些根本问题（resize/position race 彻底消失、毛玻璃跨平台降级简单），但**走得太散**（无统一隐喻、无 1 队列头约束、3 种 kind 在 popover 内如何区分没设计）。

这次 grilling 在 ADR-0013 的"系统对话框"和代码的"sonner 堆叠"之间找出**第三条路**：

- **隐喻升级**——从"假装是系统对话框"升级为"从 tray icon 长出来的 popover"（更接近 macOS 通知中心 + iOS Live Activity 的体验）
- **物理一致**——所有 3 种 kind 都在 popover 内演化形态，**不切窗口**，**不切隐喻**
- **A 路线精神**——modal 强制响应，agent 阻塞等待
- **1 队列头**——popover 永远只显示当前 request，多请求排队显式可见
- **完全弹性高度**——popover 高度 = 内容高度，不人为固定

## Decision

### 1. 设计范围

**全部 3 种 kind**（SideEffect + Elicitation + PlanReview）都在 popover 内演化形态：
- **小态（pill 80pt）**——工具图标 + 摘要 + Allow/Deny（或单键"开始/审阅"）
- **中态（SideEffect 详情 200pt）**——展开工具输入详情
- **大态（Elicitation 5 题 / PlanReview 长 plan 600pt）**——多内容 + ScrollArea 内部滚

**不切窗口**——80pt → 200pt → 600pt 都在同一个 Tauri webview 内 resize 动画。

### 2. 视觉隐喻：tray-anchored popover（不是"菜单栏图标变身"）

最初讨论"菜单栏图标变身"——但实际**图标不变**，**只**加数字角标（微信风）。"变身"是隐喻而非物理动作：

- **icon 本体永远不变**（盾形 / 问号 / 勾选的状态切换被否决——状态切换太频繁会"动"分散注意力）
- **数字角标** = pending request 数量（macOS 13+ `setBadgeCount`，Windows `Shell_NotifyIcon` badge overlay）
- **popover 从 tray icon 正下方 8pt 处展开**（不是"tray icon 物理变身"）

参考 iPhone Dynamic Island 的"已有元素扩展"精神，但**不走系统级屏幕顶部**（那是 ADR-0013 候选 D 的位置策略）——**tray 在哪，popover 在哪**。

### 3. 队列策略：1 队列头（始终只显示当前）

| 决策 | 推论 |
|---|---|
| **popover 永远只显示当前 request** | 不存在"同时 3 个 popover 堆叠" |
| **多请求 FIFO 排队** | 到达时间 = 处理顺序（**不**按风险 / agent / session 分组） |
| **数字角标 N 显式提示** | 用户看到"还有 N 个"，但**不**能挑肥拣瘦（A 路线精神） |
| **不做工具风险分级** | 读 / 写走同一路径（推翻代码的 3s auto-allow） |

**为什么不做风险分级**——读 / 写视觉统一；"读类的零决策成本"不通过主操作键数量实现；分级作为未来 v2 增强。

### 4. 位置策略：永远锚定 tray icon 水平中线

```
position.x = tray.x + tray.width/2 - popover.width/2
position.y = tray.y + tray.height + 8
```

- **永远锚定 tray**——tray 在哪屏（多显示器）popover 在哪屏
- **不跟随 robot 窗口**——拖 robot 不影响 bubble
- **不区分 mini mode**——mini mode toggle 不影响 bubble
- **水平智能调**——bubble 右边不超屏幕边 16pt（贴近时向左偏）
- **最大高度**——"屏幕底部 - 80pt"（约 700-800pt 看屏幕高度）

**跨平台位置**：
- **macOS**：menu bar 顶部 → popover 在屏幕顶部下方
- **Windows 11**：taskbar 可顶 / 底 / 侧 → popover 朝 taskbar 相反方向展开
- **Linux**：跟 DE（GNOME / KDE 顶部 panel）
- **tray.rect() 永远 None** 时（Linux fallback）退到屏幕右上角

### 5. 高度模型：完全弹性（高度 = 内容高度）

| 内容 | popover 高度 |
|---|---|
| pill 小态 | 80pt |
| SideEffect 详情 | ~200pt（tool icon + tool_input 一行 + Allow/Deny） |
| Elicitation 1 题 | ~280pt（question + options） |
| Elicitation 5 题（已答 4 + 当前 1） | ~360pt（4×24 折叠 + 280 当前） |
| PlanReview 3000 字 | 600pt（内部 ScrollArea 滚，**不**撑到 3000pt） |

**内部 ScrollArea**——长内容自动滚动；window size 由"内容必要高度"决定，**不**人为固定 4 个 size（推翻 ADR-0013 决策 3）。

### 6. PlanReview 安全机制：滚到底才解锁 Approve

| 场景 | 行为 |
|---|---|
| plan 高度 < 弹窗可用高度 | **自动解锁**（用户 1 屏可见） |
| plan 高度 ≥ 弹窗可用高度 | 滚到底才解锁 Approve |
| 任何场景 | Deny 按钮**始终可点**（不需要"看完"才能拒绝） |

**视觉提示**——plan 底部加渐隐遮罩 + "↓ scroll to read more"，滚到底后遮罩消失。

**为什么不用**复选框 / 时间阈值 / 二次确认：
- 复选框可"无脑勾"——心理学实验证明 checkbox 不防呆
- 时间阈值可"挂机等"——3 秒真读不完 3000 字
- 二次确认是反模式——双重 modal 烦
- 强制反馈剥夺"觉得 plan OK 直接 Approve"的简单路径

### 7. 动画：spring 弹性（单套参数）

```
stiffness: 280
damping:   24
mass:      1.0
```

| 距离 | 落点时间 | overshoot |
|---|---|---|
| 80pt→200pt（Δh 120） | ~320ms | ~8% |
| 80pt→600pt（Δh 520） | ~480ms | ~3% |
| 600pt→80pt（Δh -520） | ~480ms | ~4% |

**单套参数的理由**——spring 自动适配距离（短程弹得"活泼"、长程弹得"稳重"），**不**需要双套。

**回落（600pt→80pt）的弹性收回**比 ease-out 更有"被决定"的感觉，强化"刚刚发生了一次决策"。

**macOS 慢设备降级**——低于 30fps 时降级为 ease-out（`@media (prefers-reduced-motion: reduce)` 风格）。

### 8. Elicitation 内部模型：当前题展开 + 已答题折叠

```
[ Q1: Header ...]                    ← 折叠：24pt
[   ✓ Yes (Accept)                   ]
[─────────────────────────────────────]
[ Q2: Header ...]                    ← 折叠：24pt
[   ✓ No (Deny)                      ]
[─────────────────────────────────────]
[ Q3: Header ...]                    ← 当前展开：~280pt
[   ( ) Option A                     ]
[   ( ) Option B                     ]
[   ( ) Option C                     ]
[─────────────────────────────────────]
[ Q4: ...        Q5: ...]            ← 未答预览：48pt（2 行 × 16pt）
```

| 状态 | 行为 |
|---|---|
| 答完 Q1 | Q1 折叠成"Q1 ✓: Yes (Accept)"1 行（24pt） |
| 答完 Q1-4 | 4 行折叠 + Q5 当前展开 = ~380pt |
| 全部 5 题答完 | 5 行折叠 + "全部答完 ✓" toast（800ms）+ Submit 常驻 |
| 改已答题 | 点折叠行 = 重新展开（自动折叠当前题） |
| 进度可见性 | Q3-5 灰条预览（"Q3: ⏳"），用户知道"还剩几题" |

**5 题 × 24 + 280 当前 = 400pt**——比"5 题全展开 800pt"（方案 D）友好太多。

### 9. 按钮出现时机：100% 高度 + 80ms fade in

| 距离 | 行为 |
|---|---|
| 短程（< 200ms 距离） | **跳过 80ms fade**——按钮跟 spring 一起出现 |
| 长程（≥ 200ms 距离） | spring 落定后 80ms fade in |
| 任何场景 | hover 从 0ms 即可（光标与动画重叠，"准备动作"和"动画"重叠） |

**为什么不用**置灰 / 提前 fade / always-clickable：
- **置灰**（方案 C）——现代 UI（iOS / macOS Sonoma）早就放弃 disabled 态，用"未达条件不渲染"替代
- **提前 fade**（方案 B）——按钮"在动画里"视觉不一致
- **always-clickable**（方案 D）——动画被打断，视觉错乱

### 10. 键盘模型（**deferred to v2**）

> 2026-06-26 grilling 讨论到此话题时考虑过 `a`→Allow / `d`→Deny 字母键方案，**用户决定 v1 不实现键盘快捷键**——所有交互通过鼠标点击 + 系统焦点。理由：v1 先把 tray-anchored popover 形态跑通，键盘模型作为 v2 增强。

v2 占位（待下次 grill）：
- **不可改**：Enter / Esc / Tab
- **可改**（settings UI 录制）：数字键 1-9（suggestion 选中）、`[` `]`（队列切换）、`Cmd+Enter` = Allow
- **焦点策略**：popover 出现 → `set_focus()` 抢焦点，默认焦点在右下角主操作
- **Windows 焦点限制**：`AllowSetForegroundWindow` 配合

### 11. 跨平台位置策略（**已固化 2026-06-26**）

> 2026-06-26 grilling 决策链：B 路线（tray 移动 → bubble 自动重新 show）+ tauri-plugin-positioner 2.3.2（项目已带此依赖）+ B 路线（Linux X11 完整 + Wayland 降级）。

#### 11.1 API 选型：tauri-plugin-positioner

**项目已带此依赖**（`src-tauri/Cargo.toml:18`）：

```toml
tauri-plugin-positioner = { version = "2", features = ["tray-icon"] }
```

`Position::TrayBottomCenter` 直接对应 ADR-0014 决策 4（永远锚定 tray icon 水平中线）——**不需要平台 API fallback，不需要自己算 tray 坐标**。

当前 bubble 误用 `Position::TopCenter`（屏幕顶部居中，非 tray 锚定，见 `src-tauri/src/lib.rs:635`）——**实施时改为 `TrayBottomCenter`**。

#### 11.2 实施模式

```rust
use tauri_plugin_positioner::{Position, WindowExt};

// Show bubble
bubble.move_window(Position::TrayBottomCenter)?;
// +8pt 垂直偏移（决策 4 规定）
let pos = bubble.outer_position()?;
bubble.set_position(pos.translate(0, 8))?;

// Re-position on tray move（决策 B：tray 移动 → bubble 重新 show）
fn on_tray_event(app: &AppHandle, event: &TrayIconEvent) {
    if let TrayIconEvent::Move { .. } = event {
        if let Some(bubble) = app.get_webview_window("permission-bubble") {
            let _ = bubble.move_window(Position::TrayBottomCenter);
            if let Ok(pos) = bubble.outer_position() {
                let _ = bubble.set_position(pos.translate(0, 8));
            }
        }
    }
}
```

**⚠️ 已知问题（2026-06-26 实测发现）**：build time 设置位置**不够**——`tauri-plugin-positioner` 通过 `on_tray_event` 记录 tray 位置，但**app 启动后第一次 tray 事件**（click / move）才会更新。devtools 触发 synthetic permission request 时（用户没 click 过 tray），plugin 返回未初始化的 tray 位置，bubble 出现在屏幕左上区。

**修复**：在 `lib.rs` 加 Rust command `position_bubble_at_tray`（同段逻辑），JS 端 `show()` 时调用——**每次 show 重新定位**。

#### 11.3 高 DPI / 多显示器

**Tauri-plugin-positioner 内部已处理**（它用 Tauri 的 `WebviewWindow::outer_position()` 返回 logical 坐标，自动转换 scale factor）：
- macOS Retina：positioner 返回 logical 坐标，无需手动除 scale factor
- Windows per-monitor DPI：positioner 跟当前 monitor 的 scale factor
- 多显示器：positioner 检测 tray 所在 monitor，bubble 锚定到该 monitor

**v1 不需要单独处理 DPI 转换逻辑**——这层抽象已经被 Tauri + positioner 消化。

#### 11.4 Linux 策略：X11 完整 + Wayland 降级

| Linux DE | tray 位置 | 透明背景 | v1 行为 |
|---|---|---|---|
| **GNOME X11** + appindicator 扩展 | ✅ 精确 | ✅ 支持 | **完整** |
| **KDE Plasma X11** | ✅ 精确 | ✅ 支持 | **完整** |
| **GNOME Wayland** | ⚠️ best-effort | ❌ 合成器限制 | **降级**——弹 toast 提示"Wayland 模式位置可能不精确" |
| **KDE Plasma Wayland** | ⚠️ best-effort | ⚠️ 部分支持 | **降级**——同上 |
| **Hyprland / swaybar** | ❌ 不支持 tray position API | ❌ | **v1 不支持**——README 标注 |
| **XFCE** | ❌ | ⚠️ | **v1 不支持**——README 标注 |

**Wayland 降级** = 弹窗仍能弹出（基于 `Position::TrayBottomCenter` 在 Wayland 上的 best-effort 计算），但：
- 位置可能不精确（"硬切"在屏幕某处）
- 透明背景可能失效（popover 边缘可见）
- 用户**不会被阻塞**——v1 接受降级

**tray 位置 API 失败时（返回 None）**——退到**屏幕右上角**（tray area 不可知时的兜底）——v1 接受。

#### 11.5 tray 移动处理（决策 B）

**实施**：注册 `tauri-plugin-positioner::on_tray_event` 回调到 `lib.rs::setup` 钩子，监听 `TrayIconEvent::Move` 事件，**重新调用 `move_window(TrayBottomCenter)`**。

**注意**：`on_tray_event` 回调**已有**在 `src-tauri/src/tray.rs:80`——目前只是喂给 positioner 让它内部知道 tray 位置变了。**实施时把"重新定位 bubble"逻辑加进这个回调**。

#### 11.6 离屏保护

`move_window` 后 bubble 仍可能在屏幕外（极少场景：tray 接近屏幕边时 `TrayBottomCenter` 推出屏幕）。**实施时**加：

```rust
// 离屏保护：bubble 超出可见 monitor → 重新定位
if let Ok(monitor) = bubble.current_monitor() {
    let bubble_pos = bubble.outer_position()?;
    let bubble_size = bubble.outer_size()?;
    let mon_pos = monitor.position();
    let mon_size = monitor.size();
    if bubble_pos.x + (bubble_size.width as i32) > mon_pos.x + (mon_size.width as i32)
        || bubble_pos.y + (bubble_size.height as i32) > mon_pos.y + (mon_size.height as i32) {
        // 离屏：退回屏幕中心
        let _ = bubble.move_window(Position::Center);
    }
}
```

**v1 接受这个保护**——`Position::Center` 退化保证"至少不消失"。

#### 11.7 跳过的 grill 子约束

- **8pt 垂直偏移**：跟 `move_window` 配合使用（实施代码如 11.2 所示）
- **macOS 刘海**：刘海区域的 tray icon y 略低，`TrayBottomCenter` 自动包含这个偏移（macOS 系统级处理）——v1 不需特殊处理
- **Windows 11 taskbar 侧边**：positioner 内部处理（Windows tray position API 包括任务栏 4 个边）——v1 不需特殊处理

### 12. 3 种 kind 视觉 token（**已固化 2026-06-26**）

> 2026-06-26 grilling 决策链：C 路线（universal 中性，3 kind 共用 1 套色板，靠 icon 区分）+ B 路线（Lucide + 细化 tool icon）+ C 路线（暗色 / 亮色**跟 system 走**——撤回我之前"macOS menu bar 永暗"的错误前提）。

#### 12.1 universal 中性

3 种 kind 视觉上**不靠颜色区分**——kind icon + tool icon + 工具名文字三重线索。色板**只有 1 套**（不分 kind tint）。

#### 12.2 icon 库 + 映射

库：**Lucide**（`lucide-vue-next`，已在 `package.json`）

| 场景 | icon |
|---|---|
| SideEffect fallback（无 tool_name） | `Shield` |
| Elicitation fallback | `HelpCircle` |
| PlanReview fallback | `ClipboardList` |
| Bash | `Terminal` |
| Edit | `Pencil` |
| Write | `FilePen` |
| Read / MultiRead | `Eye` |
| Glob | `FileSearch`（**新**，替代共用 `Search`） |
| Grep | `TextSearch`（**新**，替代共用 `Search`） |
| WebSearch | `Globe` |
| WebFetch | `Globe` |
| Task | `ListTodo` |
| 未知 tool_name | 退化到 `kind` icon（Shield / HelpCircle / ClipboardList） |

**Glob / Grep / WebSearch / WebFetch 的 design debt**：WebSearch 和 WebFetch 都用 `Globe`；Glob 和 Grep 用 `FileSearch` / `TextSearch` 区分；WebSearch vs WebFetch 靠 popover 摘要里"WebSearch: ..." vs "WebFetch: ..."文字兜底。

Action icon：
- Allow：`Check`
- Deny：`X`
- 展开 Elicitation / PlanReview：`ArrowRight` / `ClipboardCheck`
- 折叠（已答题）：`ChevronUp`

#### 12.3 暗色色板（macOS dark / Windows dark / Linux dark）

| Token | Value | 用途 |
|---|---|---|
| `--bubble-bg` | `rgba(28, 28, 30, 0.78)` | pill + expanded 背景 |
| `--bubble-bg-solid` | `#1C1C1E` | `@supports not (backdrop-filter)` fallback |
| `--bubble-text` | `#F5F5F7` | 主文字 |
| `--bubble-text-muted` | `rgba(235, 235, 245, 0.6)` | 摘要 / caption |
| `--bubble-divider` | `rgba(255, 255, 255, 0.08)` | pill 内部分隔线 |
| `--bubble-btn-hover` | `rgba(255, 255, 255, 0.08)` | 按钮 hover |
| `--bubble-allow` | `#4ADE80` | Allow 按钮（绿 400） |
| `--bubble-allow-hover` | `rgba(74, 222, 128, 0.18)` | Allow hover |
| `--bubble-deny` | `#F87171` | Deny 按钮（红 400） |
| `--bubble-deny-hover` | `rgba(248, 113, 113, 0.18)` | Deny hover |
| `--bubble-focus` | `rgba(255, 255, 255, 0.4)` | 焦点环 |
| `--bubble-backdrop` | `blur(20px) saturate(180%)` | 毛玻璃 |
| `--bubble-shadow` | `0 4px 16px rgba(0, 0, 0, 0.32)` | pill 阴影 |
| `--bubble-shadow-expanded` | `0 8px 32px rgba(0, 0, 0, 0.48)` | expanded 阴影 |

#### 12.4 亮色色板（macOS light / Windows light / Linux light）

| Token | Value | 用途 |
|---|---|---|
| `--bubble-bg` | `rgba(255, 255, 255, 0.85)` | pill + expanded 背景 |
| `--bubble-bg-solid` | `#FFFFFF` | fallback |
| `--bubble-text` | `#1D1D1F` | 主文字 |
| `--bubble-text-muted` | `rgba(60, 60, 67, 0.6)` | 摘要 / caption |
| `--bubble-divider` | `rgba(60, 60, 67, 0.18)` | 分隔线 |
| `--bubble-btn-hover` | `rgba(60, 60, 67, 0.08)` | 按钮 hover |
| `--bubble-allow` | `#22C55E` | Allow 按钮（绿 500） |
| `--bubble-allow-hover` | `rgba(34, 197, 94, 0.18)` | Allow hover |
| `--bubble-deny` | `#EF4444` | Deny 按钮（红 500） |
| `--bubble-deny-hover` | `rgba(239, 68, 68, 0.18)` | Deny hover |
| `--bubble-focus` | `rgba(0, 122, 255, 0.6)` | 焦点环（macOS 系统蓝） |
| `--bubble-backdrop` | `blur(20px) saturate(180%)` | 毛玻璃 |
| `--bubble-shadow` | `0 4px 16px rgba(0, 0, 0, 0.10)` | pill 阴影 |
| `--bubble-shadow-expanded` | `0 8px 32px rgba(0, 0, 0, 0.16)` | expanded 阴影 |

**暗色 / 亮色差异化理由**：
- **Allow 绿**暗色 #4ADE80 / 亮色 #22C55E——暗色环境用**更亮**的绿保持可读；亮色环境用**更深**的绿保证对比度
- **焦点环**暗色用白 / 亮色用 macOS 系统蓝——A 路线"键盘焦点可见"是核心
- **背景透明度**暗色 0.78 / 亮色 0.85——亮色下稍微实一点，避免被底下内容穿透

#### 12.5 字号 token

| Token | Size | 用途 |
|---|---|---|
| `--font-pill-label` | 12px / 600 | pill 工具名（"Bash"） |
| `--font-pill-summary` | 10px / 400 mono | pill 工具输入摘要 |
| `--font-pill-btn-icon` | 14px | pill 按钮 icon |
| `--font-title` | 14px / 600 | expanded 标题 |
| `--font-body` | 13px / 400 | expanded 正文 |
| `--font-caption` | 11px / 400 | expanded caption |
| `--font-btn` | 13px / 500 | expanded 按钮文字 |

#### 12.6 间距 / 圆角 / 阴影

| Token | Value | 用途 |
|---|---|---|
| `--space-xs` | 4px | icon / 文字间距 |
| `--space-sm` | 8px | 元素间距 |
| `--space-md` | 12px | 段落间距 |
| `--space-lg` | 16px | section 间距 |
| `--space-xl` | 24px | major section |
| `--radius-pill` | 22pt | pill 小态圆角（=80pt/2 减 margin） |
| `--radius-expanded` | 14pt | expanded 圆角（保留 pill feel 但更像"卡片"） |
| `--radius-btn` | 50% | 圆形 icon button |
| `--radius-input` | 8pt | 输入框 |

**阴影 elevation**——expanded 比 pill 高一档（8px blur vs 4px blur），**视觉上 expanded 比 pill "更重"**，符合 A 路线强制响应精神。

### 13. 事件流（**已固化 2026-06-26**）

> 2026-06-26 grilling 决策链：A 路线（5min 连续计时，server 权威）+ A 路线（popover inline 反馈，alarm icon 闪烁 1.5s，无文字）。

#### 13.1 server 端 5min 连续计时

- HTTP server `POST /agents/{id}/permission` 阻塞 5min
- **不受 client 交互影响**——server 权威
- 超时 → server 自动 `deny` + emit `permission-timeout` event

#### 13.2 客户端状态机

```
States:  hidden | pill | expanded

Events:
  permission-request  (server → client) — 新请求
  permission-timeout  (server → client) — 5min 到，server 已 auto-deny
  user-decide         (client → server) — invoke respond_permission
  user-expand         (UI only)         — pill → expanded
  user-collapse       (UI only)         — expanded → pill

Transitions:
  hidden + permission-request → pill
  pill + permission-request → pill (queue.append，数字角标 +1)
  pill + user-decide → invoke respond_permission + queue.advance
    → pill (if queue not empty) | hidden (if empty)
  pill + permission-timeout → alarm 闪烁 1.5s + queue.advance
    → pill | hidden
  pill + user-expand → expanded (spring 撑高)
  expanded + user-decide → invoke respond_permission + queue.advance
    → expanded (下一条) | hidden
  expanded + permission-timeout → alarm 闪烁 1.5s + queue.advance
    → expanded (下一条) | hidden
  expanded + user-collapse → pill (spring 收回)
```

**queue 永远 FIFO by 到达时间**——**新请求不中断当前**（用户必须完成当前 decision 才能看下一条），跟决策 3 一致。

#### 13.3 popover 复用策略

popover show 时 `move_window(TrayBottomCenter)` + 8pt 偏移（决策 11）；**queue advance 时复用同一 popover 实例**——**不**关掉重开。

- 决策完成 → spring 收回 80pt → 立刻 spring 展开到新 request 高度
- **spring 始终从 80pt 起跳**（不接力上次的 expanded 高度）——保证每次出现都是"小态 → 目标高度"

#### 13.4 alarm icon 闪烁规格

| 属性 | 值 |
|---|---|
| icon | Lucide `AlarmClock` |
| 位置 | popover 顶部 32pt banner |
| 文字 | **无** |
| 闪烁周期 | 0.4s（1 ↔ 0.3 opacity） |
| 持续时间 | 1.5s（约 4 次闪烁） |
| 之后 | banner fade out 200ms + popover spring 收回 80pt + queue.advance |

#### 13.5 sub-decision 4 项

| 场景 | 行为 |
|---|---|
| **session 结束清理** | robot 监听 `SessionEnd` → `invoke('clear_always_allow_session', { agent, sessionId })` → 清理 `(agent, session)` 的 allow set（不持久化）——跟 ADR-0003 一致 |
| **Elicitation 展开态超时** | alarm 闪烁 in popover 顶部 banner；Q1-Q3 已答答案**随超时丢失**（v1 不重发同 Elicitation）；1.5s 后整 popover 收回 → 推进 |
| **PlanReview 展开态超时** | alarm 闪烁；plan **滚动位置不保留**（v1 简单 = 全部重置）；1.5s 后收回 → 推进 |
| **多请求同时 timeout** | N 条同时 timeout = alarm 闪烁 + 推进 N 次；每次 1.5s 间隔（不重叠）；最后一条后 popover hide |

#### 13.6 跨决策联动

| 联动 | 行为 |
|---|---|
| 决策 4 × 13 | popover show 时 `move_window(TrayBottomCenter)` + 8pt 偏移；queue advance 复用同一 popover 实例 |
| 决策 5 × 13 | popover 高度 = 当前 request 高度；queue advance 时 spring 从 80pt 起跳 |
| 决策 6 × 13 | PlanReview 滚动位置不跨 request 保留（新 requestId = 新 plan，重置滚动） |
| 决策 7 × 13 | queue advance 用 spring 收回 80pt → spring 展开到新高度；连续点击 = 动画打断重启 |
| 决策 8 × 13 | Elicitation 已答 Q1-Q3 折叠状态**不**跨 request 保留（下一条 Elicitation 是新 request，**重置**为初始 1 题展开） |
| 决策 9 × 13 | popover 出现时按钮 fade in；queue advance 时按钮 fade in 仍走同套规则（100% 高度 + 80ms fade） |
| 决策 11 × 13 | `on_tray_event` Move 事件 → 重新 `move_window(TrayBottomCenter)`（**不**触发 queue advance；tray 移动 ≠ 新请求） |

## Consequences

### 优点（vs ADR-0013）

- **tray 锚点永远一致**——popover 永远从 tray 长出来，**视线不跳**
- **1 队列头统一隐喻**——3 种 kind 共享"popover"形态，区别只在内容
- **不切窗口**——80pt → 200pt → 600pt 单 webview 演化，**消除 resize/position race**
- **完全弹性高度**——popover 高度 = 内容高度，**不**人为固定
- **spring 弹性的"有重量"感**——A 路线"准备好再决定"精神强化
- **跨平台实现更简单**——单 webview + tray position 检测，**不**需要 4-size 切换
- **代码偏离 ADR-0013 的隐喻统一**——Sonner toast 堆叠和风险分级被淘汰，3 种 kind 重新走同一路径

### 代价（vs ADR-0013）

- **Elicitation 折叠态认知**——"Q1 答完 = 折叠成 1 行"用户需要 1-2 次学习
- **PlanReview 滚到底才解锁**——用户可能误以为"按钮坏了"
- **macOS mini mode 不影响 bubble**——如果用户期待"mini 时 bubble 跟着 mini 走"会失望
- **Webview 持久显示 + click-through**——Tauri webview 必须永久 ready，资源占用
- **tray position 跨平台实现**——Windows / Linux 需要包装平台 API

### 推翻的 ADR-0013 决策

| ADR-0013 决策 | 推翻理由 |
|---|---|
| 决策 3：4 个固定 size + spring lerp 350ms | 完全弹性高度（决策 5）+ 单 webview resize |
| 决策 4：mini mode 不影响 bubble 位置 | 保留（决策 4）——一致 |
| 决策 5：单气泡 + +N 角标 | 改为：1 队列头 + 数字角标（决策 3）——隐喻升级 |
| 决策 7：fade-out 0.4s | 改为：spring 弹性收回（决策 7）——A 路线精神强化 |
| 决策 8：5min 超时橙色反馈 | 改为：alarm icon 闪烁 in popover（决策 13.4） |
| 决策 9：键盘 Enter / Esc / Tab 锁定 | 保留（决策 10 占位） |
| 决策 10：DND 不影响气泡 | 保留 |
| 决策 11：不做工具风险分级 | 保留（决策 3）——推翻代码偏离 |
| 决策 12：tray position 平台特定 | 保留（决策 11 占位） |

## Known Risks

- **tray position 平台 API 实际行为**——macOS `TrayIcon::position()` 在 Windows / Linux 上是否提供需实现时验证；不可用就包装平台 API
- **Win 10 早期版本（< 1809）spring 性能差**——降级为 ease-out 是必要 fallback
- **Linux Wayland 透明支持参差**——Mutter 等合成器限制窗口透明，popover 边缘可能"硬切"
- **MacBook 刘海机器**——刘海区域的 tray icon y 略低，popover y 跟着偏移即可，需要实测
- **spring overshoot 视觉夸张**——短程 8% overshoot 在某些 macOS 显示器上可能"弹得过头"
- **tray icon 离屏幕边太近**——水平智能调偏移可能让 popover 中心偏离 tray 中心，用户感觉"bubble 不在 tray 下面"

## Follow-ups

- **键盘模型**（决策 10）——**deferred to v2**（v1 不实现）
- **撤回 ADR-0013 决策 8 修订**（5min 超时反馈）——**已固化**：改为 alarm icon 闪烁 in popover（决策 13.4）

### 2026-06-26 grilling session 修订：撤回决策 4（位置策略）

**动机**——用户觉得"tray 锚定 + on_tray_event Move + 离屏保护 + Linux DE fallback"合计 ~200 行跨平台代码过重，重新评估后认为"屏幕顶部居中"够用。

**撤回的决策**：
- 决策 4（位置策略：永远锚定 tray icon 水平中线）
- 决策 11（跨平台位置策略：tauri-plugin-positioner + on_tray_event Move + 离屏保护）

**新位置策略**：
- **主显示器水平居中**——`position.x = primary.width/2 - bubble.width/2`
- **统一 y 偏移 8pt**——`position.y = 8`，跨平台一致
- **保留 `tauri-plugin-positioner` 依赖**——用 `Position::TopCenter`（项目已在 `lib.rs:635` 用过），**不**用 `Position::TrayBottomCenter`、**不**用 `on_tray_event` Move、**不**用 tray icon 坐标
- **不需要 on_tray_event Move 回调**——tray 移动不再触发 bubble 重定位
- **不需要离屏保护**——顶部居中永远可见

**撤销的决策**：
- 决策 3（tray icon 数字角标）——位置跟 tray 解耦后角标无意义，撤销 `setBadgeCount` / `Shell_NotifyIcon` 平台调用

**简化的 3 kind 高度策略**（替代决策 5 的"完全弹性"）：
- **pill 小态**：280×80pt
- **SideEffect**：280×200pt
- **Elicitation**：280×360pt
- **PlanReview**：280×600pt
- 每 kind 固定 height + **统一 width = 280pt**（极简设计，iPhone 灵动岛 compact pill 风）——`switch (kind) { case 'SideEffect': setSize(280, 200); ... }`，~5 行
- **spring 只动画 height**（width 永远 280 不变，单轴动画更简单 + x 永远居中）
- PlanReview 280pt 窄 + 内部 ScrollArea 滚——长 plan 体验可接受（用户接受）

**简化的 Elicitation 内部**——保留当前实现（一题展开 + Next/Back/Submit），不引入决策 8 的"已答折叠 + 剩余预览"复杂状态机。

**简化的 PlanReview 安全机制**——去掉决策 6 的"滚到底才解锁 Approve"机制，Approve 按钮始终可点。

**简化的 5min 超时反馈**——去掉决策 13.4 的 alarm icon 闪烁规格，改为静默 dismiss（跟 ADR-0013 代码现状一致）。

**简化的按钮出现动画**——去掉决策 9 的"100% 高度 + 80ms fade in"分层逻辑，按钮跟 spring 一起出现。

**cleanup 范围**（本次 grilling 决策）：
- `src/bubble/BubbleApp.vue`——删除 sonner Toaster + toolRisk + 3s auto-allow timers + queue 双轨（pill/expanded 合并）
- `src/bubble/TimeoutBanner.vue`——删除文件
- `src/bubble/PillToast.vue`——重写为 BubbleApp 直接渲染的子组件（不再依赖 sonner `toast.custom`）
- `src-tauri/src/lib.rs`——保留 `tauri-plugin_positioner` 调用（改为 `Position::TopCenter`），删除 `on_tray_event` Move 回调里的 bubble 重新定位 + 离屏保护逻辑
- `src-tauri/src/tray.rs`——删除 `on_tray_event` Move hook 里的 bubble 重定位
- `src-tauri/Cargo.toml`——**保留** `tauri-plugin-positioner` 依赖（只用 `Position::TopCenter`）

**接受的代价**（vs 撤回前）：
- **多显示器下 popover 永远在主屏**——副屏工作可能看不到（用户接受）
- **tray 移动后 popover 不跟随**——视觉关系断开（用户接受）
- **macOS 上 popover 可能跟 menu bar / Spotlight / 控制中心撞**——目前无用户报告（接受）
- **Elicitation 5+ 题体验**——保持现有多步表单，无折叠预览（接受）
- **PlanReview 长 plan 可"无脑 Approve"**——去掉安全机制（接受）
- **5min 超时无反馈**——静默 dismiss（接受）

**保留的设计**：
- 决策 2（全部 3 种 kind 在 popover 内演化形态、不切窗口）——保留（仍单 webview）
- 决策 7（spring stiffness 280 / damping 24）——保留（动画参数不变）
- 决策 10（键盘模型 deferred to v2）——保留
- 决策 13.1（pill + expanded 两态）——保留
- 决策 13.2（客户端状态机 hidden/pill/expanded）——保留（pill 不变，expanded 高度按 kind 切）

- **跨平台位置策略**（决策 11）——**已固化 2026-06-26**
- **3 种 kind 视觉 token**（决策 12）——**已固化 2026-06-26**
- **事件流**（决策 13）——**已固化 2026-06-26**
- **代码重构**——删除 Sonner toast 堆叠逻辑，删除 3s auto-allow 工具风险分级
- **ADR-0013 处理**——加 `superseded by 0014` 标记，保留为历史记录（已完成）
- **Linux fallback 实测**——GNOME / KDE / Hyprland / swaybar 跨 DE 验证
- **macOS mini mode 适配**——刘海 + menu bar 透明
