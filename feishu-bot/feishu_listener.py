"""Orchestration for an incoming Feishu message (v3: intent routing + status overview).

Deps namespace expected by handle_message:
  .allowed_ids          — iterable of allowed open_id strings
  .dedup                — DedupStore (.claim(mid)->bool, .release(mid))
  .read_tasks           — callable() -> str  (compact task list for the LLM)
  .extract              — callable(text, task_list) -> dict  (raises AllChannelsFailed)
                          dict = {intent, tasks, pool_filter:{category,section}, match_text}
  .write                — callable(tasks) -> list[dict]              (add path)
  .complete             — callable(match) -> {display, was_today}|None
  .delete               — callable(match) -> {display, was_today}|None
  .query_today          — callable() -> {items, total, done}
  .query_pool_by_section— callable(category) -> [{name, items:[{text,category,completed}]}]
"""
from task_extractor import AllChannelsFailed

_DONE = "✅ "    # completed mark
_TODO = "　 "    # incomplete: leave blank (full-width space keeps alignment)


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


def _cat(it):
    return f" #{it['category']}" if it.get("category") else ""


def format_today(q):
    """Today's must-do list: ✅ done, blank for not-done."""
    lines = [f"📋 今日必做 {q['done']}/{q['total']}"]
    for it in q["items"]:
        mark = _DONE if it["completed"] else _TODO
        lines.append(f"{mark}{it['text']}{_cat(it)}")
    if q["total"] == 0:
        lines.append("（今天还没设必做，发一句话记一件吧）")
    return "\n".join(lines)


def format_pool_grouped(sections):
    """Task pool grouped by section: 【section】 then each task (✅ done / blank)."""
    if not sections:
        return "📂 任务池：没有匹配的任务"
    lines = ["📂 任务池"]
    for sec in sections:
        lines.append(f"【{sec['name']}】")
        for it in sec["items"]:
            mark = _DONE if it["completed"] else _TODO
            lines.append(f"{mark}{it['text']}{_cat(it)}")
    return "\n".join(lines)


def _format_mutation(verb, r, asked, deps):
    """Build a complete/delete receipt: the action line + status overview.

    - completed/deleted a #今日 task → append today's list only
    - completed/deleted a pool task  → append today's list AND the pool overview
    """
    if r is None:
        return f"🔍 没找到匹配「{asked}」的任务，可换个说法或去扩展操作"
    lines = [f"{verb}：{r['display']}", "", format_today(deps.query_today())]
    if not r["was_today"]:
        lines += ["", format_pool_grouped(deps.query_pool_by_section())]
    return "\n".join(lines)


def handle_message(text, sender, message_id, *, deps):
    """Orchestrate one incoming Feishu message with intent routing.

    Flow: whitelist → dedup claim → read task list → LLM extract {intent,...} →
    route to add / query_today / query_pool / complete / delete. LLM total failure
    falls back to add-raw-text (spec §9, keeps claim). Other exceptions release claim.
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
            results = deps.write([{"text": text, "priority": None,
                                   "category": None, "today": False}])
            return format_receipt(results, frozenset()) + "\n（识别失败，已按原文记录，请稍后整理）"
        intent = result["intent"]
        if intent == "query_today":
            return format_today(deps.query_today())
        if intent == "query_pool":
            pf = result["pool_filter"]
            return format_pool_grouped(deps.query_pool_by_section(category=pf.get("category")))
        if intent == "complete":
            return _format_mutation("✅ 已完成", deps.complete(result["match_text"]),
                                    result["match_text"], deps)
        if intent == "delete":
            return _format_mutation("🗑 已删除", deps.delete(result["match_text"]),
                                    result["match_text"], deps)
        # default: add
        wanted_today = {t["text"] for t in result["tasks"] if t.get("today")}
        return format_receipt(deps.write(result["tasks"]), wanted_today)
    except Exception as exc:
        deps.dedup.release(message_id)
        return f"⚠️ 处理失败：{exc}"
