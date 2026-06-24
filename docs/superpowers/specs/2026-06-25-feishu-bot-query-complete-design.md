# 飞书任务机器人 v2 — 查询 + 标记完成 设计文档

- **日期**：2026-06-25
- **状态**：待评审
- **基线**：v1（`2026-06-24-feishu-task-bot-design.md`，已上线常驻）。本文档是 v1 的功能扩展，不改变 v1 的"加任务"行为。

## 1. 背景与目标

v1 的 bot 把**所有**消息当"加任务"（提炼 → 写入 `todo.md`）。v2 在同一条消息入口岔出两条新路径——**查询**与**标记完成**——让用户在手机上不仅能记任务，还能查看和勾掉任务。

**MVP 范围（本期做）：**
- **标记完成**：发"买菜做完了" → 把 `todo.md` 里最匹配的未完成任务标 `[x]`
- **查今日必做**：发"今天还有啥" → 列出当前 `#今日` 项 + 完成进度
- **查/筛任务池**：发"列一下工作的任务" → 按分类/栏目列出任务

**非目标（下一版）：** 删除、取消今日、改优先级/分类、移栏目、取消完成。

## 2. 关键决策

| # | 项 | 决定 |
|---|----|------|
| D1 | 意图识别 | **LLM 自动识别**：一次 LLM 调用同时判意图（add/query_today/query_pool/complete）+ 提炼/定位。延续 v1"发一句话"体验 |
| D2 | LLM 调用次数 | **每条消息一次**：总是先读 `todo.md` 解析任务列表，连同消息喂 LLM。统一简单；`todo.md` 小，开销可忽略 |
| D3 | 标记完成的定位 | **LLM 从真实任务列表里选最匹配的一条**（返回精确全文）；即使多条也选最像的，不回问 |
| D4 | 标记完成的反馈 | 回执显示**被标记任务的完整原文**，让用户立即发现标错；无匹配 → 回执"没找到" |
| D5 | Python 解析器 | **移植扩展端 `todo-sync.js` 的 `parseTodoMarkdown`/`toMarkdown` 到 Python**，作为查询与修改的共同地基 |
| D6 | LLM 全失败 | 沿用 v1 §9：**原文入池**（无法判意图时的保守默认——大多数消息是加任务，当 add 处理最不易丢） |

## 3. 总览与数据流

```
消息 → read_todo + parse_todo（任务列表）→ [LLM 一次调用] → {intent, payload}
                                                    │ 按 intent 路由
   add        → write_tasks（v1 现有）               → "✅ 已记录 N 条…"
   query_today→ 筛 today 且未完成                     → "📋 今日必做 (1/3)…"
   query_pool → 按 category/section 筛               → "工作任务…"
   complete   → 找 complete_match 未完成行 → 标[x]    → "✅ 已完成：[全文]"
              → serialize_todo → write_todo（整文件）   complete_match=null → "没找到…"
```

## 4. LLM 一次调用（扩展 `task_extractor`）

### 4.1 输入

`build_messages(user_text, task_list)` 在 user 消息里注入**当前任务列表**（供意图判断 + 定位）。task_list 由 `parse_todo` 产出后压缩成精简文本，每条含：所属栏目、文本、优先级、分类、是否今日、是否完成。例如：

```
当前任务（供你判断意图和定位「标记完成」的目标）：
[短期任务] 写项目方案 #工作 #今日 (未完成)
[短期任务] 买菜 #今日 (未完成)
[短期任务] 看球 #今日 (未完成)
[中长期任务] [S] 写"Ella 教育宪章" #家庭 (未完成)
...
```

### 4.2 输出 JSON

```json
{
  "intent": "add | query_today | query_pool | complete",
  "tasks": [{"text": "...", "priority": "S|A|B|C|null", "category": "家庭|工作|健康|学习|null", "today": true}],
  "pool_filter": {"category": "家庭|工作|健康|学习|null", "section": "栏目名|null"},
  "complete_match": "todo.md 里最匹配的未完成任务全文，或 null"
}
```

字段规则（写进 system prompt）：
- `intent=add`：填 `tasks`（沿用 v1 规则：优先级/分类/今日判断、多任务拆分、拿不准给 null）
- `intent=query_today`：无额外 payload
- `intent=query_pool`：填 `pool_filter`。用户说"工作的任务"→ `category:"工作"`；说某栏目名 → `section`；泛指"任务池/还有什么"→ 两者皆 null（全部池子）
- `intent=complete`：从注入的任务列表里挑**最匹配且未完成**的一条，把它的**精确全文**（含分类/今日 tag 之外的纯文本，见 §6 定位）放进 `complete_match`；没有合理匹配 → `null`
- 只输出 JSON，拿不准的字段一律 null

### 4.3 渠道与失败

- 渠道顺序不变（OpenRouter → 云雾，429 fast-fail）
- `max_tokens` 适度上调（输出含任务列表回显风险时；提炼本身仍小）
- 全失败（`AllChannelsFailed`）→ D6：按 add 原文入池

## 5. Python `todo.md` 解析器/序列化器（新 `todo_parser.py`）

移植 `todo-sync.js` 的两个纯函数，逻辑逐行对齐（保证与扩展端零格式漂移）：

- `parse_todo(markdown) -> {"preamble": str, "sections": [{"name", "comment", "items": [item]}]}`
  - `item = {"text", "priority": "S|A|B|C|None", "category": "家庭|工作|健康|学习|None", "today": bool, "completed": bool, "reference": "[[..]]|None"}`
  - 解析顺序对齐 JS：匹配 `- [ /x] [优先级] 正文` → 剥 `#今日` → 提 `← [[ref]]` → 提分类（四类之一、须在末尾）
