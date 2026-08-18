from __future__ import annotations

import datetime as dt
import json
import xml.etree.ElementTree as ET
from collections.abc import Callable
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen


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


def get_news(query: str = "", count: int = 5) -> str:
    """Google News RSS에서 최신 기사 제목을 요청한 개수만큼 반환한다."""
    if query:
        url = (
            f"https://news.google.com/rss/search?q={quote(query)}"
            "&hl=ko&gl=KR&ceid=KR:ko"
        )
    else:
        url = "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko"

    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=10) as response:
        root = ET.fromstring(response.read())

    count = max(1, min(count, 5))
    items = root.findall(".//item")[:count]
    if not items:
        return "[오류] 뉴스 결과가 없습니다."

    return "\n".join(
        f"- {(item.findtext('title') or '제목 없음').strip()}" for item in items
    )


TOOL_FUNCTIONS: dict[str, Callable[..., str]] = {
    "get_datetime": get_datetime,
    "get_weather": get_weather,
    "get_news": get_news,
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
    {
        "type": "function",
        "function": {
            "name": "get_news",
            "description": "최신 한국 주요 뉴스 또는 검색어와 관련된 최신 기사 제목을 조회한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "뉴스 검색어. 생략하면 한국 주요 뉴스를 조회한다.",
                    },
                    "count": {
                        "type": "integer",
                        "description": "가져올 기사 개수. 1부터 5까지 지정할 수 있다.",
                        "minimum": 1,
                        "maximum": 5,
                        "default": 5,
                    },
                },
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
