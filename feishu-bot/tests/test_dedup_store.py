"""Tests for dedup_store.py (idempotency store)."""
from dedup_store import DedupStore


def test_claim_first_time_true_then_false(tmp_path):
    store = DedupStore(tmp_path / "dedup.db")
    assert store.claim("msg_1") is True
    assert store.claim("msg_1") is False  # duplicate


def test_release_allows_reclaim(tmp_path):
    store = DedupStore(tmp_path / "dedup.db")
    assert store.claim("msg_2") is True
    store.release("msg_2")
    assert store.claim("msg_2") is True  # reclaimable after release


def test_claim_persists_across_reopen(tmp_path):
    path = tmp_path / "dedup.db"
    DedupStore(path).claim("msg_3")
    store2 = DedupStore(path)
    assert store2.claim("msg_3") is False  # persisted across reopen
