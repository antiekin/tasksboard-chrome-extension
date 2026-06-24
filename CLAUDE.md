# Tasksboard Chrome Extension - Claude 开发指令

## 项目概述

这是一个轻量级本地 Google Tasks Chrome 插件，专注于当日任务管理。

**核心设计理念：**
- 快速加载（无依赖，纯原生代码）
- 简洁高效（专注今日任务）
- 直观交互（拖拽排序、点击编辑、循环切换）

## 技术栈

- **Manifest V3** - Chrome 扩展标准
- **Side Panel API** - 侧边栏界面（Chrome 114+）
- **原生 JavaScript + HTML + CSS** - 零依赖，快速加载
- **chrome.storage.local** - 本地数据持久化

## 文件结构与职责

```
├── manifest.json          # 扩展配置文件，定义权限和侧边栏
├── background.js          # 后台服务 worker：侧边栏打开 + 午夜 alarm
├── sidepanel.html         # 主界面 HTML 结构（今日任务 + 任务池两标签）
├── sidepanel.css          # 样式表，包含动画和主题颜色
├── sidepanel.js           # UI 控制器，处理所有 DOM 操作和事件
├── storage.js             # 存储抽象层，封装 chrome.storage.local API
├── task-manager.js        # 任务 CRUD 业务逻辑层（纯逻辑，无 DOM）
├── daily-focus.js         # 今日页逻辑：必做筛选、streak、超额、日志生成
├── obsidian-sync.js       # Obsidian 双向同步引擎（Daily Tasks）
├── todo-sync.js           # Obsidian 双向同步引擎（To-do List / 任务池）
├── tests/                 # Node.js 单元测试（node --test tests/*.test.js）
└── icons/                 # 扩展图标
```

### 架构分层

```
UI Layer (sidepanel.js)
    ↓ 事件触发
Daily Focus Logic (daily-focus.js)   Business Logic (task-manager.js)
    ↓ 必做 / streak / 超额               ↓ 任务 CRUD
Storage Layer (storage.js)            Sync Layer (obsidian-sync.js / todo-sync.js)
    ↓ 持久化                              ↓ 双向同步
chrome.storage.local API              Obsidian Local REST API
```

**关键原则：**
- `task-manager.js` 不依赖 DOM，可独立测试
- `daily-focus.js` 纯函数逻辑（getMustDoItems / buildDayRecord / computeStreak 等），可 `require` 测试
- `sidepanel.js` 只处理 UI 逻辑，不含业务计算
- `storage.js` 提供统一的存储接口，隔离 Chrome API

## 数据模型

### Todo Item（任务池条目）

```javascript
// 存储在 todoData.sections[].items[] 内
{
  id: "uuid-string",
  text: "任务文本",
  reference: null | "wikilink",   // Obsidian wikilink 引用
  priority: "S"|"A"|"B"|"C"|null,
  category: "家庭"|"工作"|"健康"|"学习"|null,
  completed: false,
  order: 0,
  today: true                     // ← #今日 标记：true = 本日必做；false = 普通池任务
}
```

**`#今日` 标记机制：**
- Obsidian 中在任务行末尾加 `#今日` → `todo-sync.js` 解析时将 `today: true` 并从 `text` 剥离该 tag
- 序列化回 Markdown 时，`today: true` 的条目行末自动追加 ` #今日`
- `getMustDoItems(todoData)` 返回所有 `today: true` 的条目（跨 section），上限 `MAX_MUST_DO=3`

### 存储结构（chrome.storage.local）

```javascript
{
  tasks: [...],                   // TaskManager 管理的旧日任务数组（跨日移动用）
  preferences: { completedSectionExpanded: false },
  todoData: {                     // 任务池（To-do List）主数据
    preamble: "...",              // Markdown 前言（frontmatter + H1）
    sections: [{
      name: "短期任务",
      comment: "<!-- ... -->",
      items: [{ id, text, reference, priority, category, completed, order, today }]
    }]
  },
  completionHistory: {            // 每日达成记录（跨日归档写入）
    "2026-06-23": {
      mustDo: [{ text, completed }],
      overAchieved: 2,            // 本日超额完成条数
      streak: 5                   // 截至当日连续天数
    }
  },
  todayExtra: {                   // 当日临时必做（addTempMustDo 写入，归档后清空）
    tempItems: [{ id, text, completed }]
  },
  lastRolloverDate: "2026-06-23"  // 最后一次归档日期（防跨日遗漏）
}
```

## 核心功能实现

### 1. 今日必做（今日页）

**数据来源：**
- `#今日` 标记的任务池条目（`today: true`），上限 3 条
- `addTempMustDo()` 当日临时新建（写入 `todayExtra.tempItems`）

**关键函数（daily-focus.js）：**
- `getMustDoItems(todoData)` — 聚合正式 + 临时必做列表
- `allMustDoComplete(todoData)` — 检测全部完成
- `canAddMustDo(todoData)` — 当前是否可再添加（< MAX_MUST_DO）

**完成流程：**
1. 点击卡片勾选 → `completeMustDoItem(id)` → 触发完成特效
2. 全部完成 → `showAllDoneCelebration()` → 烟花 + "所有必做完成！" banner

