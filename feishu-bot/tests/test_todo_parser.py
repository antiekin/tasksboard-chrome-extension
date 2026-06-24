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
