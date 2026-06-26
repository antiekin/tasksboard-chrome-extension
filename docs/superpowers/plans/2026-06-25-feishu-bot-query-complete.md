# 飞书机器人 v2(查询 + 标记完成)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有飞书 bot 上加 LLM 意图识别,支持「查今日 / 查任务池 / 标记完成」,不改变 v1「加任务」行为。

**Architecture:** 每条消息先读 `todo.md` 解析成任务列表,连同消息喂 LLM 一次,返回 `{intent, payload}`;`handle_message` 按 intent 路由到 add / query_today / query_pool / complete。新增 Python `todo.md` parser/serializer(移植 `todo-sync.js`)作为查询与修改的地基。

**Tech Stack:** Python 3.12、现有 feishu-bot 模块、pytest。开发 venv 在 `feishu-bot/venv`。

## Global Constraints

- **测试命令**(在 `feishu-bot/` 下):`venv/bin/python -m pytest tests/ -v`
- **LLM 输出 schema**:`{"intent": "add|query_today|query_pool|complete", "tasks": [...], "pool_filter": {"category": <四类|null>, "section": <str|null>}, "complete_match": <str|null>}`
- **parser 对齐 `todo-sync.js`**:`parse_todo` 逐行对齐 `parseTodoMarkdown`,`serialize_todo` 对齐 `toMarkdown`。任务行格式 `- [ /x] [优先级] 文本 #分类 #今日 ← [[ref]]`(顺序固定)
- **分类仅** 家庭/工作/健康/学习;**优先级** S/A/B/C
- **complete_match 是纯任务文本**(不含 `#分类`/`#今日` tag);定位匹配用 parse 后的 `item.text`
- **标记完成**:找第一条 `text==match && not completed` → `completed=True` → `serialize_todo` 整文件写回 → 回执显示被标记任务全文;无匹配回执"没找到"
- **LLM 全失败**(`AllChannelsFailed`)→ 按 add 原文入池(沿用 v1 §9)
- **查询截断**:任务池查询超过 15 条截断 + 提示
- **沿用 v1**:白名单、message_id 幂等去重、渠道顺序(OpenRouter→云雾)、写入走 Obsidian REST、`DIBRAIN_OBSIDIAN_REST_API_KEY`
- 部署:改代码后重跑 `feishu-bot/deploy/deploy.sh`

文件结构:

```
feishu-bot/
├── todo_parser.py        # 新:parse_todo + serialize_todo(移植 todo-sync.js)
├── task_extractor.py     # 改:intent schema + 注入任务列表 + 返回 dict
├── todo_writer.py        # 改:complete_task + query_today + query_pool
├── feishu_listener.py    # 改:handle_message intent 路由 + format_today/pool/complete
├── main.py               # 改:_deps 装配 read_tasks/complete/query_today/query_pool
└── tests/                # 改/加:test_todo_parser、各 intent、路由
```

---

### Task 1: `todo_parser.py` — 解析与序列化(移植 todo-sync.js)

**Files:**
- Create: `feishu-bot/todo_parser.py`
- Test: `feishu-bot/tests/test_todo_parser.py`

**Interfaces:**
- Produces:
  - `parse_todo(markdown: str) -> dict` → `{"preamble": str, "sections": [{"name": str, "comment": str|None, "items": [item]}]}`，`item = {"text", "priority": str|None, "category": str|None, "today": bool, "completed": bool, "reference": str|None}`
  - `serialize_todo(data: dict) -> str`

- [ ] **Step 1: 写失败测试** — `feishu-bot/tests/test_todo_parser.py`

