# 飞书任务机器人 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在手机飞书发一句话，机器人用 LLM 提炼成结构化任务，写入 Obsidian `todo.md`，Chrome 扩展自动读到。

**Architecture:** 独立 Python 进程，lark-oapi 长连接收消息 → 白名单+幂等去重 → LLM 提炼（OpenRouter 优先、云雾兜底）→ GET+PUT 整文件方式把任务行插入 `todo.md` 的「短期任务」栏目 → 回执飞书。核心逻辑（提炼解析、写入格式、满 3 降级、幂等、编排）都是纯函数/依赖注入，网络层薄。部署为 iMac LaunchAgent。

**Tech Stack:** Python 3.12（homebrew，带 SSL）、lark-oapi、openai（兼容 OpenRouter/云雾）、httpx、requests、sqlite3、pytest。

## Global Constraints

以下为全项目约束，每个任务都隐含适用（值逐字取自 spec）：

- **写入格式**（严格对齐 `todo-sync.js` 的 `toMarkdown`）：`- [ ] [优先级] 文本 #分类 #今日`，顺序固定：复选框 → `[S/A/B/C]` → 文本 → ` #分类` → ` #今日`（优先级/分类/今日均可缺省）
- **分类仅四类**：`家庭` / `工作` / `健康` / `学习`（其他一律不写分类 tag）
- **优先级取值**：`S` / `A` / `B` / `C` 或无
- **今日上限**：`MAX_TODAY = 3`（统计 todo.md 中未完成的 `#今日` 行）
- **LLM 渠道顺序**：OpenRouter `anthropic/claude-sonnet-4-6` 优先 → 云雾 `claude-sonnet-4-6` 兜底；429 fast-fail 立即换通道，非 429 同通道重试 1 次（⚠️ 本项目特例：与全局"云雾优先"惯例相反）
- **todo.md 路径**（vault 相对）：`1_memory/todo.md`；**默认栏目**：`短期任务（7 天内完成）`
- **Obsidian REST**：`https://127.0.0.1:27124`，`Authorization: Bearer <key>`，自签证书需 `verify=False`
- **写入方式**：GET 整文件 → 纯函数插入任务行 → PUT 整文件（不用 PATCH heading，规避中文 header 编码）
- **密钥**：全部从 `~/.claude/api-keys.json` 读取，不进 git。键名：`FEISHU_TASKBOT_APP_ID`、`FEISHU_TASKBOT_APP_SECRET`、`FEISHU_TASKBOT_ALLOWED_OPENIDS`（JSON 数组）、`OPENROUTER_API_KEY`、`YUNWU_API_KEY`、`OBSIDIAN_REST_KEY`
- **幂等**：SQLite 持久化 message_id，`INSERT OR IGNORE`，处理失败时释放
- **代码位置**：开发于 `feishu-bot/`，部署 `~/.local/feishu-task-bot/`（避开 LaunchAgent CloudStorage TCC）
- **平台**：Intel iMac，homebrew python 建 venv（`import ssl` 必须正常），不用 pyenv

文件结构：

```
feishu-bot/
├── config.py            # 读 api-keys.json + 常量
├── dedup_store.py       # SQLite message_id 幂等
├── task_extractor.py    # 消息文本 → 结构化任务（提炼 + 渠道 fallback）
├── todo_writer.py       # 序列化/计数/降级/插入 + Obsidian REST 读写
├── feishu_listener.py   # handle_message 编排（纯逻辑，依赖注入）
├── main.py              # 入口：加载 config + 绑定 lark 长连接
├── requirements.txt
├── tests/
│   ├── test_dedup_store.py
│   ├── test_task_extractor.py
│   ├── test_todo_writer.py
│   └── test_listener.py
├── deploy/
│   ├── wrapper.sh
│   ├── com.feishu-task-bot.runner.plist
│   └── deploy.sh        # cp 到 ~/.local + 重载 LaunchAgent
└── README.md
```

---

### Task 0: 人工前置（BLOCKING — 需用户手动操作，无代码）

这些步骤无法由 agent 自动完成，必须由用户在飞书开发后台 / 终端完成。后续任务依赖它们，但代码任务（1-7）可在 Task 0 未完成时先行开发与单测（单测不碰真实网络）；仅端到端验证（Task 8）依赖 Task 0。

- [ ] **0.1 创建飞书自建应用**：飞书开放平台 → 创建企业自建应用（如"任务录入 Bot"）。记下 App ID / App Secret。
- [ ] **0.2 开启长连接 + 事件**：事件订阅选「长连接」模式（无需回调 URL）；订阅事件 `im.message.receive_v1`。
- [ ] **0.3 配权限（应用身份）**：开通 `im:message`（或 `im:message:readonly`，接收消息）+ `im:message:send_v2`（发回执）。
- [ ] **0.4 发布**：创建版本 → 发布（"应用发布后当前配置方可生效"）。
- [ ] **0.5 写入密钥**：把以下键加入 `~/.claude/api-keys.json`（`OPENROUTER_API_KEY` / `YUNWU_API_KEY` 若已存在则复用）：
  ```json
  {
    "FEISHU_TASKBOT_APP_ID": "cli_xxx",
    "FEISHU_TASKBOT_APP_SECRET": "xxx",
    "FEISHU_TASKBOT_ALLOWED_OPENIDS": [],
    "OBSIDIAN_REST_KEY": "<Obsidian Local REST API 插件里的 key>"
  }
  ```
  Obsidian key 在 Obsidian → 设置 → Local REST API 插件页面复制。
