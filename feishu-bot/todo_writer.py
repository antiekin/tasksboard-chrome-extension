"""Write extracted tasks into Obsidian todo.md (read-modify-write whole file)."""
import re

import requests

from config import DEFAULT_SECTION, MAX_TODAY, OBSIDIAN_API_URL, TODO_FILE_PATH, load_keys
import todo_parser


def serialize_task_line(task, today_applied):
    """Serialize a task dict into a markdown task line.

    Format: - [ ] [priority] text #category #今日 (in that order, each optional).
    This MUST match the extension's todo-sync.js toMarkdown format exactly.
    """
    pri = f"[{task['priority']}] " if task.get("priority") else ""
    cat = f" #{task['category']}" if task.get("category") else ""
    today = " #今日" if today_applied else ""
    # NOTE: new tasks carry no reference/wikilink; that field is intentionally not serialized
    return f"- [ ] {pri}{task['text']}{cat}{today}"


def count_active_today(markdown):
    """Count incomplete tasks marked with #今日."""
    count = 0
    for line in markdown.split("\n"):
        s = line.strip()
        if s.startswith("- [ ]") and re.search(r"(^|\s)#今日(\s|$)", s):
            count += 1
    return count


def apply_today_cap(tasks, current_count):
    """Add today_applied bool to each task, respecting MAX_TODAY cap."""
    n = current_count
    out = []
    for t in tasks:
        applied = False
        if t.get("today") and n < MAX_TODAY:
            applied = True
            n += 1
        out.append({**t, "today_applied": applied})
    return out


def insert_task_lines(markdown, lines, section=DEFAULT_SECTION):
    """Insert markdown lines at the end of a section block.

    Raises:
        ValueError: if section not found
    """
    rows = markdown.split("\n")
    start = None
    for i, row in enumerate(rows):
        if row.strip() == f"## {section}":
            start = i
            break
    if start is None:
        raise ValueError(f"section not found: {section}")

    end = len(rows)
    for j in range(start + 1, len(rows)):
        if rows[j].startswith("## "):
            end = j
            break

    insert_at = end
    while insert_at - 1 > start and rows[insert_at - 1].strip() == "":
        insert_at -= 1

    return "\n".join(rows[:insert_at] + lines + rows[insert_at:])


def _headers(content_type=None):
    """Build Obsidian REST API headers with Authorization and optional Content-Type."""
    keys = load_keys()
    h = {"Authorization": f"Bearer {keys['DIBRAIN_OBSIDIAN_REST_API_KEY']}"}
    if content_type:
        h["Content-Type"] = content_type
    return h


def _vault_url():
    """Build full Obsidian vault URL for TODO_FILE_PATH (each component URL-encoded)."""
    encoded = "/".join(requests.utils.quote(p, safe="") for p in TODO_FILE_PATH.split("/"))
    return f"{OBSIDIAN_API_URL}/vault/{encoded}"


def read_todo():
    """Fetch todo.md from Obsidian via Local REST API."""
    r = requests.get(_vault_url(), headers={**_headers(), "Accept": "text/markdown"},
                     verify=False, timeout=15)
    r.raise_for_status()
    return r.text


def write_todo(content):
    """Write markdown content back to todo.md via Obsidian Local REST API."""
    r = requests.put(_vault_url(), headers=_headers("text/markdown"),
                     data=content.encode("utf-8"), verify=False, timeout=15)
    r.raise_for_status()


def write_tasks(tasks, reader=read_todo, writer=write_todo):
    """Read current md, cap #今日, serialize, insert, write back. Returns receipt list."""
    md = reader()
    capped = apply_today_cap(tasks, count_active_today(md))
    lines = [serialize_task_line(t, t["today_applied"]) for t in capped]
    writer(insert_task_lines(md, lines))
    return [{"text": t["text"], "today_applied": t["today_applied"]} for t in capped]


def complete_task(match_text, reader=read_todo, writer=write_todo):
    """Find the first incomplete task whose text == match_text, mark it done, write back.

    Returns:
        dict | None: {"display": "text #分类", "was_today": bool}, or None if no match
    """
    data = todo_parser.parse_todo(reader())
    target = None
    for sec in data["sections"]:
        for item in sec["items"]:
            if item["text"] == match_text and not item["completed"]:
                target = item
                break
        if target:
            break
    if target is None:
        return None
    target["completed"] = True
    writer(todo_parser.serialize_todo(data))
    cat = f" #{target['category']}" if target.get("category") else ""
    return {"display": f"{target['text']}{cat}", "was_today": bool(target.get("today"))}


def delete_task(match_text, reader=read_todo, writer=write_todo):
    """Find the first task with text == match_text (any completion state), remove it.

    Returns:
        dict | None: {"display": "text #分类", "was_today": bool}, or None if no match
    """
    data = todo_parser.parse_todo(reader())
    target, target_sec = None, None
    for sec in data["sections"]:
        for item in sec["items"]:
            if item["text"] == match_text:
                target, target_sec = item, sec
                break
        if target:
            break
    if target is None:
        return None
    target_sec["items"].remove(target)
    writer(todo_parser.serialize_todo(data))
    cat = f" #{target['category']}" if target.get("category") else ""
    return {"display": f"{target['text']}{cat}", "was_today": bool(target.get("today"))}


def query_today(reader=read_todo):
    """Collect all #今日 items across sections with completion state.

    Returns:
        dict: {"items": [{"text","category","completed"}], "total": int, "done": int}
    """
    data = todo_parser.parse_todo(reader())
    items = []
    for sec in data["sections"]:
        for it in sec["items"]:
            if it["today"]:
                items.append({"text": it["text"], "category": it["category"],
                              "completed": it["completed"]})
    done = sum(1 for i in items if i["completed"])
    return {"items": items, "total": len(items), "done": done}


def query_pool(category=None, section=None, reader=read_todo):
    """List incomplete pool items (flat), optionally filtered by category and/or section.

    Returns:
        list[dict]: [{"text","category","section"}] (both filters None = all incomplete)
    """
    data = todo_parser.parse_todo(reader())
    out = []
    for sec in data["sections"]:
        if section and sec["name"] != section:
            continue
        for it in sec["items"]:
            if it["completed"]:
                continue
            if category and it["category"] != category:
                continue
            out.append({"text": it["text"], "category": it["category"], "section": sec["name"]})
    return out


def query_pool_by_section(category=None, reader=read_todo):
    """Group all tasks by section for a full-overview display.

    Args:
        category: optional category filter (None = all)
        reader: overridable for testing

    Returns:
        list[dict]: [{"name": str, "items": [{"text","category","completed"}]}];
                    sections with no matching items are omitted.
    """
    data = todo_parser.parse_todo(reader())
    out = []
    for sec in data["sections"]:
        items = []
        for it in sec["items"]:
            if category and it["category"] != category:
                continue
            items.append({"text": it["text"], "category": it["category"],
                          "completed": it["completed"]})
        if items:
            out.append({"name": sec["name"], "items": items})
    return out
