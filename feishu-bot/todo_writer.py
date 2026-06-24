"""Write extracted tasks into Obsidian todo.md (read-modify-write whole file)."""
import re

from config import DEFAULT_SECTION, MAX_TODAY


def serialize_task_line(task, today_applied):
    """Serialize a task dict into a markdown task line.

    Format: - [ ] [priority] text #category #今日 (in that order, each optional).
    This MUST match the extension's todo-sync.js toMarkdown format exactly.

    Args:
        task: dict with "text", "priority" (optional), "category" (optional)
        today_applied: bool — whether to append #今日

    Returns:
        str: markdown task line, e.g. "- [ ] [A] 写方案 #工作 #今日"
    """
    pri = f"[{task['priority']}] " if task.get("priority") else ""
    cat = f" #{task['category']}" if task.get("category") else ""
    today = " #今日" if today_applied else ""
    return f"- [ ] {pri}{task['text']}{cat}{today}"


def count_active_today(markdown):
    """Count incomplete tasks marked with #今日.

    Args:
        markdown: str, full markdown content

    Returns:
        int: count of "- [ ]" lines containing #今日
    """
    count = 0
    for line in markdown.split("\n"):
        s = line.strip()
        if s.startswith("- [ ]") and re.search(r"(^|\s)#今日(\s|$)", s):
            count += 1
    return count


def apply_today_cap(tasks, current_count):
    """Add today_applied bool to each task, respecting MAX_TODAY cap.

    Only sets today_applied=True if task.today is True AND we haven't exceeded
    MAX_TODAY (counting current_count from existing tasks).

    Args:
        tasks: list[dict], each with "text", "today" (optional), etc.
        current_count: int, current number of active #今日 tasks in the file

    Returns:
        list[dict]: tasks with added "today_applied" bool
    """
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

    Finds the section header (## {section}) and inserts lines before the next
    ## or EOF, skipping trailing blank lines within the section.

    Args:
        markdown: str, full markdown content
        lines: list[str], markdown lines to insert (e.g. ["- [ ] new"])
        section: str, section name to find (default from config)

    Returns:
        str: updated markdown

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

    # find end of this section (next '## ' or EOF)
    end = len(rows)
    for j in range(start + 1, len(rows)):
        if rows[j].startswith("## "):
            end = j
            break

    # back up over trailing blank lines inside the section
    insert_at = end
    while insert_at - 1 > start and rows[insert_at - 1].strip() == "":
        insert_at -= 1

    return "\n".join(rows[:insert_at] + lines + rows[insert_at:])