- [ ] **0.6 获取自己的 open_id**：Task 7 的 `main.py` 首次运行时会把收到消息的 sender open_id 打到日志。给机器人发一条消息，从日志复制 open_id，填入 `FEISHU_TASKBOT_ALLOWED_OPENIDS` 数组，重启进程。
- [ ] **0.7 准备 Python 环境**：
  ```bash
  which -a python3.12   # 确认 homebrew python（Intel: /usr/local/bin/python3.12）
  /usr/local/bin/python3.12 -c "import ssl; print('ssl ok')"   # 必须打印 ssl ok
  ```

---

### Task 1: 项目脚手架 + config.py

**Files:**
- Create: `feishu-bot/config.py`
- Create: `feishu-bot/requirements.txt`
- Create: `feishu-bot/tests/__init__.py`
- Test: `feishu-bot/tests/test_config.py`

**Interfaces:**
- Produces:
  - `load_keys() -> dict` — 读取并返回 `~/.claude/api-keys.json` 解析后的 dict
  - 常量：`OBSIDIAN_API_URL="https://127.0.0.1:27124"`、`TODO_FILE_PATH="1_memory/todo.md"`、`DEFAULT_SECTION="短期任务（7 天内完成）"`、`MAX_TODAY=3`、`VALID_CATEGORIES=["家庭","工作","健康","学习"]`、`VALID_PRIORITIES=["S","A","B","C"]`、`LLM_CHANNELS`（见下）

- [ ] **Step 1: 写 requirements.txt**

```
lark-oapi>=1.2
openai>=1.30
httpx>=0.27
requests>=2.31
pytest>=8.0
```

- [ ] **Step 2: 写失败测试** — `feishu-bot/tests/test_config.py`

```python
import json
import config


def test_load_keys_reads_json(tmp_path, monkeypatch):
    fake = tmp_path / "api-keys.json"
    fake.write_text(json.dumps({"FEISHU_TASKBOT_APP_ID": "cli_x"}))
    monkeypatch.setattr(config, "API_KEYS_PATH", fake)
    assert config.load_keys()["FEISHU_TASKBOT_APP_ID"] == "cli_x"


def test_constants_present():
    assert config.MAX_TODAY == 3
    assert config.VALID_CATEGORIES == ["家庭", "工作", "健康", "学习"]
    assert config.DEFAULT_SECTION == "短期任务（7 天内完成）"
    # OpenRouter must be first channel
    assert config.LLM_CHANNELS[0]["name"] == "openrouter"
    assert config.LLM_CHANNELS[0]["model"] == "anthropic/claude-sonnet-4-6"
    assert config.LLM_CHANNELS[1]["name"] == "yunwu"
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd feishu-bot && python -m pytest tests/test_config.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'config'`）

- [ ] **Step 4: 写 config.py**

```python
"""Configuration and key loading for the Feishu task bot."""
import json
from pathlib import Path

API_KEYS_PATH = Path.home() / ".claude" / "api-keys.json"

OBSIDIAN_API_URL = "https://127.0.0.1:27124"
TODO_FILE_PATH = "1_memory/todo.md"
DEFAULT_SECTION = "短期任务（7 天内完成）"
MAX_TODAY = 3
VALID_CATEGORIES = ["家庭", "工作", "健康", "学习"]
VALID_PRIORITIES = ["S", "A", "B", "C"]

# OpenRouter first, Yunwu fallback (project-specific, opposite of global default)
LLM_CHANNELS = [
    {"name": "openrouter", "base_url": "https://openrouter.ai/api/v1",
     "model": "anthropic/claude-sonnet-4-6", "key_name": "OPENROUTER_API_KEY"},
    {"name": "yunwu", "base_url": "https://api.yunwu.ai/v1",
     "model": "claude-sonnet-4-6", "key_name": "YUNWU_API_KEY"},
]


def load_keys():
    """Load and parse ~/.claude/api-keys.json into a dict."""
    with open(API_KEYS_PATH, encoding="utf-8") as f:
        return json.load(f)
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd feishu-bot && python -m pytest tests/test_config.py -v`
Expected: PASS（2 passed）

- [ ] **Step 6: 提交**

```bash
git add feishu-bot/config.py feishu-bot/requirements.txt feishu-bot/tests/
git commit -m "feat(feishu-bot): config loading + constants"
```

---

### Task 2: dedup_store.py（SQLite 幂等）

**Files:**
- Create: `feishu-bot/dedup_store.py`
- Test: `feishu-bot/tests/test_dedup_store.py`

**Interfaces:**
- Produces:
  - `DedupStore(db_path)` — 构造时建表
  - `.claim(message_id: str) -> bool` — 首次返回 True 并记录；重复返回 False
  - `.release(message_id: str) -> None` — 删除记录（处理失败时调用，允许重投重试）

- [ ] **Step 1: 写失败测试** — `feishu-bot/tests/test_dedup_store.py`

```python
from dedup_store import DedupStore


def test_claim_first_time_true_then_false(tmp_path):
    store = DedupStore(tmp_path / "dedup.db")
    assert store.claim("msg_1") is True
    assert store.claim("msg_1") is False  # duplicate


def test_release_allows_reclaim(tmp_path):
    store = DedupStore(tmp_path / "dedup.db")
    assert store.claim("msg_2") is True
    store.release("msg_2")
    assert store.claim("msg_2") is True  # reclaimable after release
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && python -m pytest tests/test_dedup_store.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'dedup_store'`）

