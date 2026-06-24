"""Tests for todo_writer.py — serialize, count, cap, insert functions."""
import pytest
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


def test_insert_section_not_found():
    with pytest.raises(ValueError, match="section not found"):
        tw.insert_task_lines("## 其他\n- [ ] z\n", ["- [ ] new"], "不存在的分区")


def test_insert_at_eof_section():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] old\n"
    out = tw.insert_task_lines(md, ["- [ ] new"], "短期任务（7 天内完成）")
    lines = out.split("\n")
    assert lines.index("- [ ] new") > lines.index("- [ ] old")


def test_count_active_today_boundary():
    # "#今日今天" must NOT count — no whitespace boundary after 日
    md = "## S\n- [ ] a #今日今天\n- [ ] b #今日\n"
    assert tw.count_active_today(md) == 1


def test_write_tasks_caps_today_and_returns_results(monkeypatch):
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] x #今日\n- [ ] y #今日\n\n## 其他\n"
    written = {}

    def reader():
        return md

    def writer(content):
        written["content"] = content

    monkeypatch.setattr(tw, "MAX_TODAY", 3)
    tasks = [{"text": "a", "priority": "A", "category": "工作", "today": True},
             {"text": "b", "priority": None, "category": None, "today": True}]
    results = tw.write_tasks(tasks, reader=reader, writer=writer)

    assert results[0]["today_applied"] is True   # 1 slot left (2 existing)
    assert results[1]["today_applied"] is False  # downgraded
    assert "- [ ] [A] a #工作 #今日" in written["content"]
    assert "- [ ] b" in written["content"]
    assert "- [ ] b #今日" not in written["content"]


# ─── Task 3: complete_task ───

def test_complete_marks_and_returns_display():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] 买菜 #家庭\n- [ ] 写方案 #工作 #今日\n"
    written = {}
    disp = tw.complete_task("买菜", reader=lambda: md, writer=lambda c: written.update(content=c))
    assert disp == "买菜 #家庭"
    assert "- [x] 买菜 #家庭" in written["content"]
    assert "- [ ] 写方案 #工作 #今日" in written["content"]  # 其他不动


def test_complete_no_match_returns_none():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] 买菜\n"
    written = {}
    disp = tw.complete_task("不存在", reader=lambda: md, writer=lambda c: written.update(content=c))
    assert disp is None
    assert "content" not in written  # 没写回


def test_complete_skips_already_done():
    md = "# T\n## 短期任务（7 天内完成）\n- [x] 买菜\n- [ ] 买菜\n"
    written = {}
    tw.complete_task("买菜", reader=lambda: md, writer=lambda c: written.update(content=c))
    # 标记第一条未完成的(第二行)，原本的 [x] 保持，结果两条都是 [x]
    assert written["content"].count("- [x] 买菜") == 2


# ─── Task 4: query_today / query_pool ───

def test_query_today_groups_and_counts():
    md = ("# T\n## 短期任务（7 天内完成）\n"
          "- [x] 买菜 #今日\n- [ ] 写方案 #工作 #今日\n- [ ] 非今日任务\n"
          "## 其他\n- [ ] 看书 #今日\n")
    q = tw.query_today(reader=lambda: md)
    assert q["total"] == 3 and q["done"] == 1
    texts = [i["text"] for i in q["items"]]
    assert "买菜" in texts and "写方案" in texts and "看书" in texts and "非今日任务" not in texts


def test_query_pool_filters_category_and_excludes_done():
    md = ("# T\n## 短期任务（7 天内完成）\n"
          "- [ ] 写方案 #工作\n- [x] 已完成的工作 #工作\n- [ ] 买菜 #家庭\n")
    work = tw.query_pool(category="工作", reader=lambda: md)
    assert [i["text"] for i in work] == ["写方案"]  # 排除已完成 + 排除非工作


def test_query_pool_all_when_no_filter():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] a\n- [x] b\n- [ ] c\n"
    allp = tw.query_pool(reader=lambda: md)
    assert [i["text"] for i in allp] == ["a", "c"]
