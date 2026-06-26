"""Orchestration for an incoming Feishu message (v3.1: routing + status overview + 激励).

Deps namespace expected by handle_message:
  .allowed_ids, .dedup, .read_tasks, .extract, .write, .complete, .delete,
  .query_today() -> {items,total,done}, .query_pool_by_section(category) -> [{name,items}]
"""
from task_extractor import AllChannelsFailed

_DONE = "✅ "
_TODO = "　 "


def format_receipt(results, wanted_today=frozenset()):
    lines = [f"✅ 已记录 {len(results)} 条："]
    for r in results:
        lines.append(f"• {r['text']}")
    downgraded = [r["text"] for r in results if r["text"] in wanted_today and not r["today_applied"]]
    if downgraded:
        lines.append(f"⚠️ 今日必做已满 3，{'、'.join(downgraded)} 先入池，完成一个再设今日")
    return "\n".join(lines)


def _cat(it):
    return f" #{it['category']}" if it.get("category") else ""


def format_today(q):
    lines = [f"📋 今日必做 {q['done']}/{q['total']}"]
    for it in q["items"]:
        mark = _DONE if it["completed"] else _TODO
        lines.append(f"{mark}{it['text']}{_cat(it)}")
    if q["total"] == 0:
        lines.append("（今天还没设必做，发一句话记一件吧）")
    return "\n".join(lines)


def format_pool_grouped(sections):
    if not sections:
        return "📂 任务池：没有匹配的任务"
    blocks = []
    for sec in sections:
        lines = [f"【{sec['name']}】"]
        for it in sec["items"]:
            mark = _DONE if it["completed"] else _TODO
            lines.append(f"{mark}{it['text']}{_cat(it)}")
        blocks.append("\n".join(lines))
    return "📂 任务池\n\n" + "\n\n".join(blocks)


def _format_complete(r, asked, deps):
    if r is None:
        return f"🔍 没找到匹配「{asked}」的任务，可换个说法或去扩展操作"
    today = deps.query_today()
    remaining = today["total"] - today["done"]
    if r["was_today"]:
        if remaining == 0 and today["total"] > 0:
            head = f"✅✅✅ 今日必做全部完成！「{r['display']}」漂亮收官，给自己鼓个掌！🎉"
        else:
            head = f"💪 完成今日必做：「{r['display']}」！还剩 {remaining} 件，保持节奏继续冲！"
        return f"{head}\n\n{format_today(today)}"
    head = f"⭐ 额外搞定一件：「{r['display']}」，赞！"
    if remaining > 0:
        head += f"\n❗ 今日还有 {remaining} 件必做没完成，先把要紧的拿下～"
    return "\n".join([head, "", format_today(today), "", format_pool_grouped(deps.query_pool_by_section())])


def _format_delete(r, asked, deps):
    if r is None:
        return f"🔍 没找到匹配「{asked}」的任务，可换个说法或去扩展操作"
    lines = [f"🗑 已删除：{r['display']}", "", format_today(deps.query_today())]
    if not r["was_today"]:
        lines += ["", format_pool_grouped(deps.query_pool_by_section())]
    return "\n".join(lines)


def handle_message(text, sender, message_id, *, deps):
    if sender not in deps.allowed_ids:
        return None
    if not deps.dedup.claim(message_id):
        return None
    try:
        task_list = deps.read_tasks()
        try:
            result = deps.extract(text, task_list)
        except AllChannelsFailed:
            results = deps.write([{"text": text, "priority": None, "category": None, "today": False}])
            return format_receipt(results, frozenset()) + "\n（识别失败，已按原文记录，请稍后整理）"
        intent = result["intent"]
        if intent == "query_today":
            return format_today(deps.query_today())
        if intent == "query_pool":
            pf = result["pool_filter"]
            return format_pool_grouped(deps.query_pool_by_section(category=pf.get("category")))
        if intent == "complete":
            return _format_complete(deps.complete(result["match_text"]), result["match_text"], deps)
        if intent == "delete":
            return _format_delete(deps.delete(result["match_text"]), result["match_text"], deps)
        # add — then append the relevant status overview
        wanted_today = {t["text"] for t in result["tasks"] if t.get("today")}
        results = deps.write(result["tasks"])
        receipt = format_receipt(results, wanted_today)
        if any(r["today_applied"] for r in results):
            return receipt + "\n\n" + format_today(deps.query_today())
        return receipt + "\n\n" + format_pool_grouped(deps.query_pool_by_section())
    except Exception as exc:
        deps.dedup.release(message_id)
        return f"⚠️ 处理失败：{exc}"
