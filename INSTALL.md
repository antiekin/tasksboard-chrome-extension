# 安装指南 - Tasksboard Chrome 插件

## 快速安装（5 分钟）

### 步骤 1：准备文件

确保项目文件夹包含以下文件：
```
✓ manifest.json
✓ background.js
✓ sidepanel.html
✓ sidepanel.css
✓ sidepanel.js
✓ storage.js
✓ task-manager.js
✓ icons/ (包含 4 个 PNG 图标)
```

### 步骤 2：打开 Chrome 扩展页面

1. 打开 Chrome 浏览器
2. 在地址栏输入：`chrome://extensions/`
3. 按 Enter 键

### 步骤 3：启用开发者模式

在扩展页面右上角，打开「**开发者模式**」开关（Developer mode）

### 步骤 4：加载插件

1. 点击左上角的「**加载已解压的扩展程序**」（Load unpacked）
2. 选择本项目的文件夹
3. 点击「选择」

### 步骤 5：完成安装

安装成功后，你会看到：
- 扩展列表中出现 "Tasksboard - Local Google Tasks"
- 浏览器工具栏出现蓝色图标

## 使用插件

### 打开侧边栏

**方法 1：点击图标**
- 点击浏览器工具栏中的 Tasksboard 图标

**方法 2：固定图标（推荐）**
1. 点击工具栏的拼图图标（扩展程序）
2. 找到 Tasksboard
3. 点击图钉图标固定到工具栏
4. 之后可随时点击打开

### 开始使用

1. 点击「+ Add a task」添加第一个任务
2. 点击任务内容直接编辑
3. 点击左侧优先级标记设置重要程度（S/A/B/C）
4. 拖拽任务调整顺序
5. 点击复选框标记完成

## 常见问题

### Q: 安装后找不到图标？
**A:** 点击浏览器工具栏的拼图图标，找到 Tasksboard 并固定。

### Q: 点击图标没反应？
**A:** 刷新扩展页面（chrome://extensions/），点击「重新加载」。

### Q: 侧边栏打不开？
**A:** 确保 Chrome 版本 ≥ 114（Side Panel API 要求）。更新 Chrome 到最新版本。

### Q: 数据会丢失吗？
**A:** 所有数据存储在本地，除非手动卸载插件或清除浏览器数据，否则不会丢失。

### Q: 如何卸载？
**A:** 在 `chrome://extensions/` 找到 Tasksboard，点击「移除」。

## 更新插件

修改代码后：
1. 打开 `chrome://extensions/`
2. 找到 Tasksboard
3. 点击刷新图标（↻）重新加载
4. 重新打开侧边栏查看更改

## 故障排除

### 检查浏览器版本
```
chrome://settings/help
```
确保 Chrome 版本 ≥ 114

### 查看错误日志
1. 右键点击侧边栏
2. 选择「检查」（Inspect）
3. 查看 Console 标签页的错误信息

### 重置数据
1. 打开 DevTools（F12）
2. Application → Storage → Local Storage
3. 找到扩展对应的存储，删除数据
4. 刷新侧边栏

## 需要帮助？

如果遇到问题：
1. 查看 README.md 了解功能说明
2. 查看 CLAUDE.md 了解技术细节
3. 检查 Console 是否有错误信息

---

**祝使用愉快！** 🎉
