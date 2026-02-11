# Tasksboard - 本地 Google Tasks Chrome 插件

轻量级、高性能的本地任务管理插件，专注于当日任务管理，解决云端版本加载速度慢的问题。

## ✨ 功能特性

- **快速加载** - 纯原生 JavaScript，无依赖，秒开
- **当日任务** - 专注今天的任务，简洁高效
- **优先级管理** - S/A/B/C 四级优先级，颜色编码一目了然
- **拖拽排序** - 直观的拖拽操作调整任务顺序
- **点击编辑** - 点击任务内容直接编辑，无需额外按钮
- **已完成任务** - 自动折叠已完成任务，保持界面整洁
- **本地存储** - 所有数据存储在本地，快速且私密
- **Obsidian 同步** - 通过 Local REST API 与 Obsidian vault 双向同步

## 📦 安装步骤

### 方法一：开发者模式加载（推荐）

1. 下载或克隆本项目到本地
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 打开右上角的「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择项目文件夹
6. 安装完成！点击工具栏中的插件图标打开侧边栏

### 方法二：打包安装

1. 在 `chrome://extensions/` 页面点击「打包扩展程序」
2. 选择项目文件夹，生成 `.crx` 文件
3. 将 `.crx` 文件拖拽到扩展程序页面安装

## 🎯 使用说明

### 基本操作

- **添加任务**：点击「+ Add a task」按钮
- **编辑任务**：点击任务内容直接编辑，按 Enter 保存，ESC 取消
- **完成任务**：点击任务前的圆形复选框
- **删除任务**：悬停任务时点击右侧的 × 按钮

### 优先级管理

- **设置优先级**：点击任务左侧的优先级标记
- **循环切换**：S → A → B → C → 无 → S
- **颜色含义**：
  - 🔴 S (红色) - 超重要
  - 🟠 A (橙色) - 重要
  - 🔵 B (蓝色) - 普通
  - ⚪ C (灰色) - 低优先级

### 任务排序

- 拖拽任务左侧的 ⋮⋮ 图标到目标位置
- 松开鼠标即可保存新顺序

### 已完成任务

- 已完成任务自动移到底部「Completed」区域
- 点击「Completed (n)」标题可折叠/展开
- 折叠状态会自动保存

## 🛠 技术架构

### 技术栈

- **Manifest V3** - Chrome 扩展最新标准
- **Side Panel API** - Chrome 114+ 侧边栏
- **原生 JavaScript** - 无构建工具，零依赖
- **chrome.storage.local** - 本地数据持久化

### 文件结构

```
├── manifest.json          # 扩展配置
├── background.js          # 后台服务 worker
├── sidepanel.html         # 主界面结构
├── sidepanel.css          # 样式表
├── sidepanel.js           # UI 控制器
├── storage.js             # 存储抽象层
├── task-manager.js        # 业务逻辑层
├── obsidian-sync.js       # Obsidian 同步引擎
└── icons/                 # 扩展图标
```

### 架构分层

```
UI Layer (sidepanel.js)
    ↓ 事件触发
Business Logic (task-manager.js)
    ↓ 数据操作
Storage Layer (storage.js)
    ↓ 持久化
chrome.storage.local API
```

### 数据模型

```javascript
{
  id: "uuid-string",              // 唯一标识符
  content: "任务内容",             // 任务文本
  priority: "S"|"A"|"B"|"C"|null, // 优先级
  completed: false,               // 完成状态
  order: 0,                       // 排序序号
  createdAt: "2026-02-07",        // 创建日期
  completedAt: null               // 完成时间
}
```

## 🔧 开发指南

### 修改代码

1. **UI 样式修改** → 编辑 `sidepanel.css`
2. **界面结构修改** → 编辑 `sidepanel.html`
3. **交互逻辑修改** → 编辑 `sidepanel.js`
4. **业务逻辑修改** → 编辑 `task-manager.js`
5. **存储逻辑修改** → 编辑 `storage.js`

### 调试

1. 在 `chrome://extensions/` 点击「重新加载」更新插件
2. 右键点击侧边栏 → 「检查」打开开发者工具
3. 查看 Console 日志和 Network 请求

