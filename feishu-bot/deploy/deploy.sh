#!/bin/bash
# Deploy the bot to a local (non-CloudStorage) path and (re)load the LaunchAgent.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/.local/feishu-task-bot"
PLIST="$HOME/Library/LaunchAgents/com.feishu-task-bot.runner.plist"

mkdir -p "$DEST"
rsync -a --exclude venv --exclude '__pycache__' --exclude tests --exclude dedup.db \
  --exclude '*.log' "$SRC"/ "$DEST"/
cp "$SRC/deploy/wrapper.sh" "$DEST/wrapper.sh"
chmod +x "$DEST/wrapper.sh"

# venv with homebrew python (has SSL); created once, reused after
if [ ! -d "$DEST/venv" ]; then
  /usr/local/bin/python3.12 -m venv "$DEST/venv"
fi
"$DEST/venv/bin/pip" install -q -r "$DEST/requirements.txt"

sed "s#__HOME__#$HOME#g" "$SRC/deploy/com.feishu-task-bot.runner.plist" > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "deployed; tail -f $DEST/bot.log"