- [ ] **Step 3: 写 dedup_store.py**

```python
"""Idempotency store for Feishu message_ids (events are delivered at-least-once)."""
import sqlite3


class DedupStore:
    def __init__(self, db_path):
        self.conn = sqlite3.connect(str(db_path))
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS processed (message_id TEXT PRIMARY KEY)"
        )
        self.conn.commit()

    def claim(self, message_id):
        """Return True if this is the first time we see message_id."""
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO processed (message_id) VALUES (?)", (message_id,)
        )
        self.conn.commit()
        return cur.rowcount == 1

    def release(self, message_id):
        """Remove the claim so a redelivered event can be retried."""
        self.conn.execute("DELETE FROM processed WHERE message_id = ?", (message_id,))
        self.conn.commit()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd feishu-bot && python -m pytest tests/test_dedup_store.py -v`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add feishu-bot/dedup_store.py feishu-bot/tests/test_dedup_store.py
git commit -m "feat(feishu-bot): SQLite idempotency store"
```

---

### Task 3: task_extractor 纯函数（prompt 构造 + JSON 解析清洗）

**Files:**
- Create: `feishu-bot/task_extractor.py`（本任务只写纯函数部分）
- Test: `feishu-bot/tests/test_task_extractor.py`

**Interfaces:**
- Produces:
  - `build_messages(user_text: str) -> list[dict]` — 返回 OpenAI 格式 messages（system + user）
  - `parse_llm_json(raw: str) -> list[dict]` — 剥 ```json 围栏、解析、清洗，返回任务列表。每个任务 dict：`{"text": str, "priority": "S"|"A"|"B"|"C"|None, "category": "家庭"|"工作"|"健康"|"学习"|None, "today": bool}`。非法 priority/category → None；缺 text 的条目丢弃

- [ ] **Step 1: 写失败测试** — `feishu-bot/tests/test_task_extractor.py`

```python
import task_extractor as te


def test_build_messages_includes_user_text():
    msgs = te.build_messages("买菜")
    assert msgs[0]["role"] == "system"
    assert msgs[-1]["role"] == "user"
    assert "买菜" in msgs[-1]["content"]


def test_parse_strips_code_fence_and_cleans():
    raw = '```json\n{"tasks":[{"text":"写方案","priority":"A","category":"工作","today":true}]}\n```'
    tasks = te.parse_llm_json(raw)
    assert tasks == [{"text": "写方案", "priority": "A", "category": "工作", "today": True}]


def test_parse_nullifies_invalid_priority_and_category():
    raw = '{"tasks":[{"text":"x","priority":"Z","category":"副业","today":false}]}'
    tasks = te.parse_llm_json(raw)
    assert tasks[0]["priority"] is None
    assert tasks[0]["category"] is None


def test_parse_drops_empty_text():
    raw = '{"tasks":[{"text":"   ","today":true},{"text":"买奶","today":false}]}'
    tasks = te.parse_llm_json(raw)
    assert len(tasks) == 1
    assert tasks[0]["text"] == "买奶"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && python -m pytest tests/test_task_extractor.py -v`
Expected: FAIL（`ModuleNotFoundError` 或 `AttributeError`）

- [ ] **Step 3: 写纯函数部分到 task_extractor.py**

```python
"""Extract structured tasks from a free-text Feishu message via LLM."""
import json
import re

from config import VALID_CATEGORIES, VALID_PRIORITIES

SYSTEM_PROMPT = """你是任务录入助手。把用户的一条消息拆成结构化任务，只输出 JSON。
格式：{"tasks":[{"text":"...","priority":null,"category":null,"today":false}]}
规则：
- text：任务核心，去掉口水/语气词。
- priority：仅 "S"/"A"/"B"/"C"，仅当消息明确表达重要/紧急时给，否则 null。
- category：仅 "家庭"/"工作"/"健康"/"学习" 之一，仅当明确归属时给，否则 null。禁止输出其他分类。
- today：消息表达"今天/今日/马上/现在/必须今天"等 → true，否则 false。
- 一条消息可含多个任务，拆成多个数组元素。
- 拿不准的字段一律 null/false，不要编造。只输出 JSON，不要解释。"""


def build_messages(user_text):
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_text},
    ]


def _strip_fence(raw):
    m = re.search(r"```(?:json)?\s*(.+?)\s*```", raw, re.DOTALL)
    return m.group(1) if m else raw.strip()


def parse_llm_json(raw):
    data = json.loads(_strip_fence(raw))
    cleaned = []
    for item in data.get("tasks", []):
        text = (item.get("text") or "").strip()
        if not text:
            continue
        priority = item.get("priority")
        if priority not in VALID_PRIORITIES:
            priority = None
        category = item.get("category")
        if category not in VALID_CATEGORIES:
            category = None
        cleaned.append({
            "text": text,
            "priority": priority,
            "category": category,
            "today": bool(item.get("today")),
        })
    return cleaned
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd feishu-bot && python -m pytest tests/test_task_extractor.py -v`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add feishu-bot/task_extractor.py feishu-bot/tests/test_task_extractor.py
git commit -m "feat(feishu-bot): task extraction prompt + JSON parsing"
```

---

### Task 4: task_extractor 渠道编排（OpenRouter → 云雾 fallback）

**Files:**
- Modify: `feishu-bot/task_extractor.py`（追加渠道调用 + 编排）
- Test: `feishu-bot/tests/test_task_extractor.py`（追加测试）

**Interfaces:**
- Consumes: `build_messages`、`parse_llm_json`（Task 3）；`LLM_CHANNELS`（Task 1）
- Produces:
  - `class AllChannelsFailed(Exception)`
  - `extract_tasks(user_text, channels=LLM_CHANNELS, caller=call_channel) -> list[dict]` — 依次尝试渠道：429 立即下一个，非 429 同通道重试 1 次；全失败抛 `AllChannelsFailed`（message 聚合各通道错误）
  - `call_channel(channel: dict, messages: list) -> str` — 真实 LLM 调用，返回 content 文本

- [ ] **Step 1: 追加失败测试**

```python
import pytest
import task_extractor as te


