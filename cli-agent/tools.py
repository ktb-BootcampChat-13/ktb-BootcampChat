from __future__ import annotations

import datetime as dt
import json
from collections.abc import Callable
from typing import Any
from urllib.parse import quote
from urllib.request import urlopen


def get_datetime() -> str:
    """현재 로컬 날짜, 요일, 시각을 반환한다."""
    now = dt.datetime.now()
    weekday = ["월", "화", "수", "목", "금", "토", "일"][now.weekday()]
    return now.strftime(f"%Y-%m-%d ({weekday}) %H:%M")


def get_weather(city: str) -> str:
    """도시의 현재 날씨를 wttr.in에서 조회한다."""
    url = f"https://wttr.in/{quote(city)}?format=j1"
    with urlopen(url, timeout=10) as response:
        data = json.load(response)
    current = data["current_condition"][0]
    description = current["weatherDesc"][0]["value"]
    return (
        f"{city}: {current['temp_C']}°C (체감 {current['FeelsLikeC']}°C), "
        f"{description}, 습도 {current['humidity']}%"
    )


TOOL_FUNCTIONS: dict[str, Callable[..., str]] = {
    "get_datetime": get_datetime,
    "get_weather": get_weather,
}

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_datetime",
            "description": "현재 날짜, 요일, 시각을 반환한다. 현재 날짜나 시간을 묻는 질문에 사용한다.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "지정한 도시의 현재 기온, 체감 온도, 날씨, 습도를 조회한다. 현재 날씨 질문에 사용한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "날씨를 조회할 도시 이름. 예: 서울, Busan, Tokyo",
                    }
                },
                "required": ["city"],
            },
        },
    },
]


def run_tool(name: str, arguments: dict[str, Any]) -> str:
    tool = TOOL_FUNCTIONS.get(name)
    if tool is None:
        return f"[오류] 알 수 없는 도구: {name}"

    try:
        return tool(**arguments)
    except Exception as error:  # 도구 실패를 모델이 설명할 수 있는 결과로 변환한다.
        return f"[오류] 도구 실행 실패: {error}"
