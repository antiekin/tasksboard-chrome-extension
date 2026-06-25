import datetime
import archive


def test_build_log_line():
    assert archive.build_log_line("买菜 #家庭", "14:30") == "- 14:30 买菜 #家庭"


def test_append_creates_with_header():
    written = {}
    rel = archive.append_completion("买菜", now=datetime.datetime(2026, 6, 25, 14, 30),
                                    getter=lambda p: None, putter=lambda p, c: written.update(path=p, content=c))
    assert "20260625_完成日志.md" in rel and rel == written["path"]
    assert "# 2026-06-25 完成日志" in written["content"] and "- 14:30 买菜" in written["content"]


def test_append_to_existing():
    written = {}
    archive.append_completion("写方案", now=datetime.datetime(2026, 6, 25, 15, 0),
                              getter=lambda p: "# 2026-06-25 完成日志\n\n- 14:30 买菜\n",
                              putter=lambda p, c: written.update(content=c))
    assert "- 14:30 买菜" in written["content"] and "- 15:00 写方案" in written["content"]


def test_cleanup_removes_completed():
    md = "# T\n## 短期任务（7 天内完成）\n- [x] 已完成1\n- [ ] 未完成 #工作\n- [x] 已完成2\n## 其他\n- [x] 已完成3\n"
    written = {}
    n = archive.cleanup_completed_from_todo(reader=lambda: md, writer=lambda c: written.update(content=c))
    assert n == 3 and "已完成" not in written["content"] and "- [ ] 未完成 #工作" in written["content"]


def test_cleanup_no_completed_skips_write():
    md = "# T\n## 短期任务（7 天内完成）\n- [ ] a\n- [ ] b\n"
    written = {}
    n = archive.cleanup_completed_from_todo(reader=lambda: md, writer=lambda c: written.update(content=c))
    assert n == 0 and "content" not in written
