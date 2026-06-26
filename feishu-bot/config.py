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
