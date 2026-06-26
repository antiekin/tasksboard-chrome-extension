"""Tests for todo_writer — serialize/count/cap/insert/complete/delete/query."""
import pytest
import todo_writer as tw


def test_serialize_full():
    assert tw.serialize_task_line({"text": "写方案", "priority": "A", "category": "工作"}, today_applied=True) == "- [ ] [A] 写方案 #工作 #今日"


def test_serialize_minimal():
    assert tw.serialize_task_line({"text": "买菜", "priority": None, "category": None}, today_applied=False) == "- [ ] 买菜"


def test_count_active_today_ignores_completed():
    assert tw.count_active_today("## S\n- [ ] a #今日\n- [x] b #今日\n- [ ] c\n") == 1


def test_apply_today_cap_respects_max(monkeypatch):
    monkeypatch.setattr(tw, "MAX_TODAY", 3)
    out = tw.apply_today_cap([{"text": "a", "today": True}, {"text": "b", "today": True}], current_count=2)
    assert out[0]["today_applied"] is True and out[1]["today_applied"] is False


def test_insert_into_section_end():
    md = "# T\n## 短期任务（7 天内完成）\n<!-- c -->\n- [ ] old\n\n## 其他\n- [ ] z\n"
    out = tw.insert_task_lines(md, ["- [ ] new"], "短期任务（7 天内完成）")
    lines = out.split("\n")
    assert lines.index("- [ ] new") > lines.index("- [ ] old") and lines.index("- [ ] new") < lines.index("## 其他")


def test_insert_section_not_found():
    with pytest.raises(ValueError, match="section not found"):
        tw.insert_task_lines("## 其他\n- [ ] z\n", ["- [ ] new"], "不存在")


def test_insert_at_eof_section():
    out = tw.insert_task_lines("# T\n## 短期任务（7 天内完成）\n- [ ] old\n", ["- [ ] new"], "短期任务（7 天内完成）")
    lines = out.split("\n")
    assert lines.index("- [ ] new") > lines.index("- [ ] old")


def test_count_active_today_boundary():
    assert tw.count_active_today("## S\n- [ ] a #今日今天\n- [ ] b #今日\n") == 1


def test_write_tasks_caps_today(monkeypatch):
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] x #今日\n- [ ] y #今日\n\n## 其他\n"
    written = {}
    monkeypatch.setattr(tw, "MAX_TODAY", 3)
    tasks = [{"text": "a", "priority": "A", "category": "工作", "today": True}, {"text": "b", "priority": None, "category": None, "today": True}]
    results = tw.write_tasks(tasks, reader=lambda: md, writer=lambda c: written.update(content=c))
    assert results[0]["today_applied"] is True and results[1]["today_applied"] is False
    assert "- [ ] [A] a #工作 #今日" in written["content"] and "- [ ] b" in written["content"] and "- [ ] b #今日" not in written["content"]


def test_complete_marks_and_returns_dict():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] 买菜 #家庭\n- [ ] 写方案 #工作 #今日\n"
    written = {}
    r = tw.complete_task("买菜", reader=lambda: md, writer=lambda c: written.update(content=c))
    assert r["display"] == "买菜 #家庭" and r["was_today"] is False
    assert "- [x] 买菜 #家庭" in written["content"] and "- [ ] 写方案 #工作 #今日" in written["content"]


def test_complete_today_reports_was_today():
    written = {}
    r = tw.complete_task("写方案", reader=lambda: "# T\n## 短期任务（7 天内完成）\n- [ ] 写方案 #工作 #今日\n", writer=lambda c: written.update(content=c))
    assert r["was_today"] is True


def test_complete_no_match_returns_none():
    written = {}
    r = tw.complete_task("不存在", reader=lambda: "# T\n## 短期任务（7 天内完成）\n- [ ] 买菜\n", writer=lambda c: written.update(content=c))
    assert r is None and "content" not in written


def test_complete_skips_already_done():
    md = "# T\n## 短期任务（7 天内完成）\n- [x] 买菜\n- [ ] 买菜\n"
    written = {}
    tw.complete_task("买菜", reader=lambda: md, writer=lambda c: written.update(content=c))
    assert written["content"].count("- [x] 买菜") == 2


def test_delete_removes_and_returns_dict():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] 买菜 #家庭\n- [ ] 写方案 #工作 #今日\n"
    written = {}
    r = tw.delete_task("买菜", reader=lambda: md, writer=lambda c: written.update(content=c))
    assert r["display"] == "买菜 #家庭" and r["was_today"] is False
    assert "买菜" not in written["content"] and "- [ ] 写方案 #工作 #今日" in written["content"]


def test_delete_today_reports_was_today():
    written = {}
    r = tw.delete_task("看球", reader=lambda: "# T\n## 短期任务（7 天内完成）\n- [ ] 看球 #今日\n", writer=lambda c: written.update(content=c))
    assert r["was_today"] is True and "看球" not in written["content"]


def test_delete_no_match_returns_none():
    written = {}
    r = tw.delete_task("不存在", reader=lambda: "# T\n## 短期任务（7 天内完成）\n- [ ] 买菜\n", writer=lambda c: written.update(content=c))
    assert r is None and "content" not in written


def test_query_today_groups_and_counts():
    md = "# T\n## 短期任务（7 天内完成）\n- [x] 买菜 #今日\n- [ ] 写方案 #工作 #今日\n- [ ] 非今日\n## 其他\n- [ ] 看书 #今日\n"
    q = tw.query_today(reader=lambda: md)
    assert q["total"] == 3 and q["done"] == 1
    texts = [i["text"] for i in q["items"]]
    assert "买菜" in texts and "写方案" in texts and "看书" in texts and "非今日" not in texts


def test_query_pool_filters_category():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] 写方案 #工作\n- [x] 已完成 #工作\n- [ ] 买菜 #家庭\n"
    assert [i["text"] for i in tw.query_pool(category="工作", reader=lambda: md)] == ["写方案"]


def test_query_pool_all_when_no_filter():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] a\n- [x] b\n- [ ] c\n"
    assert [i["text"] for i in tw.query_pool(reader=lambda: md)] == ["a", "c"]


def test_query_pool_by_section_groups_with_completion():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] 写方案 #工作\n- [x] 已完成 #工作\n## 中长期任务\n- [ ] 写宪章 #家庭\n"
    secs = tw.query_pool_by_section(reader=lambda: md)
    assert [s["name"] for s in secs] == ["短期任务（7 天内完成）", "中长期任务"]
    assert {"text": "写方案", "category": "工作", "completed": False} in secs[0]["items"]
    assert {"text": "已完成", "category": "工作", "completed": True} in secs[0]["items"]


def test_query_pool_by_section_category_filter_omits_empty():
    md = "# T\n## 短期任务\n- [ ] 写方案 #工作\n## 其他\n- [ ] 买菜 #家庭\n"
    assert [s["name"] for s in tw.query_pool_by_section(category="工作", reader=lambda: md)] == ["短期任务"]
