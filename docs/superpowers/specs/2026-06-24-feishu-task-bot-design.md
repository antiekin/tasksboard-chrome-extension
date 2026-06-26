# 飞书任务机器人 — 设计文档

- **日期**：2026-06-24
- **状态**：待评审
- **子项目**：🅱️ 飞书任务机器人（依赖 🅰️ 扩展端 `todo.md` 数据契约，见 `2026-06-23-today-tasks-redesign-design.md`）

## 1. 背景与目标

Tasksboard 扩展端（🅰️）已完成 v3.0.0 重设计：今日页从任务池里 `#今日` 标记的条目中选 1-3 件必做。任务池的唯一数据源是 Obsidian 的 `1_memory/todo.md`，扩展通过 Obsidian Local REST API 双向同步。

本子项目（🅱️）补上"移动端快速录入"这一端：**在手机飞书里发一句话，机器人用 LLM 提炼成结构化任务，写入 `todo.md`，扩展自动读到。** 两端通过 `todo.md` 同一个文件解耦，互不依赖。

**核心目标：** 走路 / 临时想到事 → 一句话发给飞书机器人 → 任务自动落入任务池，必要时标为今日必做，无需打开电脑。

## 2. 范围

**MVP（本期做）：**
- 纯文字消息输入
- LLM 提炼：任务文本 + 优先级 + 分类 + 是否今日
- 写入 `todo.md`（默认"短期任务"栏目），必要时打 `#今日`
- 一条消息可拆成多个任务
- 即时回执（让用户核对提炼结果）

**非目标（下一版）：**
- 语音输入（需飞书语音资源下载权限 + ASR 转写，独立模块）
- 查询今日清单 / 任务池、标记任务完成
- 跨设备配置同步

## 3. 总览与数据流

```
手机飞书 ──文字──▶ [机器人 lark 长连接]
                        │ ① 白名单校验 + message_id 幂等去重
                        ▼
                   [task_extractor] ── OpenRouter sonnet（云雾 fallback）
                        │  → {tasks:[{text, priority, category, today}]}
                        ▼
                   [todo_writer] ── GET 算 #今日 计数 → PATCH 追加到「短期任务」
                        │            （#今日 满 3 则降级：只入池不打标）
                        ▼
                   [回执飞书] ── "✅ 已记录 N 条：• [A] 写方案 #工作 #今日 …"

   Chrome 扩展 每 3s poll Obsidian REST API ──▶ 读到新任务，今日页/任务池自动刷新
```

机器人和扩展都只通过 Obsidian Local REST API 读写 `todo.md`，不直接碰文件系统（绕开 LaunchAgent 的 CloudStorage/TCC 限制）。

## 4. 组件分解

各模块单一职责、可独立测试：

| 模块 | 职责 | 依赖 |
|------|------|------|
| `feishu_listener` | lark 长连接收 `im.message.receive_v1`；白名单校验；message_id 幂等去重；调用提炼+写入；发回执 | lark-oapi |
| `task_extractor` | 把一条消息文本 → 结构化任务数组（纯函数，无副作用，可单测） | OpenRouter / 云雾 |
| `todo_writer` | GET `todo.md` 算当前 `#今日` 计数 → 决定是否打标 → PATCH 追加任务行 | Obsidian REST API |
| `dedup_store` | 持久化已处理 message_id（SQLite，`INSERT OR IGNORE`） | sqlite3 |
| `config` | 飞书凭证 / Obsidian key / LLM keys / 白名单 / 文件路径 | — |

## 5. 关键决策