### 2. 超额完成 + 长期看板

**超额：** 正式必做全部完成后，再完成任务池中的其他任务 → 计入 `overAchieved`；金色高亮特效。

**长期看板（board）：** 展示过去 7 周 streak、本周/本月 tally、徽章。
- `computeStreak(history)` — 从 completionHistory 计算连续达成天数
- `tallyOverAchieved(history, start, end)` — 计算区间内超额总和
- `refreshBoard()` / `refreshStreakMini()` — 更新看板 DOM

### 3. 跨日归档

**触发时机（两路）：**
1. background.js 午夜 alarm → `chrome.runtime.sendMessage({ type: 'daily-archive', date: yesterday })`
2. 启动 catch-up：sidepanel 打开时若 `lastRolloverDate !== today`，立即补跑

**归档流程（`handleDailyArchive(dateStr)`）：**
1. `buildDayRecord(todoData, extra)` 汇总必做+超额
2. `storage.saveCompletionDay(date, record)` 写入 completionHistory
3. `obsidianSync.writeDailyLog(date, mustDo, overAchieved)` 可选写 Obsidian 日志
4. 清空所有 `today: true` 标记（任务退回任务池）
5. 清空 todayExtra

### 4. 任务池（Todo 标签）

- 数据存储在 `todoData.sections[].items[]`
- `#今日` 标记决定哪些进入今日页
- 跨标签移动：`handleMoveToDaily(section, itemId)` / `handleMoveToTodo(taskId)`，移动后调用 `renderToday()` + `renderTodoSections()`
- 双向同步 Obsidian `Todo_List.md`（通过 `todo-sync.js`）

### 5. 数据持久化

- 所有修改操作调用 `saveTasksDebounced()` / `saveTodoDebounced()`（300ms 防抖）
- 保存到 `chrome.storage.local`，同时可选同步 Obsidian

## 开发规范

### 代码风格

- **变量命名**：驼峰命名法（camelCase）
- **常量**：大写下划线（UPPER_SNAKE_CASE）
- **类名**：帕斯卡命名法（PascalCase）
- **CSS 类**：连字符命名法（kebab-case）

### 注释规范

- 所有函数必须有 JSDoc 注释
- 复杂逻辑添加行内注释说明
- CSS 使用注释分隔不同模块

### 错误处理

- 所有 async 函数使用 try-catch
- 存储失败时显示用户友好提示
- console.error 记录详细错误信息

## 修改指南

### 如何添加新功能

1. **今日页逻辑** → 修改 `daily-focus.js`（纯函数，加测试）
2. **业务逻辑** → 修改 `task-manager.js` 或 `daily-focus.js`
3. **更新 UI** → 修改 `sidepanel.html` 和 `sidepanel.css`
4. **绑定交互** → 在 `sidepanel.js` 中添加事件处理
5. **运行测试** → `node --test tests/*.test.js`

### 如何修改样式

- **颜色** → 修改 `:root` CSS 变量
- **间距** → 修改 `--spacing-*` 变量
- **动画** → 调整 `--transition-*` 变量或 `@keyframes`

### 如何调试

1. 在 `chrome://extensions/` 重新加载插件
2. 右键侧边栏 → 「检查」打开 DevTools
3. 查看 Console 日志
4. 在 Application → Storage → Local Storage 查看 `completionHistory`、`todoData`、`todayExtra`

## 常见问题

### Q: 今日必做没有显示？
**A:** 检查任务池中是否有 `#今日` 标记的条目（`item.today === true`）。可在 DevTools Storage 查看 `todoData.sections[].items[].today`。

### Q: 跨日归档没有触发？
**A:** 检查 `lastRolloverDate` 是否被正确写入。启动时 sidepanel 会自动补跑遗漏归档。`background.js` 的午夜 alarm 依赖 `chrome.alarms` 权限。

### Q: 样式没有生效？
**A:** 检查 CSS 选择器优先级，使用 DevTools 检查元素的实际样式。

### Q: 如何清除所有数据？
**A:** 打开 DevTools → Application → Storage → Local Storage → 删除对应键值。注意 `completionHistory` 是长期历史，按需保留。

## 性能优化

- **防抖保存**：300ms 防抖，避免频繁写入
- **纯函数逻辑**：`daily-focus.js` 可独立 `require` 进行单测，无 Chrome API 依赖
- **事件委托**：任务池列表使用事件委托

## 待优化功能

- [ ] 任务搜索过滤
- [ ] 导入/导出 JSON 数据
- [ ] 快捷键支持（Ctrl+N 新建等）
- [ ] 暗色主题切换

## 安全注意事项

- ✅ 使用 `textContent` 而非 `innerHTML` 防止 XSS
- ✅ 输入内容自动 trim 去除首尾空格
- ✅ 数据存储在本地，不涉及网络请求
- ⚠️ 未来如需添加同步功能，需加密敏感数据

## UI 设计规范

### 布局优化原则