- `serialize_todo(data) -> markdown`
  - 行格式对齐 JS `toMarkdown`：`- [{x| }] {[优先级] }{text}{ #分类}{ #今日}{ ← ref}`，保留 preamble、每段 comment、栏目间空行

**契约测试**：用真实 `todo.md` 做 `parse_todo → serialize_todo` 往返，断言与原文逐字节一致（或仅规范化空行差异）。这是 v2 不破坏现有数据的关键保障。

## 6. 标记完成（`todo_writer.complete_task`）

```
complete_task(match_text, reader=read_todo, writer=write_todo) -> str | None
```
1. `read_todo` → `parse_todo`
2. 遍历所有 sections 的 items，找第一条 `text == match_text 且 not completed`
   - 匹配用解析后的纯 `text`（已剥离优先级/分类/今日 tag）；LLM 的 `complete_match` 也应是纯文本。为容错，先精确匹配，再退化为去空格/标点的宽松包含匹配
3. 命中 → `item.completed = True` → `serialize_todo` → `writer`；返回该 item 的展示全文（纯 text + 分类，用于回执）
4. 未命中 → 返回 `None`

**并发**：read-modify-write 整文件（同 v1 `write_tasks`）。扩展平时只读 poll，仅用户主动编辑时 PUT，冲突窗口极小，MVP 接受。

## 7. 查询（`todo_writer` 或 `feishu_listener`）

- `query_today()`：`parse_todo` → 跨 section 收集 `today=True` 的 items → 按 completed 分组 → 返回结构供回执
- `query_pool(category=None, section=None)`：`parse_todo` → 按条件筛未完成 items（category 命中分类、section 命中栏目名；都 None = 全部未完成池子项）→ 返回结构供回执

## 8. 回执格式（`feishu_listener`，默认可调）

- **add**：沿用 v1 `format_receipt`
- **query_today**：
  ```
  📋 今日必做 (1/3)
  ✅ 买菜
  ⬜ 写项目方案 #工作
  ⬜ 看球
  ```
- **query_pool**：按栏目分组列未完成项；**超过 15 条**截断 + "…还有 N 条，去扩展看"
- **complete**：`✅ 已完成：去超市买菜 #家庭`；未命中 `🔍 没找到匹配「买菜」的任务，可换个说法或去扩展操作`

## 9. 意图路由（`feishu_listener.handle_message` 扩展）

`deps` 新增 `.complete`（callable(match)->str|None）、`.query_today`、`.query_pool`（callable->结构）。`extract` 返回值从 `list` 改为 `{intent, ...}` dict。

```
result = deps.extract(text)            # {intent, tasks, pool_filter, complete_match}
intent = result["intent"]
if intent == "add":          → deps.write(result["tasks"]) → format_receipt
elif intent == "query_today":→ format_today(deps.query_today())
elif intent == "query_pool": → format_pool(deps.query_pool(**result["pool_filter"]))
elif intent == "complete":   → format_complete(deps.complete(result["complete_match"]))
```
- 白名单、幂等去重：不变
- `AllChannelsFailed`：按 add 原文入池（D6），保持 v1 行为
- 写回/查询中任何异常 → 释放 claim + 回执报错（同 v1 外层 except）
- **幂等注意**：查询是只读的，但仍走 message_id 去重（重投的查询不必重复执行；无副作用，重复也无害，但统一处理更简单）

## 10. 受影响文件

| 文件 | 改动 |
|------|------|
| `todo_parser.py`（新） | `parse_todo` + `serialize_todo`（移植 `todo-sync.js`，纯函数可单测） |
| `task_extractor.py` | system prompt 加意图规则；输出 schema 加 `intent`/`pool_filter`/`complete_match`；`build_messages` 注入任务列表；返回 dict |
| `todo_writer.py` | 新增 `complete_task`、`query_today`、`query_pool`；可复用 `todo_parser`（`write_tasks` 的局部 insert 保留不动） |
| `feishu_listener.py` | `handle_message` 按 intent 路由；新增 `format_today`/`format_pool`/`format_complete` |
| `main.py` | `_deps` 装配新增 `complete`/`query_today`/`query_pool` |
| `tests/` | parser 往返、4 种 intent 解析、complete 定位+写回、query 筛选、路由 |

## 11. 测试

- `todo_parser`：真实 `todo.md` 往返一致；各字段（优先级/分类/今日/完成/reference）解析正确
- `task_extractor`：mock LLM 返回各 intent JSON，断言解析正确；intent 缺省/非法 → 安全默认（当 add）
- `complete_task`：命中标记 + 写回；未命中返回 None；已完成项不重复标；宽松匹配
- `query_today`/`query_pool`：筛选正确、分组正确
- `handle_message`：4 种 intent 路由（注入 fake deps）；`AllChannelsFailed` → 原文入池

## 12. 验收标准

- 发"今天还有啥" → 回执今日必做 + `(已完成/总数)` 进度
- 发"列一下工作的任务" → 回执仅 `#工作` 未完成项
- 发"买菜做完了" → `todo.md` 对应行变 `[x]` + 回执显示被标记任务全文；扩展 3s 内反映
- 发一条无匹配的完成意图 → 回执"没找到"，`todo.md` 不变
- 加任务（v1 行为）仍正常，intent 正确识别为 add
- `parse_todo→serialize_todo` 往返不破坏 `todo.md`（preamble/comment/reference/其他任务/已完成项全部保留）
- 重投消息仍只处理一次

## 13. 开放 / 可调项

- 任务池查询截断阈值（默认 15）
- 标记完成的宽松匹配激进程度（精确优先，多激进退化到包含匹配）
- 是否在 add 时利用注入的任务列表做重复提示（本期不做，YAGNI）
