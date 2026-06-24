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
