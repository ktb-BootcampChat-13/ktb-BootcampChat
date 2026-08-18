from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path

from agent import Agent
from history import save_history


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("1 이상의 정수를 입력하세요.")
    return number


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Ollama 기반 CLI 에이전트")
    subparsers = parser.add_subparsers(dest="command", required=True)
    chat_parser = subparsers.add_parser("chat", help="대화를 시작합니다.")
    chat_parser.add_argument("--model", default="qwen2.5", help="Ollama 모델 이름")
    chat_parser.add_argument(
        "--max-steps",
        type=positive_int,
        default=3,
        help="질문당 최대 모델/도구 반복 횟수 (기본값: 3)",
    )
    return parser


def run_chat(
    agent: Agent,
    input_fn: Callable[[str], str] = input,
    output_fn: Callable[[str], None] = print,
    history_path: str | Path = "history.json",
) -> int:
    try:
        while True:
            try:
                user_input = input_fn("You: ").strip()
            except (EOFError, KeyboardInterrupt, StopIteration):
                break

            if not user_input:
                continue
            if user_input.lower() in {"exit", "quit", "/exit"}:
                break

            try:
                output_fn(f"AI: {agent.ask(user_input)}")
            except Exception as error:
                output_fn(f"[오류] 요청 처리에 실패했습니다: {error}")
    finally:
        try:
            save_history(agent.messages, history_path)
        except Exception as error:
            output_fn(f"[오류] 대화 기록을 저장하지 못했습니다: {error}")

    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "chat":
        print(f"CLI Agent ({args.model}) - 종료: exit, quit, /exit 또는 Ctrl+C")
        return run_chat(Agent(model=args.model, max_steps=args.max_steps))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
