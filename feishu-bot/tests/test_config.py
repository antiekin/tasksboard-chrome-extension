import json
import config


def test_load_keys_reads_json(tmp_path, monkeypatch):
    fake = tmp_path / "api-keys.json"
    fake.write_text(json.dumps({"FEISHU_TASKBOT_APP_ID": "cli_x"}))
    monkeypatch.setattr(config, "API_KEYS_PATH", fake)
    assert config.load_keys()["FEISHU_TASKBOT_APP_ID"] == "cli_x"


def test_constants_present():
    assert config.MAX_TODAY == 3
    assert config.VALID_CATEGORIES == ["家庭", "工作", "健康", "学习"]
    assert config.DEFAULT_SECTION == "短期任务（7 天内完成）"
    # OpenRouter must be first channel
    assert config.LLM_CHANNELS[0]["name"] == "openrouter"
    assert config.LLM_CHANNELS[0]["model"] == "anthropic/claude-sonnet-4-6"
    assert config.LLM_CHANNELS[1]["name"] == "yunwu"
    assert config.VALID_PRIORITIES == ["S", "A", "B", "C"]
    assert config.OBSIDIAN_API_URL == "https://127.0.0.1:27124"
    assert config.TODO_FILE_PATH == "1_memory/todo.md"
