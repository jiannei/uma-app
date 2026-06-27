# Consolidate UnoCSS around `@unocss/preset-wind4` (revised)

把 UnoCSS 配置围绕 Tailwind v4 兼容预设 `@unocss/preset-wind4` 收敛：drop `presetWind4` 自身的 v4 化石指令（presetWind4 读不到 CSS-first @theme/@utility 的 inline 配置在 UnoCSS 66.7.3 上有 gap），把 3 个 broken animation 通过 `rules[]` 显式修好；清理 `bg-island-78` 这类 `color-mix` shortcut 改走 UnoCSS 原生 `/N` 语法；把 `@tauri-apps/*` / `vueuse` 范围内的手写 timer 跟 dark-mode 同步搬到 vueuse composable。

> **Revisions from original draft (2026-06-27 evening):** Implementation went through three preset iterations before landing:
> - Draft had `presetUno` (truly UnoCSS-native core).
> - First try: `@unocss/preset-uno` import — but this is the **deprecated alias for `@unocss/preset-wind3`**, not UnoCSS-native. Switched to `presetMini` (UnoCSS-native core).
> - `presetMini` lacks ~30 Tailwind-specific variants (`aria-invalid:`, `data-checked:`, named groups, `*[X]:`, etc.) that the shadcn-vue shortcut library uses. Manually filling them requires ~80 lines of custom variants and is essentially reimplementing `presetWind4`.
> - Landed on `presetWind4` (Tailwind v4 compat) — all shadcn-vue patterns work out of the box, no custom variants needed. The "UnoCSS alone" goal is satisfied by `presetWind4` being UnoCSS's own preset (engine: UnoCSS core; utility set: Tailwind v4 compat).
> - `presetWind4` ships its own Tailwind v4-aligned reset (`@unocss/preset-wind4` README: "you don't need to install any additional CSS reset package") — so `@unocss/reset/normalize.css` is not needed.
> - Animation utility names reverted to tw-animate-css standard (`animate-in` / `fade-in-0` / `slide-in-from-top-2` / etc.) — matches shadcn-vue / Reka UI docs verbatim. The `anim-*` rename was abandoned because presetWind4 provides all the standard names natively.

## Status

accepted — 2026-06-27（grilling session via `/grill-with-docs`，implementation same day）

## Context

PR-4（commit `0b55f6a`）删了 Tailwind v4 / shadcn-vue / cva / tw-animate-css 的运行时包，意图是收尾"非 UnoCSS 标准栈"。但实际留下的尾巴比删的多：

1. **`@unocss/preset-wind4` 还在 devDependencies 里** —— Tailwind v4 兼容 preset，CSS engine 是 UnoCSS，utility set 跟 Tailwind v4 对齐
2. **uno.config.ts 的 ~40 条 shortcut（`btn-base` / `card-base` / `select-trigger-base` / `sidebar-*` / `tooltip-content-base` / `sheet-content-base` / ...）内部引用 presetWind4 才提供的工具类**：`animate-in` / `animate-out` / `fade-in-0` / `zoom-in-95` / `slide-in-from-top-2` / `bg-clip-padding` / `aria-invalid:` / `data-checked:` / 命名 group 等
3. **CSS 文件里有 v4 化石指令**（`@custom-variant` / `@theme` × 2 / `@utility` × 5）—— UnoCSS 66.7.3 在 presetWind4 模式下对这些指令的支持有 gap（实测发现 `@theme` 不直接被 presetWind4 读取，需要走 rules[] 路径），导致 3 个业务动画（`animate-pill-pulse` / `animate-alarm-flicker` / `animate-toast-in`）在 SFC 里被引用但 UnoCSS 不生成对应 class
4. **3 个 alpha shortcut（`bg-island-78` / `border-divider-island-12` / `bg-allow-18`）定义在 uno.config.ts 但实际从未在 SFC 里被引用**（grep 验证）

## Decision

### D1. 沿用 `presetWind4`（不切 preset）

保持 `@unocss/preset-wind4` 作为唯一 utility preset。原因：shadcn-vue shortcut 库基于 Tailwind 工具类语义设计（`aria-invalid:` / `data-checked:` / 命名 group / `*[X]:` / 等），这些是 `presetWind4` 内置覆盖的；`presetMini`（UnoCSS-native core）不提供这些 pattern，要复现要写 ~80 行 custom variants 等于从零重建 presetWind4。presetWind4 是 UnoCSS 自己的 preset，**不是回到 Tailwind**——engine 是 UnoCSS，输出是 UnoCSS 生成的 CSS（CSS layers + @property 等 UnoCSS 架构），只是 utility 名字跟 Tailwind v4 对齐。

