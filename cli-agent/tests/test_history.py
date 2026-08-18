import json

from history import save_history


def test_save_history_writes_utf8_json(tmp_path):
    messages = [
        {"role": "user", "content": "안녕"},
        {"role": "assistant", "content": "반가워요"},
    ]
    target = tmp_path / "history.json"

    save_history(messages, target)

    assert json.loads(target.read_text(encoding="utf-8")) == messages
    assert "안녕" in target.read_text(encoding="utf-8")