class _RateLimit(Exception):
    status_code = 429


def test_extract_falls_back_on_429(monkeypatch):
    calls = []

    def fake_caller(channel, messages):
        calls.append(channel["name"])
        if channel["name"] == "openrouter":
            raise _RateLimit()
        return '{"tasks":[{"text":"买菜","today":false}]}'

    tasks = te.extract_tasks("买菜", caller=fake_caller)
    assert calls == ["openrouter", "yunwu"]  # 429 → immediate next channel
    assert tasks[0]["text"] == "买菜"


def test_extract_retries_once_on_non_429(monkeypatch):
    calls = []

    def fake_caller(channel, messages):
        calls.append(channel["name"])
        if len([c for c in calls if c == "openrouter"]) == 1:
            raise RuntimeError("timeout")  # non-429 → retry same channel
        return '{"tasks":[{"text":"x","today":false}]}'

    tasks = te.extract_tasks("x", caller=fake_caller)
    assert calls[:2] == ["openrouter", "openrouter"]


def test_extract_all_fail_raises(monkeypatch):
    def fake_caller(channel, messages):
        raise RuntimeError("down")

    with pytest.raises(te.AllChannelsFailed):
        te.extract_tasks("x", caller=fake_caller)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && python -m pytest tests/test_task_extractor.py -k extract -v`
Expected: FAIL（`AttributeError: module 'task_extractor' has no attribute 'extract_tasks'`）

- [ ] **Step 3: 追加编排实现到 task_extractor.py**

```python
import httpx
from openai import OpenAI

from config import LLM_CHANNELS, load_keys


class AllChannelsFailed(Exception):
    pass


def _is_rate_limit(exc):
    return getattr(exc, "status_code", None) == 429 or "429" in str(exc)


def call_channel(channel, messages):
    keys = load_keys()
    client = OpenAI(
        api_key=keys[channel["key_name"]],
        base_url=channel["base_url"],
        http_client=httpx.Client(trust_env=False, timeout=httpx.Timeout(60, connect=15)),
        max_retries=0,
    )
    resp = client.chat.completions.create(
        model=channel["model"], messages=messages, max_tokens=2048, temperature=0,
    )
    if not resp.choices:
        raise RuntimeError("empty choices")
    return resp.choices[0].message.content


def extract_tasks(user_text, channels=LLM_CHANNELS, caller=call_channel):
    messages = build_messages(user_text)
    errors = []
    for channel in channels:
        try:
            return parse_llm_json(caller(channel, messages))
        except Exception as exc:
            if _is_rate_limit(exc):
                errors.append(f"{channel['name']}: 429")
                continue  # fast-fail to next channel
            # non-429 → retry same channel once
            try:
                return parse_llm_json(caller(channel, messages))
            except Exception as exc2:
                errors.append(f"{channel['name']}: {exc2}")
                continue
    raise AllChannelsFailed(" | ".join(errors))
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd feishu-bot && python -m pytest tests/test_task_extractor.py -v`
Expected: PASS（7 passed）

- [ ] **Step 5: 提交**

```bash
git add feishu-bot/task_extractor.py feishu-bot/tests/test_task_extractor.py
git commit -m "feat(feishu-bot): LLM channel orchestration with fallback"
```

---

### Task 5: todo_writer 纯函数（序列化 / 计数 / 降级 / 插入）

**Files:**
- Create: `feishu-bot/todo_writer.py`（本任务只写纯函数）
- Test: `feishu-bot/tests/test_todo_writer.py`

**Interfaces:**
- Consumes: `MAX_TODAY`、`DEFAULT_SECTION`（Task 1）
- Produces:
  - `serialize_task_line(task: dict, today_applied: bool) -> str` — 输出 `- [ ] [A] 文本 #工作 #今日`
  - `count_active_today(markdown: str) -> int` — 未完成的 `#今日` 行数
  - `apply_today_cap(tasks: list, current_count: int) -> list[dict]` — 每个 task 加 `today_applied: bool`（today 为真且未超 MAX_TODAY 才 True）
  - `insert_task_lines(markdown: str, lines: list[str], section: str) -> str` — 在 `## {section}` 区块末尾（下一个 `## ` 或 EOF 前，跳过尾部空行）插入行

- [ ] **Step 1: 写失败测试** — `feishu-bot/tests/test_todo_writer.py`

