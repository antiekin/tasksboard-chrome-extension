import pytest
import task_extractor as te


def test_build_messages_injects_task_list():
    msgs = te.build_messages("买菜", "[短期] 写方案 #工作 #今日 (未完成)")
    assert msgs[0]["role"] == "system"
    assert "写方案" in msgs[-1]["content"] and "买菜" in msgs[-1]["content"]


def test_build_messages_no_list():
    msgs = te.build_messages("买菜", "")
    assert "买菜" in msgs[-1]["content"]


def test_parse_add_intent():
    raw = '{"intent":"add","tasks":[{"text":"买菜","priority":null,"category":null,"today":true}]}'
    d = te.parse_llm_json(raw)
    assert d["intent"] == "add"
    assert d["tasks"][0]["text"] == "买菜" and d["tasks"][0]["today"] is True


def test_parse_strips_code_fence_and_cleans():
    raw = '```json\n{"intent":"add","tasks":[{"text":"写方案","priority":"A","category":"工作","today":true}]}\n```'
    d = te.parse_llm_json(raw)
    assert d["tasks"] == [{"text": "写方案", "priority": "A", "category": "工作", "today": True}]


def test_parse_nullifies_invalid_priority_and_category():
    raw = '{"intent":"add","tasks":[{"text":"x","priority":"Z","category":"副业","today":false}]}'
    d = te.parse_llm_json(raw)
    assert d["tasks"][0]["priority"] is None and d["tasks"][0]["category"] is None


def test_parse_drops_empty_text():
    raw = '{"intent":"add","tasks":[{"text":"   ","today":true},{"text":"买奶","today":false}]}'
    d = te.parse_llm_json(raw)
    assert len(d["tasks"]) == 1 and d["tasks"][0]["text"] == "买奶"


def test_parse_query_today_intent():
    d = te.parse_llm_json('{"intent":"query_today"}')
    assert d["intent"] == "query_today"


def test_parse_query_pool_intent():
    raw = '{"intent":"query_pool","pool_filter":{"category":"工作","section":null}}'
    d = te.parse_llm_json(raw)
    assert d["intent"] == "query_pool" and d["pool_filter"]["category"] == "工作"


def test_parse_query_pool_invalid_category_nullified():
    raw = '{"intent":"query_pool","pool_filter":{"category":"副业","section":null}}'
    d = te.parse_llm_json(raw)
    assert d["pool_filter"]["category"] is None


def test_parse_complete_intent():
    d = te.parse_llm_json('{"intent":"complete","match_text":"买菜"}')
    assert d["intent"] == "complete" and d["match_text"] == "买菜"


def test_parse_complete_match_legacy_alias():
    # backward-compat: complete_match still accepted as match_text
    d = te.parse_llm_json('{"intent":"complete","complete_match":"买菜"}')
    assert d["match_text"] == "买菜"


def test_parse_delete_intent():
    d = te.parse_llm_json('{"intent":"delete","match_text":"看球"}')
    assert d["intent"] == "delete" and d["match_text"] == "看球"


def test_parse_blank_match_to_none():
    d = te.parse_llm_json('{"intent":"complete","match_text":"  "}')
    assert d["match_text"] is None


def test_parse_invalid_intent_defaults_add():
    d = te.parse_llm_json('{"intent":"frobnicate","tasks":[{"text":"x","today":false}]}')
    assert d["intent"] == "add"


class _RateLimit(Exception):
    status_code = 429


def test_extract_message_falls_back_on_429():
    calls = []

    def fake(channel, messages):
        calls.append(channel["name"])
        if channel["name"] == "openrouter":
            raise _RateLimit()
        return '{"intent":"query_today"}'

    d = te.extract_message("今天还有啥", "", caller=fake)
    assert calls == ["openrouter", "yunwu"] and d["intent"] == "query_today"


def test_extract_message_retries_once_on_non_429():
    calls = []

    def fake(channel, messages):
        calls.append(channel["name"])
        if len([c for c in calls if c == "openrouter"]) == 1:
            raise RuntimeError("timeout")
        return '{"intent":"add","tasks":[{"text":"x","today":false}]}'

    te.extract_message("x", "", caller=fake)
    assert calls[:2] == ["openrouter", "openrouter"]


def test_extract_message_all_fail_raises():
    def fake(channel, messages):
        raise RuntimeError("down")

    with pytest.raises(te.AllChannelsFailed) as exc_info:
        te.extract_message("x", "", caller=fake)
    assert "openrouter" in str(exc_info.value) and "yunwu" in str(exc_info.value)