| # | 项 | 决定 | 理由 |
|---|----|------|------|
| 1 | 实现语言 | **Python** | 飞书生态（lark-oapi）+ LLM fallback 经验全是 Python，复用最高 |
| 2 | 飞书接入 | lark-oapi **长连接（WebSocket）** | 无需公网/回调，纯收发文字够用；启动客户端后到开发后台点"重新验证"才会变绿 |
| 3 | 飞书 app | **新建专门 app** | 一个 app 长连接只能一个客户端；不动现有 Claude-to-IM 桥接（它占用另一个 app） |
| 4 | LLM 渠道 | **OpenRouter `anthropic/claude-sonnet-4-6` 优先 → 云雾 `claude-sonnet-4-6` 兜底** | ⚠️ 本项目特例：与全局"云雾优先"惯例相反（用户指定）。429 fast-fail 立即换通道，错误聚合两通道 |
| 5 | 多任务 | **支持** | 一条"买菜、打电话、写方案"拆成 3 条 |
| 6 | 今日判断 | LLM 按语气设 `today` | "今天/今日/马上/必须今天"→ `true` |
| 7 | 回执 | **即写即回执**（不做"先确认再写"） | 快速记录场景；提炼错了再发一条改；`todo.md` 也可在扩展/Obsidian 里改 |
| 8 | 今日满 3 | 超出的**只入池不打 `#今日`** + 回执提示 | 尊重扩展 `MAX_MUST_DO=3` |
| 9 | 分类 | 只用 **家庭 / 工作 / 健康 / 学习** | `todo-sync.js` 只识别这 4 类；其他（如 `#副业`）扩展读不出分类 |
| 10 | 默认栏目 | **短期任务（7 天内完成）** | 与 🅰️ design spec 一致 |
| 11 | 白名单 | 仅用户本人 open_id | 防陌生人写入 |
| 12 | 部署 | iMac **LaunchAgent** 常驻 | 长连接需 24/7 |
| 13 | 代码位置 | 开发于 `<项目>/feishu-bot/`，部署 cp 到 `~/.local/feishu-task-bot/` | LaunchAgent 直接跑 CloudStorage 里的 .py 会 TCC exit 78；本地副本规避 |

## 6. 数据格式契约（严格对齐 `todo-sync.js`）

写入 `todo.md` 的任务行必须与扩展的 `toMarkdown()` 序列化格式完全一致，否则扩展 poll 时会把"格式不同"误判为远程变更并反复 rewrite。

```
- [ ] [优先级] 文本 #分类 #今日
```

字段顺序固定：

1. `- [ ] ` 复选框（新任务恒为未完成）
2. `[S]`/`[A]`/`[B]`/`[C]` 优先级（可缺省）
3. 任务文本
4. ` #分类`（家庭/工作/健康/学习之一，可缺省）
5. ` #今日`（被选为今日必做时，可缺省）

示例：

```
- [ ] [A] 写完项目方案初稿 #工作 #今日
- [ ] 买菜
- [ ] [B] 读《xxx》 #学习
```

> 解析端参考（`todo-sync.js`）：先用 `/^- \[([ x])\]\s+(?:\[([SABC])\]\s+)?(.+)$/` 提取复选框+优先级+正文；再剥 `#今日`；再提 `← [[wikilink]]`；最后用 `/^(.+?)\s+#(家庭|工作|健康|学习)$/` 提分类（要求分类在末尾）。机器人写入端无需复现解析，只需保证写出的行符合上述顺序。

## 7. LLM 提炼（`task_extractor`）

**输入：** 用户一条飞书消息文本。

**输出：** 严格 JSON。

```json
{
  "tasks": [
    {
      "text": "写完项目方案初稿",
      "priority": "A",
      "category": "工作",
      "today": true
    }
  ]
}
```

**字段规则（写进 system prompt）：**

- `text`：任务核心，去掉语气词/口水（"那个…帮我记一下"→ 不进 text）
- `priority`：`"S"|"A"|"B"|"C"|null`。仅当消息明确表达重要/紧急时给；否则 `null`（不强行赋值）
- `category`：`"家庭"|"工作"|"健康"|"学习"|null`。仅当明确归属时给；**不得**输出其他分类词
- `today`：`true|false`。消息表达"今天/今日/马上/现在/必须今天完成"等 → `true`
- 一条消息含多个任务时拆成多个数组元素
- 拿不准的字段一律给 `null`/`false`，不编造

**调用要点：**
- `max_tokens` 留足（结构化 JSON ≥ 预期输出 2 倍，避免截断）
- 渠道顺序：OpenRouter 优先 → 云雾兜底；429（或 `RateLimitError`）**fast-fail 立即换通道**，非 429（超时/5xx）同通道重试 1 次
- 两通道都失败：返回特殊标记，由 `feishu_listener` 走"提炼失败但不丢任务"分支（见 §9）
- 解析 JSON 前先剥可能的 ```json 围栏；`choices` 为空要 guard

## 8. 今日必做约束（满 3 降级）

写入前 `todo_writer` 先 GET `todo.md`，统计**未完成**的 `#今日` 条目数 `n`：

- 对每个 `today=true` 的待写任务，若 `n < 3` 则打 `#今日` 并 `n++`；否则降级为普通入池（不打标）
- 回执里对降级的任务给出提示："今日必做已满 3，「xxx」先入池，完成一个再设今日"

## 9. 幂等与错误处理

