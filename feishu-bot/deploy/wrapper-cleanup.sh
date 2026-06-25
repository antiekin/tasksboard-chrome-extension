#!/bin/bash
# Daily cleanup runner (removes completed tasks from todo.md).
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export PYTHONUNBUFFERED=1
cd "$HOME/.local/feishu-task-bot" || exit 1
exec ./venv/bin/python cleanup.py
