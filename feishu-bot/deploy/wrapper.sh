#!/bin/bash
# Runs the bot from the local (non-CloudStorage) deploy copy.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export PYTHONUNBUFFERED=1  # flush print() immediately so bot.log is readable
cd "$HOME/.local/feishu-task-bot" || exit 1
exec ./venv/bin/python main.py
