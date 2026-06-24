"""Parse / serialize Obsidian todo.md.

Ported from the extension's todo-sync.js, with one robustness fix: the wikilink
reference is searched anywhere in the task body (hand-written todo.md often has
"文本 ← [[引用]] #分类" with the reference BEFORE the category), not anchored to
end-of-line. Serialization follows toMarkdown's order (reference last), so a
read-modify-write normalizes reference position the same way the extension does.
"""
import re

_TASK = re.compile(r"^- \[([ x])\]\s+(?:\[([SABC])\]\s+)?(.+)$")
_REF = re.compile(r"\s+←\s+(\[\[.+?\]\])")  # search anywhere (ref may precede category)
_CAT = re.compile(r"^(.+?)\s+#(家庭|工作|健康|学习)$")


def parse_todo(markdown):
    if not markdown:
        return {"preamble": "", "sections": []}
    lines = markdown.split("\n")
    preamble_end = len(lines)
    for i, ln in enumerate(lines):
        if ln.startswith("## "):
            preamble_end = i
            break
    preamble = "\n".join(lines[:preamble_end])
    sections, current = [], None
    for ln in lines[preamble_end:]:
        if ln.startswith("## "):
            current = {"name": ln[3:].strip(), "comment": None, "items": []}
            sections.append(current)
            continue
        if current is None:
            continue
        s = ln.strip()
        if s.startswith("<!--") and s.endswith("-->"):
            current["comment"] = s
            continue
        if s == "":
            continue
        m = _TASK.match(s)
        if not m:
            continue
        checkbox, priority, raw = m.group(1), m.group(2), m.group(3)
        today = False
        work = raw
        if re.search(r"(^|\s)#今日(\s|$)", work):
            today = True
            work = re.sub(r"\s*#今日(?=\s|$)", "", work).strip()
        # reference may appear before OR after the category tag — search, don't anchor
        reference = None
        rm = _REF.search(work)
        if rm:
            reference = rm.group(1)
            work = (work[:rm.start()] + work[rm.end():]).strip()
        text = work.strip()
        category = None
        cm = _CAT.match(text)
        if cm:
            text, category = cm.group(1).strip(), cm.group(2)
        current["items"].append({
            "text": text, "priority": priority, "category": category,
            "today": today, "completed": checkbox == "x", "reference": reference,
        })
    return {"preamble": preamble, "sections": sections}


def serialize_todo(data):
    result = re.sub(r"\n*$", "\n", data.get("preamble", ""))
    for section in data["sections"]:
        result += f"## {section['name']}\n"
        if section.get("comment"):
            result += f"{section['comment']}\n"
        for item in section["items"]:
            check = "x" if item["completed"] else " "
            pri = f"[{item['priority']}] " if item.get("priority") else ""
            cat = f" #{item['category']}" if item.get("category") else ""
            today = " #今日" if item.get("today") else ""
            ref = f" ← {item['reference']}" if item.get("reference") else ""
            result += f"- [{check}] {pri}{item['text']}{cat}{today}{ref}\n"
        result += "\n"
    return result
