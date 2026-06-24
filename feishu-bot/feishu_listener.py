"""Orchestration for an incoming Feishu message (pure, dependency-injected).

Deps namespace expected by handle_message:
  .allowed_ids  — iterable of allowed open_id strings
  .dedup        — DedupStore (or duck-typed: .claim(mid) -> bool, .release(mid))
  .extract      — callable(text: str) -> list[dict]  (raises AllChannelsFailed)
  .write        — callable(tasks: list[dict]) -> list[dict]  (returns result dicts)
"""
from task_extractor import AllChannelsFailed


def format_receipt(results, wanted_today=frozenset()):
    """Build a human-readable receipt string for the user.

    Args:
        results: list of result dicts, each with "text" and "today_applied" keys.
        wanted_today: set of task texts that were originally marked today=True.

    Returns:
        str: Formatted receipt text for sending back to the user.
    """
    lines = [f"✅ 已记录 {len(results)} 条："]
    for r in results:
        lines.append(f"• {r['text']}")
    downgraded = [r["text"] for r in results
                  if r["text"] in wanted_today and not r["today_applied"]]
    if downgraded:
        lines.append(
            f"⚠️ 今日必做已满 3，"
            f"{'、'.join(downgraded)}"
            f" 先入池，完成一个再设今日"
        )
    return "\n".join(lines)


def handle_message(text, sender, message_id, *, deps):
    """Orchestrate one incoming Feishu message.

    Flow:
      1. Whitelist check — non-allowed senders are silently ignored (return None).
      2. Dedup check — already-seen message_ids are skipped (return None).
      3. Extract tasks via deps.extract (LLM call).
         - AllChannelsFailed → write raw text as fallback (spec §9), keep claim.
      4. Write tasks via deps.write.
         - Any exception → release claim so re-delivery can retry, return error msg.
      5. Return formatted receipt.

    Args:
        text: Raw message text from Feishu.
        sender: open_id of the message sender.
        message_id: Feishu message_id used for deduplication.
        deps: Namespace with allowed_ids, dedup, extract, write.

    Returns:
        str | None: Receipt text to send back, or None if silently ignored.
    """
    if sender not in deps.allowed_ids:
        return None
    if not deps.dedup.claim(message_id):
        return None
    try:
        try:
            tasks = deps.extract(text)
        except AllChannelsFailed:
            # spec §9: LLM 全失败 → 原文入池，不丢任务（用户确认采用此方案）
            results = deps.write([{"text": text, "priority": None,
                                   "category": None, "today": False}])
            return format_receipt(results, frozenset()) + "\n（提炼失败，已按原文记录，请稍后整理）"
        wanted_today = {t["text"] for t in tasks if t.get("today")}
        results = deps.write(tasks)
        return format_receipt(results, wanted_today)
    except Exception as exc:
        deps.dedup.release(message_id)
        return f"⚠️ 处理失败：{exc}"
