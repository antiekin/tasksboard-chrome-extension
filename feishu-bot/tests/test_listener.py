"""Unit tests for feishu_listener — pure orchestration layer."""
import types
import feishu_listener as fl


def _deps(allowed, dedup, extract, write):
    return types.SimpleNamespace(allowed_ids=allowed, dedup=dedup,
                                 extract=extract, write=write)


class _Dedup:
    def __init__(self, seen=()):
        self.seen = set(seen)
        self.released = []

    def claim(self, mid):
        if mid in self.seen:
            return False
        self.seen.add(mid)
        return True

    def release(self, mid):
        self.released.append(mid)
        self.seen.discard(mid)


def test_rejects_non_whitelisted():
    deps = _deps(["me"], _Dedup(), lambda t: [], lambda r: [])
    assert fl.handle_message("hi", "stranger", "m1", deps=deps) is None


def test_dedup_skips_repeat():
    deps = _deps(["me"], _Dedup(seen=["m1"]), lambda t: [], lambda r: [])
    assert fl.handle_message("hi", "me", "m1", deps=deps) is None


def test_happy_path_returns_receipt():
    extract = lambda t: [{"text": "写方案", "priority": "A", "category": "工作", "today": True}]
    write = lambda tasks: [{"text": "写方案", "today_applied": True}]
    deps = _deps(["me"], _Dedup(), extract, write)
    receipt = fl.handle_message("写方案", "me", "m2", deps=deps)
    assert "写方案" in receipt and "已记录" in receipt


def test_llm_fail_writes_raw_text():
    written = {}
    def boom(t):
        raise fl.AllChannelsFailed("down")
    def fake_write(tasks):
        written["tasks"] = tasks
        return [{"text": tasks[0]["text"], "today_applied": False}]
    dedup = _Dedup()
    deps = _deps(["me"], dedup, boom, fake_write)
    receipt = fl.handle_message("买菜", "me", "m3", deps=deps)
    assert written["tasks"][0]["text"] == "买菜"   # raw text written to pool
    assert "m3" not in dedup.released               # NOT released — task was recorded
    assert "原文" in receipt or "提炼失败" in receipt


def test_write_failure_releases_claim():
    def extract_ok(t):
        return [{"text": "x", "priority": None, "category": None, "today": True}]
    def boom_write(tasks):
        raise RuntimeError("obsidian down")
    dedup = _Dedup()
    deps = _deps(["me"], dedup, extract_ok, boom_write)
    receipt = fl.handle_message("x", "me", "m4", deps=deps)
    assert "m4" in dedup.released                    # released so a redelivery can retry
    assert "失败" in receipt


def test_receipt_flags_today_downgrade():
    results = [{"text": "a", "today_applied": False}]
    # original task wanted today; downgrade note expected
    text = fl.format_receipt(results, wanted_today={"a"})
    assert "满 3" in text or "入池" in text
