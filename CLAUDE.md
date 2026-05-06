# OBR Suite — AI Agent 交接文档

## 项目是什么

Owlbear Rodeo (OBR) 的 TRPG 一体化插件套装。将骰子、先攻、怪物图鉴、角色卡、搜索、时停、视口聚焦、传送门、HP气泡、状态追踪、视觉迷雾等模块打包在一个 manifest 中。

- **线上地址**：`https://obr.dnd.center/obr-suite/manifest.json`
- **技术栈**：TypeScript + Preact + Vite + OBR SDK v3.1.0
- **构建产物**：36 个 HTML 页面各自编译为独立 chunk，共享 vendor chunk

## 核心架构

```
background.html (src/background.ts)  ← 唯一的后台 iframe，常驻运行
  ├── 模块生命周期管理（setup/teardown，根据 state.enabled 启停）
  ├── Cluster 系统（底部左角悬浮按钮 + 展开操作栏）
  ├── 面板拖动 modal 生命周期（drag-preview 模态框）
  └── 所有广播事件的中转和处理

每个功能模块 (src/modules/xxx/index.ts)
  ├── setup()    — 注册 OBR 监听器、context menu、bbox provider
  ├── teardown() — 清理监听器
  └── 模块自己的 HTML iframe 入口（在根目录 *.html）

Settings 面板 (src/settings.ts → settings.html)
  └── 所有模块的配置 UI，通过 state.ts 读写
```

**三层状态存储**：
1. Scene metadata（`com.obr-suite/state`）— 模块启用/禁用、库配置、跨场景设置
2. Room metadata（`com.obr-suite/state-room`）— 跨场景镜像
3. localStorage — 客户端偏好（语言、面板位置/大小、各模块开关）

## 修改指南：需求 → 去哪里改

### 面板拖动 / 位置相关
- **拖动句柄绑定**：`src/utils/panelDrag.ts` — `bindPanelDrag(handleEl, panelId)`
- **位置存储**：`src/utils/panelLayout.ts` — `getPanelOffset/setPanelOffset`，`registerPanelBbox`
- **拖动预览模态框**：`src/drag-preview.ts` + `drag-preview.html`
- **布局编辑器**：`src/layout-editor.ts` + `layout-editor.html`
- **拖动生命周期**：`src/background.ts` 中的 `BC_PANEL_DRAG_START/END/CANCEL` 处理
- **各面板的 open 函数**：各自模块的 `index.ts`（如 hpBar 的 `openPopoverFor`）

### 某个功能模块的 bug
- 模块后台逻辑：`src/modules/<模块名>/index.ts`
- 模块 UI 页面：根目录 `<模块名>.html` + `src/modules/<模块名>/<page>.ts`
- 模块广播定义：在模块的 `index.ts` 中查找 `BC_*` 或 `BROADCAST_*` 常量

### Settings 面板 / 配置项
- **设置 UI**：`src/settings.ts` + `settings.html`（所有模块的设置都在这里）
- **状态定义**：`src/state.ts` 中的 `SuiteState` 接口和 `DEFAULT_STATE`
- **特性开关**：`src/feature-flags.ts` — `STABLE_HIDES` 控制稳定版隐藏未完成功能

### 新增一个功能模块
1. 创建 `src/modules/<name>/index.ts`，实现 `setup()` / `teardown()`
2. 在 `src/state.ts` 的 `ModuleId` 和 `DEFAULT_STATE.enabled` 中加入模块 ID
3. 在 `src/background.ts` 的 `modules` map 中注册
4. 如需 HTML 界面，创建对应的 `.html` 并在 `vite.config.ts` 的 `input` 中添加 entry
5. 如需设置项，在 `src/settings.ts` 中添加 UI

### Cluster 栏（底部左角按钮组）
- **触发器按钮**：`cluster.html` + `src/cluster.ts`
- **展开操作栏**：`cluster-row.html` + `src/cluster-row.ts`
- **打开/关闭逻辑**：`src/background.ts` 中 `openCluster/openClusterRow/closeCluster/closeClusterRow`

