"""Extract intent + structured payload from a Feishu message via LLM (v3).

One LLM call classifies the message intent (add/query_today/query_pool/complete/delete)
and produces the matching payload. The current task list (parsed from todo.md) is
injected so the model can both judge intent and locate the complete/delete target.
"""
import json
import re

import httpx
from openai import OpenAI

from config import LLM_CHANNELS, VALID_CATEGORIES, VALID_PRIORITIES, load_keys

SYSTEM_PROMPT = """你是任务助手。判断用户消息的意图并输出 JSON。
意图 intent 取值之一：
- "add"：要新增任务（默认；记一件/几件待办）
- "query_today"：想看今天的必做
- "query_pool"：想看任务池/某分类/某栏目的任务
- "complete"：说某件事做完了/完成了
- "delete"：要删除/去掉某个任务（不是完成，是移除）

输出格式：
{"intent":"...","tasks":[{"text","priority","category","today"}],"pool_filter":{"category":null,"section":null},"match_text":null}

规则：
- intent=add：填 tasks。text 去口水；priority 仅 S/A/B/C 否则 null；category 仅 家庭/工作/健康/学习 否则 null；today：消息表达"今天/马上/必须今天"→true。可多任务。
- intent=query_pool：填 pool_filter。说"工作的任务"→category"工作"；说某栏目名→section；泛指"任务池/还有什么"→都 null。
- intent=complete 或 delete：从下方「当前任务」列表里挑最匹配的一条，把它的纯文本（不含 #分类/#今日）放进 match_text；没有合理匹配→null。
- 区分 complete 与 delete：消息说"做完了/完成了/搞定了"→complete；说"删掉/删除/去掉/不要了"→delete。
- 不相关字段留空/ null。只输出 JSON。"""


def summarize_tasks(parsed):
    """Compress a parsed todo.md into a compact task-list text for the LLM.

    Args:
        parsed: output of todo_parser.parse_todo

    Returns:
        str: one line per task — "[栏目] 文本 #分类 #今日 (未完成)"
    """
    lines = []
    for sec in parsed.get("sections", []):
        for it in sec["items"]:
            tag = " #" + it["category"] if it.get("category") else ""
            today = " #今日" if it.get("today") else ""
            done = "已完成" if it["completed"] else "未完成"
            lines.append(f"[{sec['name']}] {it['text']}{tag}{today} ({done})")
    return "\n".join(lines)


def build_messages(user_text, task_list):
    """Build OpenAI-format messages, injecting the current task list."""
    user = user_text
    if task_list:
        user = f"{user_text}\n\n当前任务（供判断意图和定位「完成/删除」目标）：\n{task_list}"
    return [{"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user}]


def _strip_fence(raw):
    """Strip a ```json ... ``` fence if present."""
    m = re.search(r"```(?:json)?\s*(.+?)\s*```", raw, re.DOTALL)
    return m.group(1) if m else raw.strip()


def _clean_tasks(items):
    """Validate/clean add-task items: nullify bad priority/category, drop empty text."""
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
    """Parse LLM output into {intent, tasks, pool_filter, match_text}.

    Invalid/missing intent defaults to "add". Category in pool_filter is validated
    against the four allowed categories. match_text is normalized to None if blank.
    """
    data = json.loads(_strip_fence(raw))
    intent = data.get("intent")
    if intent not in ("add", "query_today", "query_pool", "complete", "delete"):
        intent = "add"
    pf = data.get("pool_filter") or {}
    cat = pf.get("category") if pf.get("category") in VALID_CATEGORIES else None
    # accept legacy "complete_match" as an alias for match_text
    mt = data.get("match_text") if data.get("match_text") is not None else data.get("complete_match")
    mt = mt.strip() if isinstance(mt, str) and mt.strip() else None
    return {
        "intent": intent,
        "tasks": _clean_tasks(data.get("tasks")),
        "pool_filter": {"category": cat, "section": pf.get("section") or None},
        "match_text": mt,
    }


class AllChannelsFailed(Exception):
    """Raised when all LLM channels fail."""
    pass


def _is_rate_limit(exc):
    """True if the exception looks like a 429 rate limit."""
    return getattr(exc, "status_code", None) == 429 or "429" in str(exc)


def call_channel(channel, messages):
    """Call one LLM channel via the OpenAI-compatible API; return content text."""
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


def extract_message(user_text, task_list, channels=LLM_CHANNELS, caller=call_channel):
    """Classify intent + extract payload, with channel fallback.

    OpenRouter first → Yunwu fallback; 429 fast-fails to next channel, non-429
    retries the same channel once. Raises AllChannelsFailed if all fail.

    Returns:
        dict: {intent, tasks, pool_filter, match_text}
    """
    messages = build_messages(user_text, task_list)
    errors = []
    for channel in channels:
        try:
            return parse_llm_json(caller(channel, messages))
        except Exception as exc:
            if _is_rate_limit(exc):
                errors.append(f"{channel['name']}: 429")
                continue  # fast-fail to next channel
            try:
                return parse_llm_json(caller(channel, messages))
            except Exception as exc2:
                errors.append(f"{channel['name']}: {exc} → retry: {exc2}")
                continue
    raise AllChannelsFailed(" | ".join(errors))