```python
import todo_parser as tp

SAMPLE = (
    "---\ntitle: T\n---\n\n# To-do List\n"
    "## 短期任务（7 天内完成）\n<!-- c -->\n"
    "- [ ] [A] 写方案 #工作 #今日\n"
    "- [x] 买菜 #今日\n"
    "- [ ] 看书 ← [[20260101_笔记]]\n"
    "\n## 其他\n- [ ] 杂事\n"
)


def test_parse_fields():
    d = tp.parse_todo(SAMPLE)
    s0 = d["sections"][0]
    assert s0["name"] == "短期任务（7 天内完成）"
    assert s0["comment"] == "<!-- c -->"
    it = s0["items"]
    assert it[0] == {"text": "写方案", "priority": "A", "category": "工作",
                     "today": True, "completed": False, "reference": None}
    assert it[1]["completed"] is True and it[1]["today"] is True and it[1]["text"] == "买菜"
    assert it[2]["reference"] == "[[20260101_笔记]]" and it[2]["text"] == "看书"


def test_roundtrip_idempotent():
    once = tp.parse_todo(SAMPLE)
    twice = tp.parse_todo(tp.serialize_todo(once))
    assert once["sections"] == twice["sections"]
    assert once["preamble"].strip() == twice["preamble"].strip()


def test_serialize_line_format():
    out = tp.serialize_todo(tp.parse_todo(SAMPLE))
    assert "- [ ] [A] 写方案 #工作 #今日" in out
    assert "- [x] 买菜 #今日" in out
    assert "- [ ] 看书 ← [[20260101_笔记]]" in out
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && venv/bin/python -m pytest tests/test_todo_parser.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'todo_parser'`）

- [ ] **Step 3: 写 `todo_parser.py`**

```python
"""Parse / serialize Obsidian todo.md — ported line-for-line from todo-sync.js."""
import re

_TASK = re.compile(r"^- \[([ x])\]\s+(?:\[([SABC])\]\s+)?(.+)$")
_REF = re.compile(r"^(.+?)\s+←\s+(\[\[.+?\]\])$")
_CAT = re.compile(r"^(.+?)\s+#(家庭|工作|健康|学习)$")


def parse_todo(markdown):
    if not markdown:
        return {"preamble": "", "sections": []}
    lines = markdown.split("\n")
    preamble_end = len(lines)
    for i, ln in enumerate(lines):
        if ln.startswith("## "):
            preamble_end = i
            break
    preamble = "\n".join(lines[:preamble_end])
    sections, current = [], None
    for ln in lines[preamble_end:]:
        if ln.startswith("## "):
            current = {"name": ln[3:].strip(), "comment": None, "items": []}
            sections.append(current)
            continue
        if current is None:
            continue
        s = ln.strip()
        if s.startswith("<!--") and s.endswith("-->"):
            current["comment"] = s
            continue
        if s == "":
            continue
        m = _TASK.match(s)
        if not m:
            continue
        checkbox, priority, raw = m.group(1), m.group(2), m.group(3)
        today = False
        work = raw
        if re.search(r"(^|\s)#今日(\s|$)", work):
            today = True
            work = re.sub(r"\s*#今日(?=\s|$)", "", work).strip()
        reference = None
        rm = _REF.match(work)
        if rm:
            text, reference = rm.group(1).strip(), rm.group(2)
        else:
            text = work.strip()
        category = None
        cm = _CAT.match(text)
        if cm:
            text, category = cm.group(1).strip(), cm.group(2)
        current["items"].append({
            "text": text, "priority": priority, "category": category,
            "today": today, "completed": checkbox == "x", "reference": reference,
        })
    return {"preamble": preamble, "sections": sections}


def serialize_todo(data):
    result = re.sub(r"\n*$", "\n", data.get("preamble", ""))
    for section in data["sections"]:
        result += f"## {section['name']}\n"
        if section.get("comment"):
            result += f"{section['comment']}\n"
        for item in section["items"]:
            check = "x" if item["completed"] else " "
            pri = f"[{item['priority']}] " if item.get("priority") else ""
            cat = f" #{item['category']}" if item.get("category") else ""
            today = " #今日" if item.get("today") else ""
            ref = f" ← {item['reference']}" if item.get("reference") else ""
            result += f"- [{check}] {pri}{item['text']}{cat}{today}{ref}\n"
        result += "\n"
    return result
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd feishu-bot && venv/bin/python -m pytest tests/test_todo_parser.py -v`
Expected: PASS（3 passed）

- [ ] **Step 5: 用真实 todo.md 验证往返(手动一次性检查)**

