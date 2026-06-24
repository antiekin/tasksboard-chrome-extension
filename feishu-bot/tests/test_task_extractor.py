import pytest
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


class _RateLimit(Exception):
    status_code = 429


def test_extract_falls_back_on_429():
    calls = []

    def fake_caller(channel, messages):
        calls.append(channel["name"])
        if channel["name"] == "openrouter":
            raise _RateLimit()
        return '{"tasks":[{"text":"买菜","today":false}]}'

    tasks = te.extract_tasks("买菜", caller=fake_caller)
    assert calls == ["openrouter", "yunwu"]  # 429 → immediate next channel
    assert tasks[0]["text"] == "买菜"


def test_extract_retries_once_on_non_429():
    calls = []

    def fake_caller(channel, messages):
        calls.append(channel["name"])
        if len([c for c in calls if c == "openrouter"]) == 1:
            raise RuntimeError("timeout")  # non-429 → retry same channel
        return '{"tasks":[{"text":"x","today":false}]}'

    tasks = te.extract_tasks("x", caller=fake_caller)
    assert calls[:2] == ["openrouter", "openrouter"]


def test_extract_all_fail_raises():
    def fake_caller(channel, messages):
        raise RuntimeError("down")

    with pytest.raises(te.AllChannelsFailed) as exc_info:
        te.extract_tasks("x", caller=fake_caller)
    assert "openrouter" in str(exc_info.value) and "yunwu" in str(exc_info.value)


def test_extract_falls_back_on_malformed_json():
    calls = []
    def fake_caller(channel, messages):
        calls.append(channel["name"])
        if channel["name"] == "openrouter":
            return "not json at all"
        return '{"tasks":[{"text":"买菜","today":false}]}'
    tasks = te.extract_tasks("买菜", caller=fake_caller)
    # malformed JSON is non-429 → retry same channel once → then fall back to yunwu
    assert calls == ["openrouter", "openrouter", "yunwu"]
    assert tasks[0]["text"] == "买菜"
