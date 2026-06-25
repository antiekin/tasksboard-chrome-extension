"""Entry point: wire real deps + start lark long-connection.

Run with: python main.py
Requires config keys: FEISHU_TASKBOT_APP_ID, FEISHU_TASKBOT_APP_SECRET,
                       FEISHU_TASKBOT_ALLOWED_OPENIDS (list of open_id strings)
"""
import json
import os
import types
import urllib3

import lark_oapi as lark
from lark_oapi.api.im.v1 import (
    P2ImMessageReceiveV1,
    CreateMessageRequest,
    CreateMessageRequestBody,
)

from config import load_keys
from dedup_store import DedupStore
from task_extractor import extract_message, summarize_tasks
from todo_writer import (
    write_tasks, complete_task, delete_task,
    query_today, query_pool_by_section, read_todo,
)
from feishu_listener import handle_message
import todo_parser
import archive

# Suppress InsecureRequestWarning from todo_writer's verify=False requests
urllib3.disable_warnings()

_keys = load_keys()
_APP_ID = _keys["FEISHU_TASKBOT_APP_ID"]
_APP_SECRET = _keys["FEISHU_TASKBOT_APP_SECRET"]
_ALLOWED = _keys.get("FEISHU_TASKBOT_ALLOWED_OPENIDS", [])

# Warn if whitelist is empty — all messages will be silently rejected
if not _ALLOWED:
    print(
        "[warn] FEISHU_TASKBOT_ALLOWED_OPENIDS empty — all messages will be rejected; "
        "send the bot a message to see your open_id in the log, then add it"
    )

# Build a standard Feishu API client for sending replies
_client = (
    lark.Client.builder()
    .app_id(_APP_ID)
    .app_secret(_APP_SECRET)
    .build()
)

# SQLite dedup store sits next to this file
_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dedup.db")
_dedup = DedupStore(_DB_PATH)


def _read_tasks():
    """Read todo.md and compress it into a compact task list for the LLM."""
    return summarize_tasks(todo_parser.parse_todo(read_todo()))


def _complete_with_log(match):
    r = complete_task(match)
    if r:
        try:
            archive.append_completion(r['display'])
        except Exception as exc:
            print(f'[archive] completion log failed: {exc}')
    return r


# Dependency namespace for handle_message (dependency injection)
_deps = types.SimpleNamespace(
    allowed_ids=_ALLOWED,
    dedup=_dedup,
    read_tasks=_read_tasks,
    extract=extract_message,
    write=write_tasks,
    complete=_complete_with_log,
    delete=delete_task,
    query_today=query_today,
    query_pool_by_section=query_pool_by_section,
)


def _send(open_id, text):
    """Send a text reply to a user via Feishu IM.

    Args:
        open_id: Recipient's Feishu open_id.
        text: Plain text message content.
    """
    req = (
        CreateMessageRequest.builder()
        .receive_id_type("open_id")
        .request_body(
            CreateMessageRequestBody.builder()
            .receive_id(open_id)
            .msg_type("text")
            .content(json.dumps({"text": text}))
            .build()
        )
        .build()
    )
    resp = _client.im.v1.message.create(req)
    if not resp.success():
        print(f"[send] failed code={resp.code} msg={resp.msg}")


def _on_message(data: P2ImMessageReceiveV1) -> None:
    """Handle an incoming Feishu IM message event.

    Extracts sender open_id, message_id, and text content, then delegates to
    handle_message for orchestration. Sends receipt back to sender if non-None.

    Wrapped in a top-level try/except so a single malformed or unexpected event
    never escapes and disrupts the long-connection loop.

    Args:
        data: Lark event object for im.message.receive_v1.
    """
    try:
        msg = data.event.message
        sender = data.event.sender.sender_id.open_id
        print(
            f"[recv] open_id={sender} "
            f"message_id={msg.message_id} "
            f"type={msg.message_type}"
        )
        if msg.message_type != "text":
            return
        text = json.loads(msg.content).get("text", "")
        receipt = handle_message(text, sender, msg.message_id, deps=_deps)
        if receipt:
            _send(sender, receipt)
    except Exception as exc:
        print(f"[error] _on_message failed: {exc}")


def main():
    """Wire up the Feishu WebSocket long-connection and start the event loop."""
    handler = (
        lark.EventDispatcherHandler.builder("", "")
        .register_p2_im_message_receive_v1(_on_message)
        .build()
    )
    ws = lark.ws.Client(
        _APP_ID,
        _APP_SECRET,
        event_handler=handler,
    )
    print("[bot] starting long connection ...")
    ws.start()


if __name__ == "__main__":
    main()