Run:
```bash
cd feishu-bot && KEY=$(jq -r .DIBRAIN_OBSIDIAN_REST_API_KEY ~/.claude/api-keys.json) && \
venv/bin/python -c "
import urllib3, requests; urllib3.disable_warnings()
import todo_parser as tp
md = requests.get('https://127.0.0.1:27124/vault/1_memory/todo.md', headers={'Authorization':'Bearer $KEY'}, verify=False).text
d = tp.parse_todo(md)
print('sections:', [s['name'] for s in d['sections']])
print('roundtrip idempotent:', tp.parse_todo(tp.serialize_todo(d))['sections'] == d['sections'])
"
```
Expected: 列出真实栏目 + `roundtrip idempotent: True`

- [ ] **Step 6: 提交**

```bash
git add feishu-bot/todo_parser.py feishu-bot/tests/test_todo_parser.py
git commit -m "feat(feishu-bot): todo.md parser/serializer (ported from todo-sync.js)"
```

---

### Task 2: `task_extractor` — intent schema + 注入任务列表

**Files:**
- Modify: `feishu-bot/task_extractor.py`
- Modify: `feishu-bot/tests/test_task_extractor.py`

**Interfaces:**
- Consumes: `parse_todo`（Task 1）
- Produces:
  - `summarize_tasks(parsed: dict) -> str` — 把 parsed todo 压成给 LLM 的精简列表文本
  - `build_messages(user_text: str, task_list: str) -> list` — 注入任务列表(签名新增 task_list)
  - `parse_llm_json(raw: str) -> dict` — 返回 `{"intent", "tasks", "pool_filter", "complete_match"}`(清洗、缺省安全：intent 非法→"add"，tasks 沿用 v1 清洗)
  - `extract_message(user_text: str, task_list: str, channels=LLM_CHANNELS, caller=call_channel) -> dict` — 渠道编排(沿用 v1 fallback),返回上面 dict

- [ ] **Step 1: 改失败测试** — 替换 `tests/test_task_extractor.py` 里 `parse_llm_json` 相关用例，并新增 intent 用例

```python
import task_extractor as te


def test_build_messages_injects_task_list():
    msgs = te.build_messages("买菜", "[短期] 写方案 #工作 #今日 (未完成)")
    assert "写方案" in msgs[-1]["content"] and "买菜" in msgs[-1]["content"]


def test_parse_add_intent():
    raw = '{"intent":"add","tasks":[{"text":"买菜","priority":null,"category":null,"today":true}]}'
    d = te.parse_llm_json(raw)
    assert d["intent"] == "add"
    assert d["tasks"][0]["text"] == "买菜" and d["tasks"][0]["today"] is True


def test_parse_query_pool_intent():
    raw = '{"intent":"query_pool","pool_filter":{"category":"工作","section":null}}'
    d = te.parse_llm_json(raw)
    assert d["intent"] == "query_pool"
    assert d["pool_filter"]["category"] == "工作"


def test_parse_complete_intent():
    raw = '{"intent":"complete","complete_match":"买菜"}'
    d = te.parse_llm_json(raw)
    assert d["intent"] == "complete" and d["complete_match"] == "买菜"


def test_parse_invalid_intent_defaults_add():
    raw = '{"intent":"frobnicate","tasks":[{"text":"x","today":false}]}'
    d = te.parse_llm_json(raw)
    assert d["intent"] == "add"


def test_extract_message_fallback(monkeypatch=None):
    calls = []
    def fake(channel, messages):
        calls.append(channel["name"])
        if channel["name"] == "openrouter":
            raise type("RL", (Exception,), {"status_code": 429})()
        return '{"intent":"query_today"}'
    d = te.extract_message("今天还有啥", "", caller=fake)
    assert calls == ["openrouter", "yunwu"] and d["intent"] == "query_today"
```