```python
import todo_writer as tw


def test_serialize_full():
    line = tw.serialize_task_line(
        {"text": "写方案", "priority": "A", "category": "工作"}, today_applied=True)
    assert line == "- [ ] [A] 写方案 #工作 #今日"


def test_serialize_minimal():
    line = tw.serialize_task_line(
        {"text": "买菜", "priority": None, "category": None}, today_applied=False)
    assert line == "- [ ] 买菜"


def test_count_active_today_ignores_completed():
    md = "## S\n- [ ] a #今日\n- [x] b #今日\n- [ ] c\n"
    assert tw.count_active_today(md) == 1


def test_apply_today_cap_respects_max(monkeypatch):
    monkeypatch.setattr(tw, "MAX_TODAY", 3)
    tasks = [{"text": "a", "today": True}, {"text": "b", "today": True}]
    out = tw.apply_today_cap(tasks, current_count=2)  # only 1 slot left
    assert out[0]["today_applied"] is True
    assert out[1]["today_applied"] is False  # downgraded


def test_insert_into_section_end():
    md = "# T\n## 短期任务（7 天内完成）\n<!-- c -->\n- [ ] old\n\n## 其他\n- [ ] z\n"
    out = tw.insert_task_lines(md, ["- [ ] new"], "短期任务（7 天内完成）")
    lines = out.split("\n")
    assert lines.index("- [ ] new") > lines.index("- [ ] old")
    assert lines.index("- [ ] new") < lines.index("## 其他")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && python -m pytest tests/test_todo_writer.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'todo_writer'`）

- [ ] **Step 3: 写纯函数到 todo_writer.py**

```python
"""Write extracted tasks into Obsidian todo.md (read-modify-write whole file)."""
import re

from config import DEFAULT_SECTION, MAX_TODAY


def serialize_task_line(task, today_applied):
    pri = f"[{task['priority']}] " if task.get("priority") else ""
    cat = f" #{task['category']}" if task.get("category") else ""
    today = " #今日" if today_applied else ""
    return f"- [ ] {pri}{task['text']}{cat}{today}"


def count_active_today(markdown):
    count = 0
    for line in markdown.split("\n"):
        s = line.strip()
        if s.startswith("- [ ]") and re.search(r"(^|\s)#今日(\s|$)", s):
            count += 1
    return count


def apply_today_cap(tasks, current_count):
    n = current_count
    out = []
    for t in tasks:
        applied = False
        if t.get("today") and n < MAX_TODAY:
            applied = True
            n += 1
        out.append({**t, "today_applied": applied})
    return out


def insert_task_lines(markdown, lines, section=DEFAULT_SECTION):
    rows = markdown.split("\n")
    start = None
    for i, row in enumerate(rows):
        if row.strip() == f"## {section}":
            start = i
            break
    if start is None:
        raise ValueError(f"section not found: {section}")
    # find end of this section (next '## ' or EOF)
    end = len(rows)
    for j in range(start + 1, len(rows)):
        if rows[j].startswith("## "):
            end = j
            break
    # back up over trailing blank lines inside the section
    insert_at = end
    while insert_at - 1 > start and rows[insert_at - 1].strip() == "":
        insert_at -= 1
    return "\n".join(rows[:insert_at] + lines + rows[insert_at:])
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd feishu-bot && python -m pytest tests/test_todo_writer.py -v`
Expected: PASS（5 passed）

- [ ] **Step 5: 提交**

```bash
git add feishu-bot/todo_writer.py feishu-bot/tests/test_todo_writer.py
git commit -m "feat(feishu-bot): todo.md serialization, today-cap, section insert"
```

---

### Task 6: todo_writer 集成（Obsidian REST 读写 + write_tasks 编排）

**Files:**
- Modify: `feishu-bot/todo_writer.py`（追加 REST + 编排）
- Test: `feishu-bot/tests/test_todo_writer.py`（追加注入式测试）

**Interfaces:**
- Consumes: `serialize_task_line`、`count_active_today`、`apply_today_cap`、`insert_task_lines`（Task 5）；`OBSIDIAN_API_URL`、`TODO_FILE_PATH`（Task 1）
- Produces:
  - `read_todo() -> str` / `write_todo(content: str) -> None` — Obsidian REST GET/PUT（`verify=False`）
  - `write_tasks(tasks, reader=read_todo, writer=write_todo) -> list[dict]` — 编排：读 → 计数 → 降级 → 序列化 → 插入 → 写回；返回每个任务的结果 `{"text","today_applied"}`（供回执）

- [ ] **Step 1: 追加失败测试**

```python
import todo_writer as tw


def test_write_tasks_caps_today_and_returns_results(monkeypatch):
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] x #今日\n- [ ] y #今日\n\n## 其他\n"
    written = {}

    def reader():
        return md

    def writer(content):
        written["content"] = content

    monkeypatch.setattr(tw, "MAX_TODAY", 3)
    tasks = [{"text": "a", "priority": "A", "category": "工作", "today": True},
             {"text": "b", "priority": None, "category": None, "today": True}]
    results = tw.write_tasks(tasks, reader=reader, writer=writer)

    assert results[0]["today_applied"] is True   # 1 slot left (2 existing)
    assert results[1]["today_applied"] is False  # downgraded
    assert "- [ ] [A] a #工作 #今日" in written["content"]
    assert "- [ ] b" in written["content"]
    assert "- [ ] b #今日" not in written["content"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && python -m pytest tests/test_todo_writer.py -k write_tasks -v`
