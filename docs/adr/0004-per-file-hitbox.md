# Per-file rectangular hit-box for the pet window

Pet 窗口的可拖区域改为**每个 asset 一个矩形 hit-box**(viewBox 坐标),运行时通过 viewBox → 屏幕映射计算实际命中矩形。替换原先"固定的 144×144 透明 div"做法。

## Status

accepted — 2026-06-24(grilling session)

## Context

原 `pet.html` 用一个固定的 144×144 `<div id="hit-zone">`(居中在 200×200 窗口)做命中区,`pointer-events: none` 在 body + `auto` 在 hit-zone,只有那块矩形可拖。问题:

1. **命中区远大于宠物本体**:宠物精灵实际可见像素只占 hit-zone 的一小块(尤其 calico / sleeping 等状态),其余全是"按下去能拖但宠物不在那"——体感上是"整窗都能拖"
2. **未来 size 调整无法跟着缩放**:如果允许用户调整宠物大小(可能需求),144×144 像素坐标的 hit-zone 不会自动按比例缩
3. **mini mode / peek-on-hover 行为不一致**:mini 模式窗口缩到 160×160,peek 时回到 200×200,但 hit-zone 是固定的,跟着窗口缩放时机不对

参考原版 `/Users/jiannei/code/github/uma-pet/src/hit-geometry.js` + `state-hitbox-resolver.js` 的做法:每个 SVG 在主题里声明 viewBox 和 hitBox(viewBox 坐标),运行时按精灵实际渲染矩形映射到屏幕。

## Decision

主题数据新增四类字段(uma-pet 兼容):

- `viewBox: {x, y, width, height}` —— 主题默认 viewBox(所有 SVG 共享的同一坐标系)
- `fileViewBoxes: { [filename]: {x, y, width, height} }` —— per-file viewBox override(当某文件坐标系不同)
- `hitBoxes: { default, wide, sleeping }` —— 三组 hitBox,按组分类(uma-pet 命名)
- `fileHitBoxes: { [filename]: {x, y, width, height} }` —— per-file hitBox override,优先级最高
- `wideHitboxFiles: string[]` / `sleepingHitboxFiles: string[]` —— 列出哪些文件用 `wide` / `sleeping` 组的 hitBox

运行时解析算法(uma-pet `resolveHitBoxForSvg` 翻译):

```
hitBoxFor(file):
  1. fileHitBoxes[file]    // 最高优先级
  2. hitBoxes.sleeping     // 若 file 在 sleepingHitboxFiles
  3. hitBoxes.wide         // 若 file 在 wideHitboxFiles
  4. hitBoxes.default      // 兜底;缺失则该状态不可拖(uma-pet 行为)
```

viewBox 解析: `fileViewBoxes[file] || theme.viewBox`。

screen hit-rect 计算(viewBox → 屏幕):

```
scaleX = renderedRect.width  / viewBox.width
scaleY = renderedRect.height / viewBox.height
hitRect = {
  x:      renderedRect.x + (hitBox.x - viewBox.x) * scaleX,
  y:      renderedRect.y + (hitBox.y - viewBox.y) * scaleY,
  width:  hitBox.width  * scaleX,
  height: hitBox.height * scaleY,
}
```

`renderedRect` 从 `#pet-sprite.getBoundingClientRect()` 读,**每次状态切换和 `tauri://move` 事件触发时重算**(复用现有 edge-snap 监听器,零额外监听器成本)。这样:

- mini 模式 160×160 ↔ peek 200×200 切换时,命中区跟着精灵渲染矩形缩
- 未来 size 调整时,只要 CSS 改精灵尺寸,命中区自动跟随
- 主题切换时,viewBox + hitBox 同步换

坐标全部 `{x, y, width, height}` 对象,不用 SVG 字符串 `"0 0 W H"`——方便在 JS 里直接算数学。

## Considered Options

- **Option 1:固定 144×144 div(原版做法)**。今天 0 改动,但命中区永远不和宠物本体对齐,size 调整 / mini 模式都得 hack。
- **Option 2:像素级精确命中(`pointer-events: visiblePainted` 或 canvas 采样)**。视觉最贴近"用户语义里的宠物像素",但只能用 SVG 主题(calico 的 APNG 不支持),每次点击要像素扫描有性能 cost,而且动画期间点击位置可能"漏出去"(命中区形状跟着帧变)。
- **Option 3:运行时 fetch + parse SVG 自动发现 viewBox**。零维护,但 theme-manager 要异步化,首次渲染几十 ms 延迟;CLAUDE.md / 用户偏好"代码即文档",自动发现反而让"为什么 viewBox 是这个"看不到。
- 选 **Option 4**(本文):每文件矩形 hit-box(uma-pet 风格)。牺牲"像素级精确",换来"实现简单 + 双主题(SVG/APNG)都能用 + 抗 size 调整 + 可手写微调"。

## Consequences

- `theme-manager.js` 新增 `getHitBoxDataForState(state)` + `computeScreenHitRect(state, renderedRect)` 两个方法,公开 API 多了两个调用点
- `pet.html` 的主题注册数据要补 viewBox / hitBoxes / fileHitBoxes / wideHitboxFiles / sleepingHitboxFiles 五类字段(每个主题约 30~50 行配置)。`fileViewBoxes` 字段保留为兼容位但 clawd/calico 当前都用不上
- **hitBox 数据从 `uma-pet/themes/{clawd,calico}/theme.json` 原样抄过来**(asset md5 校验 byte-identical,2026-06-24):viewBox、`hitBoxes.{default,sleeping,wide}`、各 `fileHitBoxes`、`wideHitboxFiles`、`sleepingHitboxFiles`。唯一翻译:uma-pet 用 `w`/`h` 简写,本项目用 `width`/`height` 完整字
- debug 红框(`[DEBUG-VIS-TEMP]` CSS)和 `[DIAG-TEMP]` 监听器在落地后整段删掉,worktree 跟着 `ExitWorktree` 清理
- 如果未来 `uma-pet` 的 hitBox 数据更新(美术微调),需要同步复制到 `pet.html` 的主题注册段——这是一次性 boilerplate,不是动态引用,可能漂移
- 未来如果真的需要"逐像素命中"(比如用户反馈某状态命中区还是太大),升级路径是 Option 2,数据可以保留(只是 viewBox 坐标换成 SVG 内像素坐标)