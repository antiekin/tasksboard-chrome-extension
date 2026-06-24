#!/bin/bash
# Runs the bot from the local (non-CloudStorage) deploy copy.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
cd "$HOME/.local/feishu-task-bot" || exit 1
exec ./venv/bin/python main.py