Expected: FAIL（`AttributeError: ... 'write_tasks'`）

- [ ] **Step 3: 追加 REST + 编排到 todo_writer.py**

```python
import requests

from config import OBSIDIAN_API_URL, TODO_FILE_PATH, load_keys


def _headers(content_type=None):
    keys = load_keys()
    h = {"Authorization": f"Bearer {keys['OBSIDIAN_REST_KEY']}"}
    if content_type:
        h["Content-Type"] = content_type
    return h


def _vault_url():
    encoded = "/".join(requests.utils.quote(p) for p in TODO_FILE_PATH.split("/"))
    return f"{OBSIDIAN_API_URL}/vault/{encoded}"


def read_todo():
    r = requests.get(_vault_url(), headers={**_headers(), "Accept": "text/markdown"},
                     verify=False, timeout=15)
    r.raise_for_status()
    return r.text


def write_todo(content):
    r = requests.put(_vault_url(), headers=_headers("text/markdown"),
                     data=content.encode("utf-8"), verify=False, timeout=15)
    r.raise_for_status()


def write_tasks(tasks, reader=read_todo, writer=write_todo):
    md = reader()
    capped = apply_today_cap(tasks, count_active_today(md))
    lines = [serialize_task_line(t, t["today_applied"]) for t in capped]
    writer(insert_task_lines(md, lines))
    return [{"text": t["text"], "today_applied": t["today_applied"]} for t in capped]
```

> 注：`requests` 对自签证书 `verify=False` 会发 `InsecureRequestWarning`；可在 main.py 启动时 `urllib3.disable_warnings()`。并发说明：扩展平时仅只读 poll，仅用户主动编辑时 PUT，冲突窗口极小，MVP 接受。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd feishu-bot && python -m pytest tests/test_todo_writer.py -v`
Expected: PASS（6 passed）

- [ ] **Step 5: 提交**

```bash
git add feishu-bot/todo_writer.py feishu-bot/tests/test_todo_writer.py
git commit -m "feat(feishu-bot): Obsidian REST read/write + write_tasks orchestration"
```

---

### Task 7: feishu_listener 编排 + main.py 绑定

**Files:**
- Create: `feishu-bot/feishu_listener.py`
- Create: `feishu-bot/main.py`
- Test: `feishu-bot/tests/test_listener.py`

**Interfaces:**
- Consumes: `extract_tasks`、`AllChannelsFailed`（Task 4）；`write_tasks`（Task 6）；`DedupStore`（Task 2）
- Produces:
  - `format_receipt(results: list[dict]) -> str` — 回执文本，列出任务，对 `today_applied=False` 但原 `today=True` 的给降级提示
  - `handle_message(text, sender, message_id, *, deps) -> str|None` — 纯编排：白名单→去重→提炼→写入→返回回执文本；非白名单/重复返回 None；异常时 `deps.dedup.release` 并返回错误回执。`deps` 暴露 `allowed_ids`、`dedup`、`extract`、`write`
  - `main.py`：装配真实依赖 + lark 长连接（手动验证，不单测）

- [ ] **Step 1: 写失败测试** — `feishu-bot/tests/test_listener.py`

```python
import types
import feishu_listener as fl


def _deps(allowed, dedup, extract, write):
    return types.SimpleNamespace(allowed_ids=allowed, dedup=dedup,
                                 extract=extract, write=write)


class _Dedup:
    def __init__(self, seen=()):
        self.seen = set(seen)
        self.released = []

    def claim(self, mid):
        if mid in self.seen:
            return False
        self.seen.add(mid)
        return True

    def release(self, mid):
        self.released.append(mid)
        self.seen.discard(mid)


def test_rejects_non_whitelisted():
    deps = _deps(["me"], _Dedup(), lambda t: [], lambda r: [])
    assert fl.handle_message("hi", "stranger", "m1", deps=deps) is None


def test_dedup_skips_repeat():
    deps = _deps(["me"], _Dedup(seen=["m1"]), lambda t: [], lambda r: [])
    assert fl.handle_message("hi", "me", "m1", deps=deps) is None


def test_happy_path_returns_receipt():
    extract = lambda t: [{"text": "写方案", "priority": "A", "category": "工作", "today": True}]
    write = lambda tasks: [{"text": "写方案", "today_applied": True}]
    deps = _deps(["me"], _Dedup(), extract, write)
    receipt = fl.handle_message("写方案", "me", "m2", deps=deps)
    assert "写方案" in receipt and "已记录" in receipt


def test_failure_releases_claim():
    def boom(t):
        raise fl.AllChannelsFailed("down")
    dedup = _Dedup()
    deps = _deps(["me"], dedup, boom, lambda r: [])
    receipt = fl.handle_message("x", "me", "m3", deps=deps)
    assert "m3" in dedup.released
    assert "失败" in receipt


def test_receipt_flags_today_downgrade():
    results = [{"text": "a", "today_applied": False}]
    # original task wanted today; downgrade note expected
    text = fl.format_receipt(results, wanted_today={"a"})
    assert "满 3" in text or "入池" in text
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd feishu-bot && python -m pytest tests/test_listener.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'feishu_listener'`）

- [ ] **Step 3: 写 feishu_listener.py**

```python
"""Orchestration for an incoming Feishu message (pure, dependency-injected)."""
from task_extractor import AllChannelsFailed


