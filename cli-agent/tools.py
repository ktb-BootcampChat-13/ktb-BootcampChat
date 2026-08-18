from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from typing import Any


def get_datetime() -> str:
    """현재 로컬 날짜, 요일, 시각을 반환한다."""
    now = dt.datetime.now()
    weekday = ["월", "화", "수", "목", "금", "토", "일"][now.weekday()]
    return now.strftime(f"%Y-%m-%d ({weekday}) %H:%M")


TOOL_FUNCTIONS: dict[str, Callable[..., str]] = {
    "get_datetime": get_datetime,
}

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_datetime",
            "description": "현재 날짜, 요일, 시각을 반환한다. 현재 날짜나 시간을 묻는 질문에 사용한다.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
]


def run_tool(name: str, arguments: dict[str, Any]) -> str:
    tool = TOOL_FUNCTIONS.get(name)
    if tool is None:
        return f"[오류] 알 수 없는 도구: {name}"

    try:
        return tool(**arguments)
    except Exception as error:  # 도구 실패를 모델이 설명할 수 있는 결과로 변환한다.
        return f"[오류] 도구 실행 실패: {error}"
