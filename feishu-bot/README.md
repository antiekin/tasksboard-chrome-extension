# Feishu Task Bot

手机飞书发文字 → LLM 提炼 → 写入 Obsidian `1_memory/todo.md` → Chrome 扩展读到。

## 部署
1. 完成 Task 0 人工前置（飞书 app、api-keys.json、open_id）
2. `bash feishu-bot/deploy/deploy.sh`
3. 给机器人发消息，`tail -f ~/.local/feishu-task-bot/bot.log` 看 open_id，填进 api-keys.json，再 `launchctl kickstart -k gui/$(id -u)/com.feishu-task-bot.runner`

## 运维
- 日志：`~/.local/feishu-task-bot/bot.log` / `bot.err.log`
- 改代码后：重跑 `deploy.sh`（双源部署，必须重新 cp）
- 改飞书权限后：后台发布新版本 + `launchctl kickstart -k` 重启（拿新 scope token）
- 诊断：`launchctl print gui/$(id -u)/com.feishu-task-bot.runner | grep -i state`