(保留 v1 的 add 字段清洗测试 `test_parse_strips_code_fence_and_cleans` 等，但把断言从 `tasks = parse_llm_json(...)`（list）改为 `parse_llm_json(...)["tasks"]`。)

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && venv/bin/python -m pytest tests/test_task_extractor.py -v`
Expected: FAIL（`AttributeError`/`KeyError`：尚无 `intent`/`summarize_tasks`/`extract_message`）

- [ ] **Step 3: 改 `task_extractor.py`**

替换 `SYSTEM_PROMPT`、`build_messages`、`parse_llm_json`，新增 `summarize_tasks`、`extract_message`（保留 `call_channel`、`_is_rate_limit`、`AllChannelsFailed`、`_strip_fence`、`VALID_*` 不变）：

```python
SYSTEM_PROMPT = """你是任务助手。判断用户消息的意图并输出 JSON。
意图 intent 取值之一：
- "add"：要新增任务（默认；记一件/几件待办）
- "query_today"：想看今天的必做
- "query_pool"：想看任务池/某分类/某栏目的任务
- "complete"：说某件事做完了/完成了

输出格式：
{"intent":"...","tasks":[{"text","priority","category","today"}],"pool_filter":{"category":null,"section":null},"complete_match":null}

规则：
- intent=add：填 tasks。text 去口水；priority 仅 S/A/B/C 否则 null；category 仅 家庭/工作/健康/学习 否则 null；today：消息表达"今天/马上/必须今天"→true。可多任务。
- intent=query_pool：填 pool_filter。说"工作的任务"→category"工作"；说某栏目名→section；泛指"任务池/还有什么"→都 null。
- intent=complete：从下方「当前任务」列表里挑最匹配且未完成的一条，把它的纯文本（不含 #分类/#今日）放进 complete_match；没有合理匹配→null。
- 不相关字段留空/ null。只输出 JSON。"""


def summarize_tasks(parsed):
    lines = []
    for sec in parsed.get("sections", []):
        for it in sec["items"]:
            tag = " #" + it["category"] if it.get("category") else ""
            today = " #今日" if it.get("today") else ""
            done = "已完成" if it["completed"] else "未完成"
            lines.append(f"[{sec['name']}] {it['text']}{tag}{today} ({done})")
    return "\n".join(lines)


