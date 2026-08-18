from __future__ import annotations

import datetime as dt
import json
import xml.etree.ElementTree as ET
from collections.abc import Callable
from typing import Any
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from ddgs import DDGS


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


def get_news(query: str, count: int = 5) -> str:
    """Google News RSS에서 최신 기사 제목을 요청한 개수만큼 반환한다."""
    url = (
        f"https://news.google.com/rss/search?q={quote(query)}"
        "&hl=ko&gl=KR&ceid=KR:ko"
    )

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


def get_exchange_rate(base: str, target: str, amount: float = 1) -> str:
    """Frankfurter API로 통화 금액을 환산한다."""
    base = base.upper()
    target = target.upper()
    query = urlencode({"amount": amount, "from": base, "to": target})
    request = Request(
        f"https://api.frankfurter.app/latest?{query}",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urlopen(request, timeout=10) as response:
        data = json.load(response)
    converted = data["rates"][target]
    return (
        f"{amount:,.2f} {base} = {converted:,.2f} {target} "
        f"(기준일: {data['date']})"
    )


def web_search(query: str, count: int = 5) -> str:
    """웹에서 최신 정보를 검색해 제목과 요약문을 반환한다."""
    count = max(1, min(count, 5))
    results = list(DDGS().text(query, max_results=count))
    if not results:
        return "[오류] 웹 검색 결과가 없습니다."
    return "\n".join(
        f"- {(item.get('title') or '제목 없음').strip()}\n"
        f"  {(item.get('body') or '요약 없음').strip()}"
        for item in results
    )


TOOL_FUNCTIONS: dict[str, Callable[..., str]] = {
    "get_datetime": get_datetime,
    "get_weather": get_weather,
    "get_news": get_news,
    "get_exchange_rate": get_exchange_rate,
    "web_search": web_search,
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
                        "description": "사용자가 요청한 뉴스 주제. 예: 인공지능. 일반 주요 뉴스는 한국으로 지정한다.",
                    },
                    "count": {
                        "type": "integer",
                        "description": "가져올 기사 개수. 1부터 5까지 지정할 수 있다.",
                        "minimum": 1,
                        "maximum": 5,
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_exchange_rate",
            "description": "기준 통화 금액을 대상 통화로 환산하고 환율 기준일을 반환한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "base": {
                        "type": "string",
                        "description": "기준 통화의 3자리 코드. 예: USD, KRW, EUR",
                    },
                    "target": {
                        "type": "string",
                        "description": "대상 통화의 3자리 코드. 예: KRW, USD, JPY",
                    },
                    "amount": {
                        "type": "number",
                        "description": "환산할 기준 통화 금액. 생략하면 1",
                        "default": 1,
                    },
                },
                "required": ["base", "target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "모델이 모르는 최신 정보나 일반 웹 정보가 필요할 때 웹을 검색해 제목과 요약문을 반환한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "구체적인 웹 검색어. 예: 2026 F1 드라이버 순위",
                    }
                },
                "required": ["query"],
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
