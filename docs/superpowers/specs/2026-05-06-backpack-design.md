# 背包/道具系统 — 设计文档

## 概述

在角色卡浮动面板中新增背包区域，道具数据来自 5etools 中文镜像（`5e.kiwee.top`），存储于 room metadata，逻辑上关联角色卡。道具展示为文字 chip，点击直接打开全局搜索查看详情和掷骰。

## 数据模型

### 存储

**Room metadata**，key：`com.obr-suite/backpack/{cardId}`

```ts
interface BackpackData {
  items: BackpackEntry[];
}

interface BackpackEntry {
  /** 5etools item name，作为唯一标识（5etools items.json 以 name 为自然键） */
  srdName: string;
  /** 物品名称（冗余存储，用于 chip 展示，避免每次都查 SRD） */
  name: string;
  /** 物品类别（冗余存储，用于 chip 着色，SRD item.type） */
  type: string;
  /** 数量 */
  qty: number;
}
```

### 道具数据来源

- 5etools 中文镜像：`https://5e.kiwee.top/data/items.json`
- 复用现有 `state.ts` 中的 libraries 配置
- 搜索索引路径：`search/index.json`（5etools 标准格式）
- item 搜索类别已在 search/page.ts 中映射（category 4, 31, 47, 54, 57）

## UI

### 位置

角色卡浮动面板（`info-page.ts`）底部，武器/攻击栏下方。可折叠。

### 展开态

- 标题行：`🎒 背包 (N)` — 左侧标题，右侧 `＋` 按钮 + `▼` 折叠按钮
- 道具网格：文字 chip，flex-wrap 布局

### chip 样式

按 SRD 装备类别自动着色（左边界 + 文字颜色）：

| 类别 | SRD type | 颜色 |
|------|----------|------|
| 药水/消耗品 | Potion, Poison | 绿色 #4ecdc4 |
| 卷轴/魔法物品 | Scroll, Wondrous, Rod, Wand, Ring | 金色 #fdcb6e |
| 工具/冒险装备 | Tool, Gear, Kit, Ammunition | 紫色 #a29bfe |
| 武器/护甲 | Weapon, Armor, Shield | 红色 #e74c3c |
| 其他 | 其余 | 灰色 #888 |

### 折叠态

只显示：`🎒 背包 (N) ▶`

### 道具详情

**不再需要独立的详情面板。** 左键点击 chip → 发送 `BC_SEARCH_QUERY` 广播 → 全局搜索面板打开该道具，搜索面板已有完整的道具描述、骰子高亮和掷骰功能。

## 交互

### 添加道具

1. 点击背包栏 `＋` 按钮
2. 发送广播打开搜索面板（或弹出 mini 搜索 popover，仅搜 item 类别）
3. 用户从搜索结果中选择道具
4. 道具写入 room metadata，背包栏增量更新

### 右键菜单（chip 上）

- **查看详情** → 同左键，发送 `BC_SEARCH_QUERY`
- **转移给...** → 进入转移模式，点击目标角色棋子，道具从源背包移除、加入目标背包
- **修改数量** → 弹出小输入框修改 qty
- **丢弃** → 确认后从背包移除

### 转移流程

1. 右键 chip → "转移给..."
2. 弹出目标角色列表（当前房间中所有绑定了角色卡的其他 token）
3. 选择目标角色
4. 从源 `backpack/{sourceCardId}` 移除，添加到 `backpack/{targetCardId}`
5. 如果房间中没有其他绑定了角色卡的 token，提示无法转移

> 备选方案：如果后续需要更直观的交互，可以改为拖拽 chip 到目标 token（类似 statusTracker 的 buff 拖拽），当前先用列表选择降低实现复杂度。

### 掷骰

道具详情中的骰子表达式完全由全局搜索面板处理。chip 本身不处理骰子。

## 权限

- **DM**：可管理所有角色的背包（添加/移除/转移/修改数量）
- **玩家**：只能管理自己绑定角色的背包
- 权限检查点：写入 room metadata 前判断 `OBR.player.getRole()` 或对比 cardId 绑定关系

## 模块结构

```
src/modules/backpack/
  index.ts          — 背包数据读写函数（readBackpack / writeBackpack / addItem / removeItem）
  types.ts          — BackpackData, BackpackEntry 类型定义
```

修改的文件：
- `info-page.ts` — 新增背包栏 UI 渲染 + 交互（调用 backpack/index.ts 的数据函数）
- `state.ts` — 不需要新增 ModuleId（背包不是独立启停的模块）
- `background.ts` — 不需要修改（不新增独立模块）
- `vite.config.ts` — 不需要新增 entry（UI 在已有 info-page 内）

### 为什么背包不作为独立模块

背包是角色卡面板的扩展功能，没有独立的 HTML iframe、没有 setup/teardown、没有模块开关。它由角色卡面板的渲染逻辑驱动，角色卡禁用时背包自然也看不到。


### 数据流

```
角色卡面板打开 → showCard() → 读取 backpack/{cardId}
  → 渲染背包 chip 网格
  → 绑定 chip 点击事件（BC_SEARCH_QUERY）
  → 绑定 chip 右键事件（操作菜单）

添加道具 → 搜索面板 → 用户选择 → 
  setRoomMetadata({ backpack/{cardId}: newData }) → 重新渲染

转移道具 → 右键菜单 → 转移模式 → 点击目标 →
  readRoomMetadata(源) + readRoomMetadata(目标) →
  setRoomMetadata(源: 移除, 目标: 添加)
```

## 边界情况

1. **角色卡未绑定 token**：背包数据仍存于 room metadata（跟着 cardId），角色卡面板打开时正常显示
2. **token 被删除**：背包数据不受影响（存在 room metadata，不跟 token）
3. **道具从 SRD 中移除/变更**：背包中已存储的冗余字段（name, type）保证 chip 仍可正常显示
4. **同一房间多个场景**：room metadata 天然跨场景共享，一个场景中添加的道具在其他场景中可见
5. **并发写入**：两个 DM 同时修改同一角色背包 → room metadata 以最后写入为准（OBR SDK 行为）
