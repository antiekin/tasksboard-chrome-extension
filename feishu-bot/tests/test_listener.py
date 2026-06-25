"""Unit tests for feishu_listener — v3 intent routing + status overview."""
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
    base = dict(allowed_ids=["me"], dedup=_Dedup(), read_tasks=lambda: "",
        extract=lambda t, tl: {"intent": "add", "tasks": [], "pool_filter": {}, "match_text": None},
        write=lambda tasks: [], complete=lambda m: None, delete=lambda m: None,
        query_today=lambda: {"items": [], "total": 0, "done": 0},
        query_pool_by_section=lambda category=None: [])
    base.update(over)
    return types.SimpleNamespace(**base)


def test_route_add():
    deps = _deps(extract=lambda t, tl: {"intent": "add", "tasks": [{"text": "买菜", "priority": None, "category": None, "today": True}], "pool_filter": {}, "match_text": None}, write=lambda tasks: [{"text": "买菜", "today_applied": True}])
    r = fl.handle_message("买菜", "me", "m1", deps=deps)
    assert "已记录" in r and "买菜" in r


def test_route_query_today_marks_done():
    deps = _deps(extract=lambda t, tl: {"intent": "query_today", "tasks": [], "pool_filter": {}, "match_text": None}, query_today=lambda: {"items": [{"text": "买菜", "category": None, "completed": True}, {"text": "写方案", "category": "工作", "completed": False}], "total": 2, "done": 1})
    r = fl.handle_message("今天还有啥", "me", "m2", deps=deps)
    assert "今日必做" in r and "1/2" in r and "写方案 #工作" in r and "✅ 买菜" in r


def test_route_query_pool_grouped():
    secs = [{"name": "短期任务", "items": [{"text": "写方案", "category": "工作", "completed": False}, {"text": "旧事", "category": None, "completed": True}]}]
    deps = _deps(extract=lambda t, tl: {"intent": "query_pool", "tasks": [], "pool_filter": {"category": None, "section": None}, "match_text": None}, query_pool_by_section=lambda category=None: secs)
    r = fl.handle_message("任务池", "me", "m3", deps=deps)
    assert "【短期任务】" in r and "写方案 #工作" in r and "✅ 旧事" in r


def test_route_complete_today_no_pool():
    deps = _deps(extract=lambda t, tl: {"intent": "complete", "tasks": [], "pool_filter": {}, "match_text": "买菜"}, complete=lambda m: {"display": "买菜 #家庭", "was_today": True}, query_today=lambda: {"items": [{"text": "买菜", "category": "家庭", "completed": True}], "total": 1, "done": 1})
    r = fl.handle_message("买菜做完了", "me", "m4", deps=deps)
    assert "已完成：买菜 #家庭" in r and "今日必做" in r and "任务池" not in r


def test_route_complete_pool_lists_both():
    deps = _deps(extract=lambda t, tl: {"intent": "complete", "tasks": [], "pool_filter": {}, "match_text": "思考"}, complete=lambda m: {"display": "思考 #家庭", "was_today": False}, query_pool_by_section=lambda category=None: [{"name": "短期任务", "items": [{"text": "x", "category": None, "completed": False}]}])
    r = fl.handle_message("思考做完了", "me", "m5", deps=deps)
    assert "已完成：思考 #家庭" in r and "今日必做" in r and "任务池" in r


def test_route_complete_miss():
    deps = _deps(extract=lambda t, tl: {"intent": "complete", "tasks": [], "pool_filter": {}, "match_text": "不存在"}, complete=lambda m: None)
    assert "没找到" in fl.handle_message("xxx做完了", "me", "m6", deps=deps)


def test_route_delete():
    deps = _deps(extract=lambda t, tl: {"intent": "delete", "tasks": [], "pool_filter": {}, "match_text": "看球"}, delete=lambda m: {"display": "看球", "was_today": True}, query_today=lambda: {"items": [], "total": 0, "done": 0})
    r = fl.handle_message("删掉看球", "me", "m7", deps=deps)
    assert "已删除：看球" in r and "今日必做" in r


def test_route_delete_miss():
    deps = _deps(extract=lambda t, tl: {"intent": "delete", "tasks": [], "pool_filter": {}, "match_text": "无"}, delete=lambda m: None)
    assert "没找到" in fl.handle_message("删掉无", "me", "m8", deps=deps)


def test_llm_fail_writes_raw():
    written = {}
    def boom(t, tl):
        raise fl.AllChannelsFailed("down")
    def fake_write(tasks):
        written["tasks"] = tasks
        return [{"text": tasks[0]["text"], "today_applied": False}]
    dedup = _Dedup()
    deps = _deps(dedup=dedup, extract=boom, write=fake_write)
    r = fl.handle_message("买菜", "me", "m9", deps=deps)
    assert written["tasks"][0]["text"] == "买菜" and "m9" not in dedup.released and ("原文" in r or "识别失败" in r)


def test_write_failure_releases_claim():
    def boom_write(tasks):
        raise RuntimeError("obsidian down")
    dedup = _Dedup()
    deps = _deps(dedup=dedup, extract=lambda t, tl: {"intent": "add", "tasks": [{"text": "x", "priority": None, "category": None, "today": True}], "pool_filter": {}, "match_text": None}, write=boom_write)
    r = fl.handle_message("x", "me", "m10", deps=deps)
    assert "m10" in dedup.released and "失败" in r


def test_whitelist_and_dedup():
    assert fl.handle_message("x", "stranger", "m11", deps=_deps()) is None
    assert fl.handle_message("x", "me", "m12", deps=_deps(dedup=_Dedup(seen=["m12"]))) is None
