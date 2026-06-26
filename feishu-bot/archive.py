"""Daily completion log + todo.md cleanup.

- append_completion: when a task is marked complete, append a timestamped line to
  today's log file 1_memory/tasks/YYYYMMDD_完成日志.md (created with a header if new).
- cleanup_completed_from_todo: remove all completed [x] tasks from todo.md (run by
  the 03:00 LaunchAgent). The history lives in the daily log, so todo.md stays clean.
"""
import datetime

import requests

import todo_parser
from config import OBSIDIAN_API_URL, load_keys
from todo_writer import read_todo, write_todo

LOG_DIR = "1_memory/tasks"


def _headers(content_type=None):
    keys = load_keys()
    h = {"Authorization": f"Bearer {keys['DIBRAIN_OBSIDIAN_REST_API_KEY']}"}
    if content_type:
        h["Content-Type"] = content_type
    return h


def _url(rel_path):
    enc = "/".join(requests.utils.quote(p, safe="") for p in rel_path.split("/"))
    return f"{OBSIDIAN_API_URL}/vault/{enc}"


def _get(rel_path):
    r = requests.get(_url(rel_path), headers={**_headers(), "Accept": "text/markdown"}, verify=False, timeout=15)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.text


def _put(rel_path, content):
    r = requests.put(_url(rel_path), headers=_headers("text/markdown"), data=content.encode("utf-8"), verify=False, timeout=15)
    r.raise_for_status()


def build_log_line(display, hm):
    return f"- {hm} {display}"


def append_completion(display, now=None, getter=_get, putter=_put):
    """Append a completion record to today's daily log; create with header if missing.

    Returns the vault-relative path of the log file written.
    """
    now = now or datetime.datetime.now()
    today = now.strftime("%Y%m%d")
    hm = now.strftime("%H:%M")
    rel = f"{LOG_DIR}/{today}_完成日志.md"
    line = build_log_line(display, hm)
    existing = getter(rel)
    if existing is None:
        readable = now.strftime("%Y-%m-%d")
        content = f"---\ndate: {readable}\ntype: completion-log\n---\n# {readable} 完成日志\n\n{line}\n"
    else:
        content = existing.rstrip("\n") + f"\n{line}\n"
    putter(rel, content)
    return rel


def cleanup_completed_from_todo(reader=read_todo, writer=write_todo):
    """Remove all completed [x] tasks from todo.md. Returns the count removed."""
    data = todo_parser.parse_todo(reader())
    removed = 0
    for sec in data["sections"]:
        before = len(sec["items"])
        sec["items"] = [it for it in sec["items"] if not it["completed"]]
        removed += before - len(sec["items"])
    if removed:
        writer(todo_parser.serialize_todo(data))
    return removed