def format_receipt(results, wanted_today=frozenset()):
    lines = [f"✅ 已记录 {len(results)} 条："]
    for r in results:
        lines.append(f"• {r['text']}")
    downgraded = [r["text"] for r in results
                  if r["text"] in wanted_today and not r["today_applied"]]
    if downgraded:
        lines.append(f"⚠️ 今日必做已满 3，{'、'.join(downgraded)} 先入池，完成一个再设今日")
    return "\n".join(lines)


def handle_message(text, sender, message_id, *, deps):
    if sender not in deps.allowed_ids:
        return None
    if not deps.dedup.claim(message_id):
        return None
    try:
        tasks = deps.extract(text)
        wanted_today = {t["text"] for t in tasks if t.get("today")}
        results = deps.write(tasks)
        return format_receipt(results, wanted_today)
    except AllChannelsFailed as exc:
        deps.dedup.release(message_id)
        return f"⚠️ 提炼失败（{exc}），请稍后重发"
    except Exception as exc:
        deps.dedup.release(message_id)
        return f"⚠️ 处理失败：{exc}"
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd feishu-bot && python -m pytest tests/test_listener.py -v`
Expected: PASS（5 passed）

- [ ] **Step 5: 写 main.py（绑定层，手动验证）**

```python
"""Entry point: wire real deps + start lark long-connection."""
import json
import types
import urllib3

import lark_oapi as lark
from lark_oapi.api.im.v1 import (
    P2ImMessageReceiveV1, CreateMessageRequest, CreateMessageRequestBody,
)

from config import load_keys
from dedup_store import DedupStore
from task_extractor import extract_tasks
from todo_writer import write_tasks
from feishu_listener import handle_message

urllib3.disable_warnings()

_keys = load_keys()
_APP_ID = _keys["FEISHU_TASKBOT_APP_ID"]
_APP_SECRET = _keys["FEISHU_TASKBOT_APP_SECRET"]
_ALLOWED = _keys.get("FEISHU_TASKBOT_ALLOWED_OPENIDS", [])

_client = lark.Client.builder().app_id(_APP_ID).app_secret(_APP_SECRET).build()
_dedup = DedupStore(__file__.replace("main.py", "dedup.db"))
_deps = types.SimpleNamespace(
    allowed_ids=_ALLOWED, dedup=_dedup, extract=extract_tasks, write=write_tasks)


def _send(open_id, text):
    req = (CreateMessageRequest.builder().receive_id_type("open_id")
           .request_body(CreateMessageRequestBody.builder()
                         .receive_id(open_id).msg_type("text")
                         .content(json.dumps({"text": text})).build()).build())
    _client.im.v1.message.create(req)


def _on_message(data: P2ImMessageReceiveV1):
    msg = data.event.message
    sender = data.event.sender.sender_id.open_id
    print(f"[recv] open_id={sender} message_id={msg.message_id} type={msg.message_type}")
    if msg.message_type != "text":
        return
    text = json.loads(msg.content).get("text", "")
    receipt = handle_message(text, sender, msg.message_id, deps=_deps)
    if receipt:
        _send(sender, receipt)


def main():
    handler = (lark.EventDispatcherHandler.builder("", "")
               .register_p2_im_message_receive_v1(_on_message).build())
    ws = lark.ws.Client(_APP_ID, _APP_SECRET, event_handler=handler)
    print("[bot] starting long connection ...")
    ws.start()


if __name__ == "__main__":
    main()
```

> lark-oapi 的类名/方法以实际安装版本为准（`pip show lark-oapi`）；如导入路径不同按报错调整。本步骤通过 Task 8 的端到端手动验证，不单测。

- [ ] **Step 6: 提交**

```bash
git add feishu-bot/feishu_listener.py feishu-bot/main.py feishu-bot/tests/test_listener.py
git commit -m "feat(feishu-bot): message orchestration + lark long-connection entry"
```

---

### Task 8: 部署（wrapper + plist + deploy 脚本 + README + 端到端验证）

**Files:**
- Create: `feishu-bot/deploy/wrapper.sh`
- Create: `feishu-bot/deploy/com.feishu-task-bot.runner.plist`
- Create: `feishu-bot/deploy/deploy.sh`
- Create: `feishu-bot/README.md`

**Interfaces:**
- Consumes: `main.py`（Task 7）及全部模块

- [ ] **Step 1: 写 wrapper.sh**

```bash
#!/bin/bash
# Runs the bot from the local (non-CloudStorage) deploy copy.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
cd "$HOME/.local/feishu-task-bot" || exit 1
exec ./venv/bin/python main.py
```

- [ ] **Step 2: 写 plist** — `com.feishu-task-bot.runner.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.feishu-task-bot.runner</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>__HOME__/.local/feishu-task-bot/wrapper.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>__HOME__/.local/feishu-task-bot/bot.log</string>
  <key>StandardErrorPath</key><string>__HOME__/.local/feishu-task-bot/bot.err.log</string>
</dict>
</plist>
```

- [ ] **Step 3: 写 deploy.sh**

```bash
#!/bin/bash
# Deploy the bot to a local (non-CloudStorage) path and (re)load the LaunchAgent.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/.local/feishu-task-bot"
PLIST="$HOME/Library/LaunchAgents/com.feishu-task-bot.runner.plist"