### 数据清理

- 打开开发者工具 → Application → Storage → Local Storage
- 找到对应扩展的存储，可手动清除数据

## 📝 待优化功能

- [x] 添加扩展图标（icons/）- 已完成
- [ ] 任务搜索过滤功能
- [ ] 任务分组功能
- [ ] 导入/导出任务
- [ ] 快捷键支持
- [ ] 暗色主题
- [ ] 任务统计视图

## 📊 开发进度

### 2026-02-07 10:44 - Initial Release & UI Optimization

**完成内容：**
- ✅ 完整实现所有核心功能（任务CRUD、优先级、拖拽排序、本地存储）
- ✅ 创建完整的项目文档（8份文档覆盖用户和开发者需求）
- ✅ 生成扩展图标（4个尺寸）
- ✅ 优化界面布局：
  - 标题改为"今日任务"，删除副标题
  - 缩小拖拽手柄和优先级徽章，增加任务内容显示区域
  - 移除最大宽度限制，支持拉宽时内容区域自适应扩展
  - 修复垂直对齐问题，所有元素居中对齐

**技术架构：**
- Manifest V3 + Side Panel API
- 原生 JavaScript（零依赖）
- 三层架构：UI Layer → Business Logic → Storage Layer

**Token 使用：** 127,461 tokens ($0.84)

**项目状态：** ✅ 生产就绪（Production Ready）

### 2026-02-10 07:30 - Checkpoint #3 (Obsidian Sync + Maintenance)

**自上次 checkpoint 以来完成内容：**
- ✅ 实现 Obsidian 双向同步（通过 Local REST API 插件）
  - 新增 `obsidian-sync.js` 引擎：Markdown 序列化/反序列化、轮询检测远程变更
  - 新增设置面板 UI：API Key 配置、连接测试、启用/禁用同步
  - 支持 HTTPS（27124 端口）和 HTTP（27123 端口）自动切换
  - 双向同步：本地编辑推送到 Obsidian，Obsidian 编辑拉取到插件
  - 防冲突机制：本地编辑期间暂停远程拉取
- ✅ manifest.json 添加 host_permissions 支持 REST API 访问
- ✅ 设置面板 CSS 样式与同步状态指示器

**代码质量：** 零 TODO/FIXME，代码整洁，无技术债务
**Token 使用：** ~368,400 tokens ($8.79)

### 2026-02-11 17:10 - Checkpoint #4 (Clean Markdown for Mobile)

**自上次 checkpoint 以来完成内容：**
- ✅ 移除 Markdown 内联 HTML 注释元数据（`<!-- id:xxx order:N -->`）
  - `taskToMarkdown()` 现在输出干净的 `- [ ] [A] 任务内容` 格式
  - 在 1Writer/手机上编辑更加友好：直接添加 `- [ ] 新任务` 即可
- ✅ 新增内容匹配机制 `matchRemoteToLocal()`
  - 通过任务内容文本匹配恢复 ID、createdAt、completedAt
  - 支持任务完成状态在移动端改变后的匹配
- ✅ 向后兼容：旧格式文件仍可正确解析，下次同步自动转为新格式
- ✅ Daily rollover 功能（跨日自动复制未完成任务）

**Token 使用：** ~178,000 tokens ($5.88) | 累计 ~546,400 tokens ($14.67)

### 2026-02-11 17:30 - Checkpoint #5 (API Key Security)

**自上次 checkpoint 以来完成内容：**
- ✅ 创建 `~/.claude/api-keys.json` 集中管理密钥
- ✅ 清理 settings.local.json 中两条含明文密钥的 permission 条目
- ✅ 更新 checkpoint skill：禁止自动添加含密钥的命令，新增 permissions 变更报告
- ✅ 全局 CLAUDE.md 新增 API Key Management 规则

**Token 使用：** ~87,000 tokens ($2.87) | 累计 ~633,400 tokens ($17.54)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License - 自由使用和修改

---

**注意**：本插件所有数据存储在本地浏览器中，不会上传到任何服务器。
