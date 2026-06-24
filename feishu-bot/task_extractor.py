"""Extract structured tasks from a free-text Feishu message via LLM."""
import json
import re

import httpx
from openai import OpenAI

from config import LLM_CHANNELS, VALID_CATEGORIES, VALID_PRIORITIES, load_keys

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
    """Construct OpenAI-format messages for task extraction.

    Args:
        user_text: Raw user message text

    Returns:
        list[dict]: Messages with "role" and "content" keys
    """
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_text},
    ]


def _strip_fence(raw):
    """Strip ```json code fence from LLM output.

    Args:
        raw: Raw string that may contain code fence

    Returns:
        str: Content inside fence, or raw string if no fence found
    """
    m = re.search(r"```(?:json)?\s*(.+?)\s*```", raw, re.DOTALL)
    return m.group(1) if m else raw.strip()


def parse_llm_json(raw):
    """Parse and clean LLM JSON output into task list.

    Strips code fences, validates priority/category against config,
    drops entries with empty text.

    Args:
        raw: Raw LLM output (may contain ```json fence)

    Returns:
        list[dict]: List of tasks with keys: text, priority, category, today
    """
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


class AllChannelsFailed(Exception):
    """Raised when all LLM channels fail to produce a successful task extraction."""
    pass


def _is_rate_limit(exc):
    """Check if exception is a 429 rate limit error.

    Args:
        exc: Exception to check

    Returns:
        bool: True if exception has status_code == 429 or "429" in str
    """
    return getattr(exc, "status_code", None) == 429 or "429" in str(exc)


def call_channel(channel, messages):
    """Call a single LLM channel via OpenAI-compatible API.

    Args:
        channel: Channel dict with keys: name, base_url, model, key_name
        messages: List of message dicts with role and content

    Returns:
        str: Content text from the LLM response

    Raises:
        RuntimeError: If response has no choices
        Exception: If the API call fails
    """
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
    """Extract structured tasks from user text using LLM with fallback orchestration.

    Strategy:
    - Try each channel in order
    - On 429: fast-fail to next channel (no retry)
    - On non-429 error: retry same channel once
    - If all channels fail: raise AllChannelsFailed with aggregated errors

    Args:
        user_text: Raw user input text
        channels: List of channel dicts (default: LLM_CHANNELS from config)
        caller: Function to call a channel (default: call_channel)

    Returns:
        list[dict]: Extracted tasks

    Raises:
        AllChannelsFailed: If all channels fail
    """
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