def build_messages(user_text, task_list):
    user = user_text
    if task_list:
        user = f"{user_text}\n\n当前任务（供判断意图和定位「完成」目标）：\n{task_list}"
    return [{"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user}]


def _clean_tasks(items):
    out = []
    for item in items or []:
        text = (item.get("text") or "").strip()
        if not text:
            continue
        pri = item.get("priority") if item.get("priority") in VALID_PRIORITIES else None
        cat = item.get("category") if item.get("category") in VALID_CATEGORIES else None
        out.append({"text": text, "priority": pri, "category": cat, "today": bool(item.get("today"))})
    return out


def parse_llm_json(raw):
    data = json.loads(_strip_fence(raw))
    intent = data.get("intent")
    if intent not in ("add", "query_today", "query_pool", "complete"):
        intent = "add"
    pf = data.get("pool_filter") or {}
    cat = pf.get("category") if pf.get("category") in VALID_CATEGORIES else None
    cm = data.get("complete_match")
    cm = cm.strip() if isinstance(cm, str) and cm.strip() else None
    return {
        "intent": intent,
        "tasks": _clean_tasks(data.get("tasks")),
        "pool_filter": {"category": cat, "section": pf.get("section") or None},
        "complete_match": cm,
    }


def extract_message(user_text, task_list, channels=LLM_CHANNELS, caller=call_channel):
    messages = build_messages(user_text, task_list)
    errors = []
    for channel in channels:
        try:
            return parse_llm_json(caller(channel, messages))
        except Exception as exc:
            if _is_rate_limit(exc):
                errors.append(f"{channel['name']}: 429")
                continue
            try:
                return parse_llm_json(caller(channel, messages))
            except Exception as exc2:
                errors.append(f"{channel['name']}: {exc} → retry: {exc2}")
                continue
    raise AllChannelsFailed(" | ".join(errors))
```

> 注：旧 `extract_tasks`/`build_messages(user_text)` 被取代。`main.py`(Task 5)改用 `extract_message`。旧 `extract_tasks` 删除。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd feishu-bot && venv/bin/python -m pytest tests/test_task_extractor.py -v`
Expected: PASS（全部）

- [ ] **Step 5: 提交**

```bash
git add feishu-bot/task_extractor.py feishu-bot/tests/test_task_extractor.py
git commit -m "feat(feishu-bot): LLM intent schema (add/query/complete) + task-list injection"
```

---

### Task 3: `todo_writer.complete_task` — 标记完成

**Files:**
- Modify: `feishu-bot/todo_writer.py`
- Modify: `feishu-bot/tests/test_todo_writer.py`

**Interfaces:**
- Consumes: `parse_todo`/`serialize_todo`（Task 1）；`read_todo`/`write_todo`（v1）
- Produces:
  - `complete_task(match_text: str, reader=read_todo, writer=write_todo) -> str | None` — 命中→标完成+写回，返回被标记任务的展示文本（`text` + ` #分类`）；未命中→None

- [ ] **Step 1: 写失败测试** — 追加到 `tests/test_todo_writer.py`

```python
import todo_writer as tw


def test_complete_marks_and_returns_display():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] 买菜 #家庭\n- [ ] 写方案 #工作 #今日\n"
    written = {}
    disp = tw.complete_task("买菜", reader=lambda: md, writer=lambda c: written.update(content=c))
    assert disp == "买菜 #家庭"
    assert "- [x] 买菜 #家庭" in written["content"]
    assert "- [ ] 写方案 #工作 #今日" in written["content"]  # 其他不动


def test_complete_no_match_returns_none():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] 买菜\n"
    written = {}
    disp = tw.complete_task("不存在", reader=lambda: md, writer=lambda c: written.update(content=c))
    assert disp is None
    assert "content" not in written  # 没写回


def test_complete_skips_already_done():
    md = "# T\n## 短期任务（7 天内完成）\n- [x] 买菜\n- [ ] 买菜\n"
    written = {}
    tw.complete_task("买菜", reader=lambda: md, writer=lambda c: written.update(content=c))
    # 标记第一条未完成的(第二行)，第一行保持 [x]
    assert written["content"].count("- [x] 买菜") == 2
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && venv/bin/python -m pytest tests/test_todo_writer.py -k complete -v`
Expected: FAIL（`AttributeError: ... 'complete_task'`）

- [ ] **Step 3: 追加实现到 `todo_writer.py`**

```python
import todo_parser


def complete_task(match_text, reader=read_todo, writer=write_todo):
    data = todo_parser.parse_todo(reader())
    target = None
    for sec in data["sections"]:
        for item in sec["items"]:
            if item["text"] == match_text and not item["completed"]:
                target = item
                break
        if target:
            break
    if target is None:
        return None
    target["completed"] = True
    writer(todo_parser.serialize_todo(data))
    cat = f" #{target['category']}" if target.get("category") else ""
    return f"{target['text']}{cat}"
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd feishu-bot && venv/bin/python -m pytest tests/test_todo_writer.py -v`
Expected: PASS（含新 complete 用例）

- [ ] **Step 5: 提交**

```bash
git add feishu-bot/todo_writer.py feishu-bot/tests/test_todo_writer.py
git commit -m "feat(feishu-bot): complete_task — locate by text + mark done + write back"
```

---

### Task 4: `todo_writer` — 查询 today / pool

**Files:**
- Modify: `feishu-bot/todo_writer.py`
- Modify: `feishu-bot/tests/test_todo_writer.py`

**Interfaces:**
- Consumes: `parse_todo`（Task 1）
- Produces:
  - `query_today(reader=read_todo) -> dict` → `{"items": [{"text","category","completed"}], "total": int, "done": int}`（跨 section 收集 `today=True`）
  - `query_pool(category=None, section=None, reader=read_todo) -> list[dict]` → 未完成 items 列表 `[{"text","category","section"}]`，按 category/section 过滤（都 None = 全部未完成池子项）

- [ ] **Step 1: 写失败测试** — 追加到 `tests/test_todo_writer.py`

```python
def test_query_today_groups_and_counts():
    md = ("# T\n## 短期任务（7 天内完成）\n"
          "- [x] 买菜 #今日\n- [ ] 写方案 #工作 #今日\n- [ ] 非今日任务\n"
          "## 其他\n- [ ] 看书 #今日\n")
    q = tw.query_today(reader=lambda: md)
    assert q["total"] == 3 and q["done"] == 1
    texts = [i["text"] for i in q["items"]]
    assert "买菜" in texts and "写方案" in texts and "看书" in texts and "非今日任务" not in texts


def test_query_pool_filters_category_and_excludes_done():
    md = ("# T\n## 短期任务（7 天内完成）\n"
          "- [ ] 写方案 #工作\n- [x] 已完成的工作 #工作\n- [ ] 买菜 #家庭\n")
    work = tw.query_pool(category="工作", reader=lambda: md)
    assert [i["text"] for i in work] == ["写方案"]  # 排除已完成 + 排除非工作


def test_query_pool_all_when_no_filter():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] a\n- [x] b\n- [ ] c\n"
    allp = tw.query_pool(reader=lambda: md)
    assert [i["text"] for i in allp] == ["a", "c"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && venv/bin/python -m pytest tests/test_todo_writer.py -k query -v`
Expected: FAIL（`AttributeError`）

- [ ] **Step 3: 追加实现到 `todo_writer.py`**

```python
def query_today(reader=read_todo):
    data = todo_parser.parse_todo(reader())
    items = []
    for sec in data["sections"]:
        for it in sec["items"]:
            if it["today"]:
                items.append({"text": it["text"], "category": it["category"],
                              "completed": it["completed"]})
    done = sum(1 for i in items if i["completed"])
    return {"items": items, "total": len(items), "done": done}


def query_pool(category=None, section=None, reader=read_todo):
    data = todo_parser.parse_todo(reader())
    out = []
    for sec in data["sections"]:
        if section and sec["name"] != section:
            continue
        for it in sec["items"]:
            if it["completed"]:
                continue
            if category and it["category"] != category:
                continue
            out.append({"text": it["text"], "category": it["category"], "section": sec["name"]})
    return out
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd feishu-bot && venv/bin/python -m pytest tests/test_todo_writer.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add feishu-bot/todo_writer.py feishu-bot/tests/test_todo_writer.py
git commit -m "feat(feishu-bot): query_today + query_pool"
```

---

### Task 5: `feishu_listener` 路由 + `main.py` 装配

**Files:**
- Modify: `feishu-bot/feishu_listener.py`
- Modify: `feishu-bot/main.py`
- Modify: `feishu-bot/tests/test_listener.py`

**Interfaces:**
- Consumes: 所有前序（`extract_message` 经 `deps.extract`、`complete_task`、`query_today`、`query_pool`）
- Produces:
  - `format_today(q: dict) -> str`、`format_pool(items: list, max_n=15) -> str`、`format_complete(disp: str|None, asked: str) -> str`
  - `handle_message(text, sender, message_id, *, deps) -> str|None`（按 intent 路由）。`deps` 新增 `.read_tasks()->str`、`.extract(text, task_list)->dict`、`.complete(match)->str|None`、`.query_today()->dict`、`.query_pool(category, section)->list`

- [ ] **Step 1: 改测试** — 重写 `tests/test_listener.py` 的 deps 与用例

```python
import types
import feishu_listener as fl


def _deps(**over):
    base = dict(allowed_ids=["me"], dedup=_Dedup(), read_tasks=lambda: "",
                extract=lambda t, tl: {"intent": "add", "tasks": [], "pool_filter": {},
                                       "complete_match": None},
                write=lambda tasks: [], complete=lambda m: None,
                query_today=lambda: {"items": [], "total": 0, "done": 0},
                query_pool=lambda category=None, section=None: [])
    base.update(over)
    return types.SimpleNamespace(**base)


class _Dedup:
    def __init__(self, seen=()):
        self.seen, self.released = set(seen), []
    def claim(self, mid):
        if mid in self.seen: return False
        self.seen.add(mid); return True
    def release(self, mid):
        self.released.append(mid); self.seen.discard(mid)


def test_route_add():
    deps = _deps(extract=lambda t, tl: {"intent": "add",
                "tasks": [{"text": "买菜", "priority": None, "category": None, "today": True}],
                "pool_filter": {}, "complete_match": None},
                write=lambda tasks: [{"text": "买菜", "today_applied": True}])
    r = fl.handle_message("买菜", "me", "m1", deps=deps)
    assert "已记录" in r and "买菜" in r


def test_route_query_today():
    deps = _deps(extract=lambda t, tl: {"intent": "query_today", "tasks": [],
                 "pool_filter": {}, "complete_match": None},
                 query_today=lambda: {"items": [{"text": "买菜", "category": None, "completed": True},
                                                 {"text": "写方案", "category": "工作", "completed": False}],
                                      "total": 2, "done": 1})
    r = fl.handle_message("今天还有啥", "me", "m2", deps=deps)
    assert "今日必做" in r and "1/2" in r and "写方案" in r


def test_route_complete_hit():
    deps = _deps(extract=lambda t, tl: {"intent": "complete", "tasks": [],
                 "pool_filter": {}, "complete_match": "买菜"},
                 complete=lambda m: "买菜 #家庭")
    r = fl.handle_message("买菜做完了", "me", "m3", deps=deps)
    assert "已完成" in r and "买菜 #家庭" in r


def test_route_complete_miss():
    deps = _deps(extract=lambda t, tl: {"intent": "complete", "tasks": [],
                 "pool_filter": {}, "complete_match": "不存在"},
                 complete=lambda m: None)
    r = fl.handle_message("xxx做完了", "me", "m4", deps=deps)
    assert "没找到" in r


def test_route_query_pool_truncates():
    items = [{"text": f"任务{i}", "category": None, "section": "短期任务"} for i in range(20)]
    deps = _deps(extract=lambda t, tl: {"intent": "query_pool", "tasks": [],
                 "pool_filter": {"category": None, "section": None}, "complete_match": None},
                 query_pool=lambda category=None, section=None: items)
    r = fl.handle_message("任务池还有啥", "me", "m5", deps=deps)
    assert "还有 5 条" in r  # 20 - 15


def test_whitelist_and_dedup_still_apply():
    assert fl.handle_message("x", "stranger", "m6", deps=_deps()) is None
    d = _deps(dedup=_Dedup(seen=["m7"]))
    assert fl.handle_message("x", "me", "m7", deps=d) is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && venv/bin/python -m pytest tests/test_listener.py -v`
Expected: FAIL

- [ ] **Step 3: 改 `feishu_listener.py`**

保留 `format_receipt`(v1)。新增 format 函数 + 重写 `handle_message`：

```python
def format_today(q):
    lines = [f"📋 今日必做 ({q['done']}/{q['total']})"]
    for it in q["items"]:
        mark = "✅" if it["completed"] else "⬜"
        cat = f" #{it['category']}" if it.get("category") else ""
        lines.append(f"{mark} {it['text']}{cat}")
    if q["total"] == 0:
        lines.append("（今天还没设必做，发一句话记一件吧）")
    return "\n".join(lines)


def format_pool(items, max_n=15):
    if not items:
        return "🔍 没有匹配的未完成任务"
    shown = items[:max_n]
    lines = ["📂 任务池："]
    for it in shown:
        cat = f" #{it['category']}" if it.get("category") else ""
        lines.append(f"⬜ {it['text']}{cat}")
    if len(items) > max_n:
        lines.append(f"…还有 {len(items) - max_n} 条，去扩展看")
    return "\n".join(lines)


def format_complete(disp, asked):
    if disp is None:
        return f"🔍 没找到匹配「{asked}」的任务，可换个说法或去扩展操作"
    return f"✅ 已完成：{disp}"


def handle_message(text, sender, message_id, *, deps):
    if sender not in deps.allowed_ids:
        return None
    if not deps.dedup.claim(message_id):
        return None
    try:
        task_list = deps.read_tasks()
        try:
            result = deps.extract(text, task_list)
        except AllChannelsFailed:
            results = deps.write([{"text": text, "priority": None,
                                   "category": None, "today": False}])
            return format_receipt(results, frozenset()) + "\n（识别失败，已按原文记录，请稍后整理）"
        intent = result["intent"]
        if intent == "query_today":
            return format_today(deps.query_today())
        if intent == "query_pool":
            pf = result["pool_filter"]
            return format_pool(deps.query_pool(category=pf.get("category"), section=pf.get("section")))
        if intent == "complete":
            return format_complete(deps.complete(result["complete_match"]), result["complete_match"])
        # default: add
        wanted_today = {t["text"] for t in result["tasks"] if t.get("today")}
        return format_receipt(deps.write(result["tasks"]), wanted_today)
    except Exception as exc:
        deps.dedup.release(message_id)
        return f"⚠️ 处理失败：{exc}"
```

- [ ] **Step 4: 改 `main.py` 装配新 deps**

把 `_deps` 与 imports 改为：

```python
from task_extractor import extract_message
from todo_writer import write_tasks, complete_task, query_today, query_pool
import todo_parser
from task_extractor import summarize_tasks
from todo_writer import read_todo

def _read_tasks():
    return summarize_tasks(todo_parser.parse_todo(read_todo()))

_deps = types.SimpleNamespace(
    allowed_ids=_ALLOWED, dedup=_dedup,
    read_tasks=_read_tasks,
    extract=extract_message,
    write=write_tasks, complete=complete_task,
    query_today=query_today, query_pool=query_pool,
)
```

（删除旧 `extract=extract_tasks`。`_on_message` 调用 `handle_message` 不变。）

- [ ] **Step 5: 运行测试确认通过 + 全套 + py_compile main**

Run:
```bash
cd feishu-bot && venv/bin/python -m pytest tests/ -v && venv/bin/python -m py_compile main.py
```
Expected: 全部 PASS，py_compile 无输出

- [ ] **Step 6: 提交**

```bash
git add feishu-bot/feishu_listener.py feishu-bot/main.py feishu-bot/tests/test_listener.py
git commit -m "feat(feishu-bot): intent routing in handle_message + main wiring"
```

---

### Task 6: 部署 + 端到端验证

**Files:** 无代码改动（运维）

- [ ] **Step 1: 重新部署**

```bash
bash feishu-bot/deploy/deploy.sh
```
Expected: `deployed`；`launchctl list | grep feishu-task-bot` 有 PID

- [ ] **Step 2: 确认 LaunchAgent 连上**

Run: Read `~/.local/feishu-task-bot/bot.log` — 应见 `connected to wss://…`，无 `[error]`

- [ ] **Step 3: 端到端手动验证**（依次发飞书消息，每条看 bot.log + 回执 + todo.md/扩展）

- 发"今天还有啥" → 回执 `📋 今日必做 (x/y)` 列表
- 发"列一下工作的任务" → 回执仅 `#工作` 未完成项
- 发"把买菜标完成"（或"买菜做完了"）→ 回执 `✅ 已完成：买菜…`；`todo.md` 对应行变 `[x]`；扩展 3s 内反映
- 发"加一个明天交报告" → 回执 `✅ 已记录`（add 仍正常）
- 发一条无匹配的完成意图 → 回执 `🔍 没找到…`，todo.md 不变

Expected: 五条行为均符合;`bot.log` 无 `[error]`

---

## Self-Review

**1. Spec coverage：**
- §2 D1 LLM 意图 → Task 2 ✓；D2 一次调用+注入列表 → Task 2 `build_messages`/`extract_message` ✓；D3/D4 标最匹配+回执全文 → Task 3 + Task 5 `format_complete` ✓；D5 移植 parser → Task 1 ✓；D6 LLM 失败原文入池 → Task 5 `except AllChannelsFailed` ✓
- §4 schema → Task 2 ✓；§5 parser → Task 1 ✓；§6 complete → Task 3 ✓；§7 query → Task 4 ✓；§8 回执 → Task 5 format_* ✓；§9 路由 → Task 5 ✓
- §11 测试 / §12 验收 → 各任务 TDD + Task 6 端到端 ✓
- §13 截断阈值 15 → Task 5 `format_pool(max_n=15)` ✓

**2. Placeholder scan：** 无 TBD；每个代码步骤含完整代码 + 命令。✓

**3. Type consistency：** `extract_message`→dict `{intent,tasks,pool_filter,complete_match}` 在 Task 2 定义、Task 5 消费一致；`complete_task`→`str|None` Task 3 定义、Task 5 `format_complete` 消费一致；`query_today`→`{items,total,done}`、`query_pool`→`list[{text,category,section}]` Task 4 定义、Task 5 消费一致;`parse_todo`/`serialize_todo` Task 1 定义、Task 3/4 消费一致。✓
