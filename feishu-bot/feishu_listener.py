"""Orchestration for an incoming Feishu message (v2: LLM intent routing, dependency-injected).

Deps namespace expected by handle_message:
  .allowed_ids   — iterable of allowed open_id strings
  .dedup         — DedupStore (.claim(mid)->bool, .release(mid))
  .read_tasks    — callable() -> str  (compact task list for the LLM)
  .extract       — callable(text, task_list) -> dict  (raises AllChannelsFailed)
                   dict = {intent, tasks, pool_filter:{category,section}, complete_match}
  .write         — callable(tasks) -> list[dict]   (add path; v1 write_tasks)
  .complete      — callable(match) -> str|None      (mark-complete; display text or None)
  .query_today   — callable() -> {items, total, done}
  .query_pool    — callable(category, section) -> list[{text,category,section}]
"""
from task_extractor import AllChannelsFailed


def format_receipt(results, wanted_today=frozenset()):
    """Receipt for the add path (unchanged from v1)."""
    lines = [f"✅ 已记录 {len(results)} 条："]
    for r in results:
        lines.append(f"• {r['text']}")
    downgraded = [r["text"] for r in results
                  if r["text"] in wanted_today and not r["today_applied"]]
    if downgraded:
        lines.append(
            f"⚠️ 今日必做已满 3，{'、'.join(downgraded)} 先入池，完成一个再设今日")
    return "\n".join(lines)


def format_today(q):
    """Receipt for query_today: progress header + each item with done/undone mark."""
    lines = [f"📋 今日必做 ({q['done']}/{q['total']})"]
    for it in q["items"]:
        mark = "✅" if it["completed"] else "⬜"
        cat = f" #{it['category']}" if it.get("category") else ""
        lines.append(f"{mark} {it['text']}{cat}")
    if q["total"] == 0:
        lines.append("（今天还没设必做，发一句话记一件吧）")
    return "\n".join(lines)


def format_pool(items, max_n=15):
    """Receipt for query_pool: list incomplete items, truncate past max_n."""
    if not items:
        return "🔍 没有匹配的未完成任务"
    shown = items[:max_n]
    lines = ["📂 任务池："]
    for it in shown:
        cat = f" #{it['category']}" if it.get("category") else ""
        lines.append(f"⬜ {it['text']}{cat}")
    if len(items) > max_n:
        lines.append(f"…还有 {len(items) - max_n} 条，去扩展看")
    return "\n".join(lines)


def format_complete(disp, asked):
    """Receipt for complete: show the marked task's full text, or a not-found note."""
    if disp is None:
        return f"🔍 没找到匹配「{asked}」的任务，可换个说法或去扩展操作"
    return f"✅ 已完成：{disp}"


def handle_message(text, sender, message_id, *, deps):
    """Orchestrate one incoming Feishu message with intent routing.

    Flow: whitelist → dedup claim → read task list → LLM extract {intent,...} →
    route to add / query_today / query_pool / complete. LLM total failure falls back
    to add-raw-text (spec §9, keeps claim). Any other exception releases the claim.

    Returns:
        str | None: receipt to send back, or None if silently ignored.
    """
    if sender not in deps.allowed_ids:
        return None
    if not deps.dedup.claim(message_id):
        return None
    try:
        task_list = deps.read_tasks()
        try:
            result = deps.extract(text, task_list)
        except AllChannelsFailed:
            # spec §9: LLM 全失败 → 原文入池（无法判意图时的保守默认），保留 claim
            results = deps.write([{"text": text, "priority": None,
                                   "category": None, "today": False}])
            return format_receipt(results, frozenset()) + "\n（识别失败，已按原文记录，请稍后整理）"
        intent = result["intent"]
        if intent == "query_today":
            return format_today(deps.query_today())
        if intent == "query_pool":
            pf = result["pool_filter"]
            return format_pool(deps.query_pool(category=pf.get("category"), section=pf.get("section")))
        if intent == "complete":
            return format_complete(deps.complete(result["complete_match"]), result["complete_match"])
        # default: add
        wanted_today = {t["text"] for t in result["tasks"] if t.get("today")}
        return format_receipt(deps.write(result["tasks"]), wanted_today)
    except Exception as exc:
        deps.dedup.release(message_id)
        return f"⚠️ 处理失败：{exc}"
