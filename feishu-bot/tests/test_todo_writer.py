"""Tests for todo_writer.py — serialize, count, cap, insert functions."""
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
