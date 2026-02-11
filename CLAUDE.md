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
├── background.js          # 后台服务 worker，处理侧边栏打开和初始化
├── sidepanel.html         # 主界面 HTML 结构
├── sidepanel.css          # 样式表，包含动画和主题颜色
├── sidepanel.js           # UI 控制器，处理所有 DOM 操作和事件
├── storage.js             # 存储抽象层，封装 chrome.storage.local API
├── task-manager.js        # 业务逻辑层，纯逻辑无 DOM 操作
├── obsidian-sync.js       # Obsidian 双向同步引擎（Local REST API）
└── icons/                 # 扩展图标
```

### 架构分层

```
UI Layer (sidepanel.js)
    ↓ 用户交互触发事件
Business Logic (task-manager.js)
    ↓ 处理数据和业务规则
Storage Layer (storage.js)          Sync Layer (obsidian-sync.js)
    ↓ 数据持久化                        ↓ 双向同步
chrome.storage.local API            Obsidian Local REST API
```

**关键原则：**
- `task-manager.js` 不依赖 DOM，可独立测试
- `sidepanel.js` 只处理 UI 逻辑，调用 task-manager 方法
- `storage.js` 提供统一的存储接口，隔离 Chrome API

## 数据模型

### 任务对象 (Task)

```javascript
{
  id: "uuid-string",              // 唯一标识符
  content: "任务内容",             // 任务文本
  priority: "S"|"A"|"B"|"C"|null, // 优先级 (S最高, C最低, null无)
  completed: false,               // 完成状态
  order: 0,                       // 排序序号（越小越靠前）
  createdAt: "2026-02-07",        // 创建日期 (ISO YYYY-MM-DD)
  completedAt: null               // 完成时间 (ISO string or null)
}
```

### 存储结构

```javascript
{
  tasks: [...],                   // 任务数组
  preferences: {                  // 用户偏好
    completedSectionExpanded: false
  }
}
```

## 核心功能实现

### 1. 任务拖拽排序

**实现方式：**
- 使用 HTML5 Drag and Drop API
- 拖拽时添加 `.dragging` 类（半透明效果）
- `dragover` 事件中动态调整 DOM 顺序
- `dragend` 事件中更新所有任务的 `order` 值并保存

**关键函数：**
- `setupDragAndDrop()` - 绑定拖拽事件
- `getDragAfterElement()` - 计算插入位置
- `taskManager.normalizeOrders()` - 重新计算顺序号（0, 1, 2...）

### 2. 优先级循环切换

**交互流程：**
点击优先级标记 → S → A → B → C → 无 → S（循环）

**实现：**
- `taskManager.cyclePriority(id)` - 业务逻辑
- `priorityLevels` 数组定义循环顺序
- CSS 类 `priority-s/a/b/c` 控制颜色

**颜色编码：**
- S: `#EA4335` (红色) - 超重要
- A: `#F9AB00` (橙色) - 重要
- B: `#4285F4` (蓝色) - 普通
- C: `#80868B` (灰色) - 低优先级

### 3. 点击内容编辑

**实现：**
- 任务 content 使用 `contenteditable` 属性
- `blur` 事件保存修改
- `Enter` 键触发 blur 保存
- `Escape` 键恢复原内容并取消编辑

**注意：**
- 使用 `textContent` 而非 `innerHTML` 防止 XSS
- 编辑时显示蓝色边框（`.task-content:focus` 样式）

### 4. 已完成任务管理

**行为：**
- 点击复选框 → 任务标记完成 → 移到底部 "Completed (n)" 区域
- 已完成任务：灰色、删除线、不可拖拽
- 点击 "Completed" 标题 → 折叠/展开
- 折叠状态持久化到 `preferences.completedSectionExpanded`

### 5. 数据持久化

**策略：**
- 所有修改操作调用 `saveTasksDebounced()`
- 防抖 300ms 后保存到 `chrome.storage.local`
- 仅显示 `createdAt === 今日日期` 的任务
- 自动清理 7 天前的已完成任务（`cleanupOldTasks()`）

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

1. **修改数据模型** → 更新 `task-manager.js` 中的任务对象
2. **添加业务逻辑** → 在 `TaskManager` 类中添加新方法
3. **更新 UI** → 修改 `sidepanel.html` 和 `sidepanel.css`
4. **绑定交互** → 在 `sidepanel.js` 中添加事件处理

### 如何修改样式

- **颜色** → 修改 `:root` CSS 变量
- **间距** → 修改 `--spacing-*` 变量
- **动画** → 调整 `--transition-*` 变量或 `@keyframes`

### 如何调试

1. 在 `chrome://extensions/` 重新加载插件
2. 右键侧边栏 → 「检查」打开 DevTools
3. 查看 Console 日志
4. 在 Application → Storage → Local Storage 查看数据

## 常见问题

### Q: 任务没有保存？
**A:** 检查 Console 是否有存储错误，确认 `chrome.storage.local` 权限已在 manifest.json 中声明。

### Q: 拖拽排序不工作？
**A:** 确保任务元素设置了 `draggable="true"` 且未被标记为 `completed`。

### Q: 样式没有生效？
**A:** 检查 CSS 选择器优先级，使用 DevTools 检查元素的实际样式。

### Q: 如何清除所有数据？
**A:** 打开 DevTools → Application → Local Storage → 删除对应键值。

## 性能优化建议

- **防抖保存**：已实现 300ms 防抖，避免频繁写入
- **DOM 批量更新**：`renderTasks()` 一次性渲染所有任务
- **事件委托**：可考虑在容器上使用事件委托替代单个绑定
- **虚拟滚动**：任务超过 100 个时可考虑虚拟滚动优化

## 待优化功能

- [ ] 添加扩展图标（16/32/48/128px PNG）
- [ ] 任务搜索过滤
- [ ] 任务分组功能
- [ ] 导入/导出 JSON 数据
- [ ] 快捷键支持（Ctrl+N 新建等）
- [ ] 暗色主题切换
- [ ] 任务统计和可视化

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
| **Total** | - | **All** | **~546,400** | **$14.67** |

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

---

**最后更新：** 2026-02-11
**维护者：** Claude AI
