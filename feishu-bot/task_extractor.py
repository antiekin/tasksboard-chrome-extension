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
