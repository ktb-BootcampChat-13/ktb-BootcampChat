from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import ollama

from tools import TOOL_FUNCTIONS, TOOL_SCHEMAS, run_tool


SYSTEM_PROMPT = (
    "당신은 친절한 한국어 CLI 비서입니다. "
    "현재 날짜나 시각이 필요하면 추측하지 말고 get_datetime 도구를 사용하세요. "
    "뉴스 도구 결과에 없는 링크나 사실을 만들지 마세요. "
    "도구가 실패하면 실패 이유를 사용자에게 설명하세요."
)


def _value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def _as_dict(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        return item
    if hasattr(item, "model_dump"):
        return item.model_dump(exclude_none=True)
    raise TypeError(f"지원하지 않는 모델 응답 형식: {type(item).__name__}")


def _parse_text_tool_call(content: str) -> tuple[str, dict[str, Any]] | None:
    start = content.find("{")
    end = content.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(content[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    name = parsed.get("name")
    arguments = parsed.get("arguments", {})
    if name not in TOOL_FUNCTIONS or not isinstance(arguments, dict):
        return None
    return name, arguments


class Agent:
    def __init__(
        self,
        model: str = "qwen2.5",
        max_steps: int = 3,
        chat_client: Callable[..., Any] = ollama.chat,
    ) -> None:
        if max_steps <= 0:
            raise ValueError("max_steps는 1 이상이어야 합니다.")
        self.model = model
        self.max_steps = max_steps
        self.chat_client = chat_client
        self.messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]

    def ask(self, user_input: str) -> str:
        self.messages.append({"role": "user", "content": user_input})

        for _ in range(self.max_steps):
            try:
                response = self.chat_client(
                    model=self.model,
                    messages=[dict(message) for message in self.messages],
                    tools=TOOL_SCHEMAS,
                )
                message = _value(response, "message")
                if message is None:
                    raise ValueError("응답에 message가 없습니다.")
            except Exception as error:
                return self._record_answer(f"[오류] 모델 호출에 실패했습니다: {error}")

            tool_calls = _value(message, "tool_calls", None) or []
            if not tool_calls:
                content = _value(message, "content", "") or ""
                text_tool_call = _parse_text_tool_call(content)
                if text_tool_call is None:
                    return self._record_answer(content)

                name, arguments = text_tool_call
                self.messages.append(
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {"function": {"name": name, "arguments": arguments}}
                        ],
                    }
                )
                self.messages.append(
                    {
                        "role": "tool",
                        "tool_name": name,
                        "content": run_tool(name, arguments),
                    }
                )
                continue

            self.messages.append(_as_dict(message))
            for call in tool_calls:
                function = _value(call, "function")
                name = _value(function, "name", "")
                arguments, argument_error = self._parse_arguments(
                    _value(function, "arguments", {})
                )
                result = argument_error or run_tool(name, arguments)
                self.messages.append(
                    {"role": "tool", "tool_name": name, "content": result}
                )

        return self._record_answer(
            f"[중단] 도구 호출 한계({self.max_steps}회)에 도달했습니다."
        )

    @staticmethod
    def _parse_arguments(raw_arguments: Any) -> tuple[dict[str, Any], str | None]:
        if isinstance(raw_arguments, dict):
            return raw_arguments, None
        try:
            parsed = json.loads(raw_arguments or "{}")
        except (json.JSONDecodeError, TypeError):
            return {}, "[오류] 도구 인자를 해석할 수 없습니다."
        if not isinstance(parsed, dict):
            return {}, "[오류] 도구 인자는 객체여야 합니다."
        return parsed, None

    def _record_answer(self, content: str) -> str:
        self.messages.append({"role": "assistant", "content": content})
        return content