- **幂等**：飞书事件"至少一次"投递。收到消息先 `INSERT OR IGNORE` message_id 到 SQLite，`rowcount == 1` 才是首次、才处理；重投直接忽略。**认领要在处理失败时释放**（删除该 message_id），否则失败消息既无回执又无法重试，被永久吞掉
- **LLM 失败**：两通道都挂 → 回执"⚠️ 提炼失败"，并把**原始消息文本**作为单条任务原样写入"短期任务"（不丢任务，用户事后手动整理）
- **Obsidian REST API 不可用**：回执报错（"写入失败，稍后重试"）+ 指数退避重试；不静默吞
- **长连接断开**：lark SDK 自带重连；外层 LaunchAgent `KeepAlive=true` 兜底进程级重启
- **回执发送失败**：记日志告警；任务已写入则不影响数据正确性

## 10. 飞书 app 配置（实现清单）

- 新建自建应用（正式应用），开启长连接模式
- 权限 scope（**应用身份**）：
  - `im:message` 或 `im:message:readonly`（接收消息——收消息需应用身份，不是 `im:resource`）
  - `im:message:send_v2`（发回执）
- 事件订阅：`im.message.receive_v1`（长连接模式无需配回调 URL）
- 改权限/事件后必须**创建版本 → 发布**才生效；发布后**重启长连接客户端**（tenant_access_token 缓存 ~2h，旧 token 无新 scope）
- **获取 open_id**：首次启动时把收到消息的 sender open_id 打到日志，据此填白名单
- 凭证（app_id / app_secret）存 `~/.claude/api-keys.json`（命名如 `FEISHU_TASKBOT_APP_ID` / `_SECRET`），**不进 git**

## 11. 部署

- **解释器**：Intel iMac 用 homebrew python（`/usr/local/bin/python3.x`，`import ssl` 正常）建 venv，**不用 pyenv**（SSL 缺失坑）
- **依赖**：lark-oapi + openai（兼容 OpenRouter/云雾）+ requests，无 ML 库（Intel 无 llvmlite 噩梦）
- **代码部署**：开发于项目 `feishu-bot/`，部署 `cp`/`rsync` 到 `~/.local/feishu-task-bot/`（非 CloudStorage，规避 LaunchAgent TCC exit 78）。改完源码须手动重新部署（双源漂移风险，部署脚本固化）
- **LaunchAgent**：`com.feishu-task-bot.runner`，`KeepAlive=true`、`RunAtLoad=true`、`ThrottleInterval=10`；`EnvironmentVariables.PATH` 含 `~/.local/bin`
- **网络**：OpenRouter 海外，iMac 走代理时注意 Surge 长请求超时（必要时给 `openrouter.ai` 加 DIRECT 规则）；云雾国内直连。`openai` SDK 显式传 `http_client=httpx.Client(trust_env=False)` + `max_retries` 控制，避免被系统代理挂住
- **密钥**：飞书 secret / Obsidian REST key / OpenRouter key / 云雾 key 全部从 `~/.claude/api-keys.json` 读取，每机独立、不进 git

## 12. 测试

- `task_extractor`：喂样例消息（单任务/多任务/带今日/带分类/无优先级/口水话），断言输出 JSON 结构与字段值
- `todo_writer`：构造任务对象 → 断言序列化出的行与 `todo-sync.js` 的 `toMarkdown()` 往返一致（可共享 fixture）；满 3 降级逻辑单测
- `dedup_store`：同一 message_id 二次 `INSERT OR IGNORE` 返回 rowcount 0；失败释放后可重新认领
- 端到端：发飞书消息 → 查 `todo.md` 内容 + 扩展今日页/任务池渲染

## 13. 验收标准

- 手机飞书发一句话 → 数秒内收到回执 + `todo.md` 出现对应任务行
- 一条消息含多个任务 → 拆成多行写入
- 消息表达"今天" → 任务带 `#今日`，且扩展今日页能显示
- 当前已有 3 个 `#今日` 时再设今日 → 该任务只入池、回执提示满额
- 写入行格式与扩展序列化一致：扩展 poll 后不产生"幽灵变更"反复 rewrite
- 同一消息被飞书重投 → 只处理一次（不重复写入）
- LLM 两通道都失败 → 原文仍入池，不丢任务
- 非白名单用户发消息 → 不处理

## 14. 开放 / 可调项

- 模型档位（sonnet vs 更便宜的小模型，取决于提炼质量）
- 回执详略（是否回显完整字段、是否用交互卡片）
- 满 3 降级文案
- 代码部署路径（`~/.local/` 本地副本 vs `.app` wrapper + FDA）
- 默认栏目是否可由消息指定（如"记到 ideas：xxx"）