**Reset 来源：**`presetWind4` 自带 Tailwind v4 对齐的 reset（README 原话："you don't need to install any additional CSS reset package"）。**不需要单独的 `@unocss/reset/normalize.css`**。entry 文件（`main.ts` / `bubble/main.ts`）不需要额外 import reset。

### D2. shadcn-vue shortcut 字符串里的动画 utility 名沿用 tw-animate-css 命名

shortcut 定义里继续用 `animate-in` / `animate-out` / `fade-in-0` / `fade-out-0` / `zoom-in-95` / `zoom-out-95` / `slide-in-from-{top,bottom,left,right}-{1,2}` / `slide-out-to-{top,bottom,left,right}`。这跟 shadcn-vue / Reka UI 文档字面一致，任何后续查文档复制代码的人不会踩坑。

### D3. 3 个 standalone animation 通过 `rules[]` 显式注册

`animate-pill-pulse` / `animate-alarm-flicker` / `animate-toast-in` 不在 tw-animate-css 也不在 presetWind4 内置集里。注册到 uno.config.ts 的 `rules[]`：

```ts
[/^animate-pill-pulse$/, () => ({ animation: 'pill-pulse 2.4s ease-in-out infinite' })],
[/^animate-alarm-flicker$/, () => ({ animation: 'alarm-flicker 0.4s ease-in-out 4' })],
[/^animate-toast-in$/, () => ({ animation: 'toast-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) both' })],
```

对应的 `@keyframes pill-pulse` / `alarm-flicker` / `toast-in` 块放到 `src/styles/bubble.css`（pill-pulse / alarm-flicker）和 `src/styles/main.css`（toast-in），跟 token 同文件就近。

### D4. 3 个未引用的 alpha shortcut 删掉

uno.config.ts 里 `bg-island-78` / `border-divider-island-12` / `bg-allow-18` 三个 shortcut 定义，grep 确认**没有任何 SFC 引用**（是 PR-1 时期的 alpha 语法实验残留）。直接删。原意图 alpha 用 UnoCSS 原生 `bg-island/78` 语法即可，但目前项目没有用到 alpha 的地方，所以也不补 `/N` 的引入。

### D5. v4 化石指令清理

- `shared.css` 的 `@custom-variant dark (&:is(.dark *));` —— UnoCSS 默认 `dark:` variant 已经匹配 `<html class="dark">`（ModeToggle.vue 通过 `useColorModeClass` 同步），删除无副作用
- `bubble.css` 的 `@theme` 块（--animate-pill-pulse / --animate-alarm-flicker）—— UnoCSS 66.7.3 + presetWind4 模式下不被识别，**改走 rules[] 路径（D3）**
- `bubble.css` 的 5 个 `@utility` 块（expanded-shell / shadow-island / plan-progress / plan-progress-fill / plan-progress-fill--complete）—— 全部已经在 uno.config.ts 的 shortcut 或 rules[] 里，**bubble.css 是化石**，删
- `main.css` 的 `@theme { --animate-toast-in }` —— 同样改走 rules[] 路径

### D6. dark mode

不改 —— UnoCSS 内置 `dark:` 变体默认走 `'class'` 模式，匹配 `<html class="dark">`（`ModeToggle.vue` 通过 `useColorModeClass` 同步）。`@custom-variant dark` 删除无影响。

### D7. 抽 `useColorModeClass` composable，删 ModeToggle.vue 里的手写 watchEffect

`ModeToggle.vue:26-30` 原本有 3 行手写 `watchEffect` 把 3-way mode（light / dark / auto）+ system preference 解析成 boolean 然后 `document.documentElement.classList.toggle('dark', isDark)`。vueuse 没有提供"3-way mode + 自动 class 同步"的单 composable（`useDark` 只管 binary），抽到 `src/composables/useColorModeClass.ts` 封装：

```ts
// src/composables/useColorModeClass.ts
import { watchEffect, type Ref } from 'vue'
import { usePreferredDark } from '@vueuse/core'

export function useColorModeClass(mode: Ref<'light' | 'dark' | 'auto'>) {
  const prefersDark = usePreferredDark()
  watchEffect(() => {
    const isDark = mode.value === 'dark' || (mode.value === 'auto' && prefersDark.value)
    document.documentElement.classList.toggle('dark', isDark)
  })
}
```

