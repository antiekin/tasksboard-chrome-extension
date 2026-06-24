"""Unit tests for feishu_listener — v2 intent routing (dependency-injected)."""
import types
import feishu_listener as fl


class _Dedup:
    def __init__(self, seen=()):
        self.seen, self.released = set(seen), []

    def claim(self, mid):
        if mid in self.seen:
            return False
        self.seen.add(mid)
        return True

    def release(self, mid):
        self.released.append(mid)
        self.seen.discard(mid)


def _deps(**over):
    base = dict(
        allowed_ids=["me"], dedup=_Dedup(), read_tasks=lambda: "",
        extract=lambda t, tl: {"intent": "add", "tasks": [], "pool_filter": {},
                               "complete_match": None},
        write=lambda tasks: [], complete=lambda m: None,
        query_today=lambda: {"items": [], "total": 0, "done": 0},
        query_pool=lambda category=None, section=None: [],
    )
    base.update(over)
    return types.SimpleNamespace(**base)


def test_route_add():
    deps = _deps(
        extract=lambda t, tl: {"intent": "add",
            "tasks": [{"text": "买菜", "priority": None, "category": None, "today": True}],
            "pool_filter": {}, "complete_match": None},
        write=lambda tasks: [{"text": "买菜", "today_applied": True}])
    r = fl.handle_message("买菜", "me", "m1", deps=deps)
    assert "已记录" in r and "买菜" in r


def test_route_query_today():
    deps = _deps(
        extract=lambda t, tl: {"intent": "query_today", "tasks": [],
            "pool_filter": {}, "complete_match": None},
        query_today=lambda: {"items": [{"text": "买菜", "category": None, "completed": True},
                                        {"text": "写方案", "category": "工作", "completed": False}],
                             "total": 2, "done": 1})
    r = fl.handle_message("今天还有啥", "me", "m2", deps=deps)
    assert "今日必做" in r and "1/2" in r and "写方案" in r


def test_route_complete_hit():
    deps = _deps(
        extract=lambda t, tl: {"intent": "complete", "tasks": [],
            "pool_filter": {}, "complete_match": "买菜"},
        complete=lambda m: "买菜 #家庭")
    r = fl.handle_message("买菜做完了", "me", "m3", deps=deps)
    assert "已完成" in r and "买菜 #家庭" in r


def test_route_complete_miss():
    deps = _deps(
        extract=lambda t, tl: {"intent": "complete", "tasks": [],
            "pool_filter": {}, "complete_match": "不存在"},
        complete=lambda m: None)
    r = fl.handle_message("xxx做完了", "me", "m4", deps=deps)
    assert "没找到" in r


def test_route_query_pool_truncates():
    items = [{"text": f"任务{i}", "category": None, "section": "短期任务"} for i in range(20)]
    deps = _deps(
        extract=lambda t, tl: {"intent": "query_pool", "tasks": [],
            "pool_filter": {"category": None, "section": None}, "complete_match": None},
        query_pool=lambda category=None, section=None: items)
    r = fl.handle_message("任务池还有啥", "me", "m5", deps=deps)
    assert "还有 5 条" in r  # 20 - 15


def test_llm_fail_writes_raw_text():
    written = {}

    def boom(t, tl):
        raise fl.AllChannelsFailed("down")

    def fake_write(tasks):
        written["tasks"] = tasks
        return [{"text": tasks[0]["text"], "today_applied": False}]

    dedup = _Dedup()
    deps = _deps(dedup=dedup, extract=boom, write=fake_write)
    r = fl.handle_message("买菜", "me", "m6", deps=deps)
    assert written["tasks"][0]["text"] == "买菜"  # raw text written
    assert "m6" not in dedup.released              # NOT released — task recorded
    assert "原文" in r or "识别失败" in r


def test_write_failure_releases_claim():
    def boom_write(tasks):
        raise RuntimeError("obsidian down")

    dedup = _Dedup()
    deps = _deps(dedup=dedup,
                 extract=lambda t, tl: {"intent": "add",
                     "tasks": [{"text": "x", "priority": None, "category": None, "today": True}],
                     "pool_filter": {}, "complete_match": None},
                 write=boom_write)
    r = fl.handle_message("x", "me", "m7", deps=deps)
    assert "m7" in dedup.released and "失败" in r


def test_whitelist_and_dedup_still_apply():
    assert fl.handle_message("x", "stranger", "m8", deps=_deps()) is None
    d = _deps(dedup=_Dedup(seen=["m9"]))
    assert fl.handle_message("x", "me", "m9", deps=d) is None


def test_receipt_flags_today_downgrade():
    text = fl.format_receipt([{"text": "a", "today_applied": False}], wanted_today={"a"})
    assert "满 3" in text or "入池" in text