mkdir -p "$DEST"
rsync -a --exclude venv --exclude '__pycache__' --exclude tests --exclude dedup.db \
  --exclude '*.log' "$SRC"/ "$DEST"/
cp "$SRC/deploy/wrapper.sh" "$DEST/wrapper.sh"
chmod +x "$DEST/wrapper.sh"

# venv with homebrew python (has SSL); created once, reused after
if [ ! -d "$DEST/venv" ]; then
  /usr/local/bin/python3.12 -m venv "$DEST/venv"
fi
"$DEST/venv/bin/pip" install -q -r "$DEST/requirements.txt"

sed "s#__HOME__#$HOME#g" "$SRC/deploy/com.feishu-task-bot.runner.plist" > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "deployed; tail -f $DEST/bot.log"
```

- [ ] **Step 4: 写 README.md**

````markdown
# Feishu Task Bot

手机飞书发文字 → LLM 提炼 → 写入 Obsidian `1_memory/todo.md` → Chrome 扩展读到。

## 部署
1. 完成 Task 0 人工前置（飞书 app、api-keys.json、open_id）
2. `bash feishu-bot/deploy/deploy.sh`
3. 给机器人发消息，`tail -f ~/.local/feishu-task-bot/bot.log` 看 open_id，填进 api-keys.json，再 `launchctl kickstart -k gui/$(id -u)/com.feishu-task-bot.runner`

## 运维
- 日志：`~/.local/feishu-task-bot/bot.log` / `bot.err.log`
- 改代码后：重跑 `deploy.sh`（双源部署，必须重新 cp）
- 改飞书权限后：后台发布新版本 + `launchctl kickstart -k` 重启（拿新 scope token）
- 诊断：`launchctl print gui/$(id -u)/com.feishu-task-bot.runner | grep -i state`
````

- [ ] **Step 5: 运行全量单测**

Run: `cd feishu-bot && python -m pytest tests/ -v`
Expected: PASS（全部，22 passed）

- [ ] **Step 6: 端到端手动验证**（依赖 Task 0 完成）

```bash
bash feishu-bot/deploy/deploy.sh
# 给机器人发 "今天要写项目方案 #工作，还有买菜"
tail -f ~/.local/feishu-task-bot/bot.log
```
Expected:
- 收到回执"✅ 已记录 2 条：…写项目方案…买菜…"
- `~/Obsidian/DiBrain/1_memory/todo.md` 的「短期任务」段新增两行，写方案带 `#工作 #今日`
- Chrome 扩展今日页/任务池 3 秒内出现新任务
- 重发同一条不重复写入；已有 3 个 `#今日` 时新今日任务被降级并提示

- [ ] **Step 7: 提交**

```bash
git add feishu-bot/deploy feishu-bot/README.md
git commit -m "feat(feishu-bot): LaunchAgent deploy scripts + docs"
```

---

## Self-Review

**1. Spec coverage：**
- §2 范围（文字/加任务/今日/多任务/回执）→ Task 3-7 ✓；非目标（语音/查询/标完成）未实现 ✓
- §3 数据流 → Task 4/6/7 全链路 ✓
- §4 组件（listener/extractor/writer/dedup/config）→ Task 1/2/3-4/5-6/7 ✓
- §5 决策（Python/长连接/新 app/OpenRouter 优先/多任务/today/即写即回/满3降级/4类/默认栏目/白名单/LaunchAgent/本地部署）→ 全覆盖 ✓
- §6 写入格式契约 → Task 5 `serialize_task_line` + 测试 ✓
- §7 LLM 提炼（schema/字段规则/渠道顺序/429 fast-fail/JSON 容错）→ Task 3-4 ✓
- §8 满 3 降级 → Task 5 `apply_today_cap` + Task 6/7 ✓
- §9 幂等/错误处理（去重/释放/LLM 失败不丢任务/REST 报错）→ Task 2/7；**注**：spec §9 要求"LLM 全失败时原文入池"，plan 中 `handle_message` 当前是回执失败让用户重发，未自动入池——**取舍**：MVP 选"提示重发"更简单且避免把口水原文塞进任务池，已在执行说明里标为可选增强（见下）
- §10 飞书配置 → Task 0 ✓
- §11 部署 → Task 8 ✓
- §12 测试 → 各任务 TDD + Task 8 端到端 ✓
- §13 验收标准 → Task 8 Step 6 逐条覆盖 ✓

**spec §9 偏差处理：** 为忠于 spec，执行 Task 7 时若希望"LLM 全失败原文入池"，把 `except AllChannelsFailed` 分支改为调用 `deps.write([{"text": text, "priority": None, "category": None, "today": False}])` 后回执"已按原文记录（提炼失败）"。默认 plan 采用更克制的"提示重发"，二者取一，实现时与用户确认。

**2. Placeholder scan：** 无 TBD/TODO；每个代码步骤含完整代码与命令；`main.py` 的 lark API 已给具体调用并注明"以实际版本为准"（非占位，是版本鲁棒性提示）。✓

**3. Type consistency：** `extract_tasks`/`write_tasks`/`handle_message`/`apply_today_cap`/`serialize_task_line` 在定义与调用处签名一致；任务 dict 字段（text/priority/category/today/today_applied）全程统一；`AllChannelsFailed` 定义于 Task 4、import 于 Task 7。✓