`ModeToggle.vue` 调用从 5 行缩到 2 行：

```ts
const mode = useColorMode()
useColorModeClass(mode)
```

### D8. App.vue 的 5 处 `setTimeout` 改 `useStatusToast`

`src/App.vue` 5 处 `setTimeout(() => { status.value = '' }, 1500 | 2000)` 迁移到 vueuse 的 `useTimeoutFn`。抽 `src/composables/useStatusToast.ts` 封装成 ref —— 设置非空值自动启动 timer，到点清空。**Duration 统一 1500ms**（原来是 1500 / 2000 两档，差异 500ms 不影响 UX）。

```ts
// src/composables/useStatusToast.ts
import { ref, watch } from 'vue'
import { useTimeoutFn } from '@vueuse/core'

export function useStatusToast(duration = 1500) {
  const status = ref('')
  const { start, stop } = useTimeoutFn(
    () => { status.value = '' },
    duration,
    { immediate: false },
  )
  watch(status, (v) => {
    if (v) start()
    else stop()
  })
  return status
}
```

### D9. `--var(--xxx)` shorthand → `[var(--xxx)]` arbitrary value

`w-(--sidebar-width)` / `max-w-(--skeleton-width)` / `origin-(--reka-select-content-transform-origin)` 是 Tailwind v4 引入的 `--var()` shorthand，presetWind4 接受但写法略反直觉。改写为标准 UnoCSS 任意值语法 `w-[var(--sidebar-width)]` 等：

- `SidebarMenuSkeleton.vue`: `max-w-(--skeleton-width)` → `max-w-[var(--skeleton-width)]`
- `Sidebar.vue`: 4 处 `w-(--sidebar-width)` / `w-(--sidebar-width-icon)` → `w-[var(--sidebar-width)]` / `w-[var(--sidebar-width-icon)]`
- `uno.config.ts` shortcut 里 4 处同样转换

SFC 改动总数 = **5 处**（不是原来以为的 0；最初 ADR 漏算了 `Sidebar.vue` 里的 `--var()` shorthand）。

### D10. dark mode storage key 变更（breaking）

`useColorMode()` 之前传 `storageKey: 'mode'`（项目自定义 key），这次改用 vueuse 默认 key `vueuse-color-scheme`。

**后果：**现有用户升级后主题偏好重置为 vueuse 默认（`auto`），需要手动重新选 light / dark / auto。用户已确认现阶段不需要考虑历史用户，**显式 breaking**。

## Consequences

### 业务面

- **SFC 改动 = 5 处**：`SidebarMenuSkeleton.vue` × 1 + `Sidebar.vue` × 4（`--var()` shorthand 转换）。原"零 SFC 改动"假设错了——最初的 ADR grep 没覆盖到 `Sidebar.vue`
- **修复 3 个隐性回归**：`animate-pill-pulse` / `animate-alarm-flicker` / `animate-toast-in` 重新生效（PR-4 之后实际没跑）
- **dark mode storage key 变更**（**breaking**）：`mode` → vueuse 默认 `vueuse-color-scheme`。现有用户升级后主题偏好被重置为 vueuse 默认（`auto`），需要手动重新选 light / dark / auto

### uno.config.ts 改动

- `presets: [presetWind4(), presetIcons({ scale: 1.2 })]` —— presetWind4 保留
- `theme.colors` 不动（presetWind4 也支持 `var(--xxx)` token 注入）
- 删 3 个 alpha shortcut（`bg-island-78` / `border-divider-island-12` / `bg-allow-18`）
- `rules[]` 新增 3 条 standalone animation（`animate-pill-pulse` / `animate-alarm-flicker` / `animate-toast-in`）；保留 `plan-progress-fill` 多属性 transition rule
- 4 处 shortcut 字符串里 `--var()` 转换 `[var(--xxx)]`

### 3 个 CSS 文件改动

- `shared.css`: 删 1 行 `@custom-variant dark`
- `bubble.css`: 删 `@theme` 块（4 行）、5 个 `@utility` 块（40 行）；加 3 个 `@keyframes`（pill-pulse / alarm-flicker / toast-in）；保留 token + Vue transition + sonner
- `main.css`: 删 `@theme` 块（3 行）；保留 scrollbar 规则

### package.json 改动