### 资源 URL 构建
- **工具函数**：`src/asset-base.ts` — `assetUrl("foo.html")`
- **规则**：始终用 `assetUrl()` 拼接路径，不要硬编码 URL。这样 dev/stable 部署自动隔离资源
- **manifest**：`public/manifest.json`（稳定版）和 `public/manifest-dev.json`（开发版）

### 跨模块广播通信
- **公共常量**：`src/utils/panelLayout.ts`（面板拖动相关）、各模块 index.ts（模块特定）
- **模式**：`OBR.broadcast.sendMessage(channel, data, { destination: "LOCAL"|"REMOTE"|"ALL" })`
- **监听**：`OBR.broadcast.onMessage(channel, callback)` 返回 unsubscribe 函数

## 关键约定

### OBR SDK 限制和坑
1. **`OBR.popover.open()` 不会更新已打开 popover 的位置** — 必须先 `close` 再 `open`
2. 没有 `popover.setPosition()` API — 只能用 close + reopen
3. 弹窗自动夹紧到 5px 视口边距 — drag-preview 要镜像这个逻辑
4. `window.screenX` 在所有 iframe 中相同 — 无法从 iframe 侧计算自身位置
5. 新 modal 打开时可能释放源 iframe 的 pointer capture — 拖动必须由 modal 接管

### 面板拖动架构（重要！）
```
pointerdown(源iframe拖拽句柄)
  → BC_PANEL_DRAG_START 广播
  → background.ts 查 bbox → 打开 drag-preview 全屏 modal
  → modal 接管 pointermove/pointerup
  → pointerup 时 setPanelOffset 保存到 localStorage
  → BC_PANEL_DRAG_END 广播
  → 各模块收到后 close + open 面板（应用新位置）
```

- bbox provider 由各模块在 setup 时通过 `registerPanelBbox` 注册
- 拖动结束后 offset 存 localStorage，刷新后依然生效
- layout-editor 也可调整面板位置/大小

### localStorage 键值前缀
- `obr-suite/panel-offset/{panelId}` → `{ dx, dy }`
- `obr-suite/panel-size/{panelId}` → `{ width, height }`
- `obr-suite/lang` → `"zh"` | `"en"`
- 其他以 `obr-suite/` 或 `com.` 为前缀

### 构建命令
```bash
npm run build          # 需要 node_modules 已安装
npx vite build         # 跳过 tsc 类型检查，直接构建
SUITE_BASE=suite-dev npx vite build  # 构建开发版到 /suite-dev/
```

`npm run build` 会先跑 `tsc`（类型检查），失败则不会构建。如果 SDK 类型不全导致 tsc 报错但实际没问题，用 `npx vite build` 跳过。

## 文件速查表

| 需求 | 去改 |
|------|------|
| 某个模块的功能 | `src/modules/<模块>/index.ts` |
| 模块的 UI 页面 | 根目录对应 `.html` + `src/modules/<模块>/<page>.ts` |
| 面板拖动出错 | `src/drag-preview.ts` / `src/utils/panelDrag.ts` / `src/utils/panelLayout.ts` |
| 面板打开位置不对 | 对应模块的 open 函数 + `getPanelOffset` |
| 广播不生效 | 检查常量值是否一致 + `destination` 是否正确 |
| 设置面板改动 | `src/settings.ts` |
| 模块启停控制 | `src/state.ts` 的 `enabled` + `src/background.ts` 的 `modules` map |
| 集群按钮改动 | `src/cluster.ts` + `src/cluster-row.ts` |
| 资源路径问题 | `src/asset-base.ts` + `vite.config.ts` |
| 构建问题 | `vite.config.ts` + `tsconfig.json` |
| 稳定版隐藏功能 | `src/feature-flags.ts` 的 `STABLE_HIDES` |
