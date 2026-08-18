import json

import pytest

from main import build_parser, run_chat


class FakeAgent:
    def __init__(self):
        self.questions = []
        self.messages = [{"role": "system", "content": "test"}]

    def ask(self, question):
        self.questions.append(question)
        answer = f"답변: {question}"
        self.messages.extend(
            [
                {"role": "user", "content": question},
                {"role": "assistant", "content": answer},
            ]
        )
        return answer


def test_chat_parser_uses_defaults():
    args = build_parser().parse_args(["chat"])

    assert args.command == "chat"
    assert args.model == "qwen2.5"
    assert args.max_steps == 3


def test_chat_parser_accepts_custom_model_and_steps():
    args = build_parser().parse_args(
        ["chat", "--model", "qwen2.5:7b", "--max-steps", "5"]
    )

    assert args.model == "qwen2.5:7b"
    assert args.max_steps == 5


def test_chat_parser_rejects_non_positive_steps():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["chat", "--max-steps", "0"])


def test_run_chat_handles_multiple_questions_and_saves_history(tmp_path):
    agent = FakeAgent()
    inputs = iter(["첫 질문", "둘째 질문", "exit"])
    outputs = []
    target = tmp_path / "history.json"

    exit_code = run_chat(
        agent,
        input_fn=lambda _prompt: next(inputs),
        output_fn=outputs.append,
        history_path=target,
    )

    assert exit_code == 0
    assert agent.questions == ["첫 질문", "둘째 질문"]
    assert outputs == ["AI: 답변: 첫 질문", "AI: 답변: 둘째 질문"]
    assert json.loads(target.read_text(encoding="utf-8")) == agent.messages