**对齐问题修复：**
- ❌ **错误**：使用 `align-items: flex-start` 会导致拖拽手柄、复选框、优先级徽章都靠上，与文字不对齐
- ✅ **正确**：使用 `align-items: center` 确保所有元素垂直居中对齐
- ✅ 移除复选框等元素的 `margin-top`，避免破坏居中对齐

**响应式宽度：**
- ✅ 移除 `max-width` 限制，允许侧边栏拉宽
- ✅ 固定元素（拖拽手柄、复选框、优先级、删除按钮）使用 `flex-shrink: 0`
- ✅ 任务内容使用 `flex: 1` 自动扩展填充剩余空间

**元素尺寸优化：**
- 拖拽手柄：12px（原 16px）
- 优先级徽章：20×20px（原 24×24px）
- 元素间距：6px（原 8px）
- 节省的空间全部用于任务内容显示

## Token Usage

项目开发过程中的 Token 使用统计：

| Checkpoint | Date | Session | Tokens | Cost |
|------------|------|---------|--------|------|
| #1 | 2026-02-07 | Planning | ~55,000 | $0.17 |
| #1 | 2026-02-07 | Implementation | 72,461 | $0.67 |
| #2 | 2026-02-07 | Obsidian Sync | ~93,000 | $2.09 |
| #3 | 2026-02-09~10 | Sync refinement + checkpoint | ~148,000 | $5.86 |
| #4 | 2026-02-11 | Clean Markdown + mobile | ~178,000 | $5.88 |
| #5 | 2026-02-11 | API key security | ~87,000 | $2.87 |
| #6 | 2026-02-27 | Timezone fix | ~25,000 | $0.82 |
| #7 | 2026-02-27 | File naming + GitHub | ~40,000 | $1.32 |
| #8 | 2026-03-11 | Todo tab + cross-move + UI | ~100,000 | $3.30 |
| **Total** | - | **All** | **~798,400** | **$22.98** |

**成本明细：**
- Checkpoint #1: Claude Sonnet 4.5 - Input $3/M, Output $15/M
- Checkpoint #2-3: Claude Opus 4.6 - Input $15/M, Output $75/M
- Estimated input/output ratio: 70/30

## 版本历史

**v1.0.0 (2026-02-07)**
- ✅ 基础任务管理功能
- ✅ 拖拽排序
- ✅ 优先级循环切换
- ✅ 点击内容编辑
- ✅ 已完成任务折叠
- ✅ 本地数据持久化
- ✅ UI 布局优化（标题、对齐、响应式宽度）

**v1.1.0 (2026-02-09)**
- ✅ Obsidian 双向同步（Local REST API）
- ✅ 设置面板 UI（API Key、Vault 路径、连接测试）
- ✅ 同步状态指示器
- ✅ Markdown 序列化/反序列化（保留 ID 和 order 元数据）
- ✅ 防冲突机制（本地编辑优先）

**v1.2.0 (2026-02-11)**
- ✅ Clean Markdown 格式（移除内联 HTML 注释元数据）
- ✅ 内容匹配机制（通过文本内容恢复任务 ID）
- ✅ 移动端友好编辑（1Writer 直接添加 `- [ ] 任务`）
- ✅ Daily rollover（跨日自动复制未完成任务）

**v1.2.1 (2026-02-27)**
- ✅ 修复时区 bug：日期计算从 UTC 改为本地时间
- ✅ Obsidian 文件名改为 `YYYYMMDD_Daily_Tasks.md` 格式
- ✅ 推送到 GitHub 仓库

**v2.0.0 (2026-03-11)**
- ✅ To-do List 标签页 + 双向同步 Obsidian `Todo_List.md`
- ✅ S/A/B/C 优先级 + 分类标签（家庭/工作/健康/学习）全面支持
- ✅ 跨标签移动（Daily ↔ Todo）+ Todo 内跨栏目移动（下拉菜单）
- ✅ UI 优化：同步指示器移至 header、来源引用改为图标 tooltip、行间距紧凑化

**v3.0.0 (2026-06-23)**
- ✅ **今日页重设计**：1-3 必做卡片（`#今日` 标记机制）+ 进度条 + streak mini 显示
- ✅ **完成反馈**：粒子特效 + 过渡动画；全部完成 → "所有必做完成！" 庆祝
- ✅ **超额完成**：正式必做完成后额外完成任务 → 金色高亮 + 超额计数
- ✅ **长期看板**：过去 7 周 streak、本周/本月超额 tally、徽章系统
- ✅ **跨日归档**：午夜 alarm + 启动 catch-up 双重触发；buildDayRecord 写入 completionHistory
- ✅ **任务池重定位**：任务池标签取代旧今日清单，#今日 标记选入今日必做
- ✅ **daily-focus.js**：纯函数逻辑，Node.js 可直接 require 测试
- ✅ **单元测试**：`tests/` 目录，21 个测试 100% pass（daily-focus + todo-sync + smoke）
- ✅ **清理旧路径**：移除旧 renderTasks/createTaskElement 等死代码；getActiveTasks/getCompletedTasks 从 task-manager.js 移除

---

**最后更新：** 2026-06-24
**维护者：** Claude AI