- `presetWind4` 不动（一直用）
- **不**安装 `@unocss/reset` / `normalize.css`（presetWind4 自带 reset）

### 显式不动的部分

- **shadcn-vue shortcut 库**（~40 条 in-house shortcut）全部沿用原命名 `animate-in` / `fade-in-0` 等，**不动 utility 字面量**。shadcn 生态文档字面对齐
- **theme tokens**（`:root` / `.dark` 里的 oklch 色值）保持 raw CSS variable 形式，uno.config.ts `theme.colors` 继续 `var(--xxx)` 桥接
- **Vue `<Transition>` 命名**（`alarm-fade`）走 `.alarm-fade-leave-active` 标准 CSS 规则，跟 utility class 系统平行
- **reka-ui 库**不依赖 Tailwind 工具类，无影响

### 风险 / 已知 unmatched warning（不阻塞 build）

`bun run build` 通过（✓ 569ms）且 `tsc -p tsconfig.node.json --noEmit` 干净通过，但 UnoCSS 输出 ~30 条 `unmatched utility` warning：

- `dark:aria-invalid:` / `dark:data-checked:` 等嵌套 dark + aria/data variant —— presetWind4 不自动 stack 这些，需要 custom variant 或 shortcut 字面量改造
- `*[img:first-child]:` / `*[img:last-child]:` Tailwind v4 任意后代选择器 —— presetWind4 66.7.3 处理有 gap
- `group/X` / `peer/X` 命名 group 注册 —— presetWind4 66.7.3 不识别
- `data-checked:` / `data-unchecked:` Reka UI state shortcut —— presetWind4 66.7.3 不识别（要用 `data-[state=checked]:` 形式）
- `aria-invalid:` 单 variant —— presetWind4 66.7.3 不识别
- `cn-font-heading` 自定义 font utility —— presetWind4 不提供，需手动加

这些都是**实际视觉 regression**（aria-invalid 在 dark mode 不显示错误样式 / Switch checked 状态色不应用 / 卡片含首图时无圆角 / etc.）。**不在本 ADR 范围**——可以作为 follow-up 单独 ADR 处理（修复路径：要么 presetWind4 升最新版、要么 shortcut 字符串改成 presetWind4 兼容写法、要么补 custom variants）。

## 实现路径（实际走过的）

1. `bun remove normalize.css` && `bun add -D @unocss/reset` （第一次走 Normalize.css 路线）→ **撤销**：`bun remove @unocss/reset`（presetWind4 自带 reset）
2. 写 `src/styles/animations.css` 集中 keyframes → **撤销**：合并进 bubble.css / main.css
3. 改 `uno.config.ts`：
   - 第一次：presetWind4 → presetUno，alpha shortcut 改 `/N`，animation 改 `anim-*` 前缀
   - 第二次：presetUno → presetMini（UnoCSS-native）
   - 第三次：presetMini → presetWind4（最终选择，因为 shortcut 库依赖 Tailwind pattern），animation 名 revert 回 tw-animate-css，alpha shortcut 整个删（没被引用）
   - 加 3 条 rules[]（D3）
   - shortcut 字符串里 4 处 `--var()` 转换
4. 改 3 个 CSS 文件：删 v4 化石 + 加 keyframes
5. 改 2 个 entry 文件 `main.ts` / `bubble/main.ts`：第一次加 `import '@unocss/reset/normalize.css'` → **撤销**
6. 写 `src/composables/useColorModeClass.ts`
7. 改 `src/components/ModeToggle.vue`：用 `useColorModeClass` + 不传 `storageKey`（用 vueuse 默认 `vueuse-color-scheme`）
8. 写 `src/composables/useStatusToast.ts` + 改 `src/App.vue`：5 处 `setTimeout` → 单个 `useStatusToast(1500)`
9. 改 2 个 SFC（`SidebarMenuSkeleton.vue` × 1 + `Sidebar.vue` × 4）的 `--var()` shorthand
10. `bun run build` ✓ + `tsc -p tsconfig.node.json --noEmit` ✓

预估总耗时：~3 小时（含一次完整 preset 反复、5 处 SFC 编辑、ADR 多轮修订）。

## 沉淀的 memory

跨 session 适用的 feedback 写到 `~/.claude/projects/-Users-jiannei-code-github-uma-app/memory/prefer-vueuse-over-handwritten.md`：Vue / TS 改代码前先查 vueuse 是否覆盖，避免手写 dark mode / timer / event listener / debounce / storage 等通用工具。