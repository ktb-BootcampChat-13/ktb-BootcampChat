import re
from io import BytesIO

import tools


def test_get_datetime_returns_local_date_weekday_and_time():
    result = tools.get_datetime()

    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \([월화수목금토일]\) \d{2}:\d{2}", result)


def test_run_tool_returns_error_for_unknown_tool():
    assert tools.run_tool("missing", {}) == "[오류] 알 수 없는 도구: missing"


def test_run_tool_returns_error_when_tool_raises(monkeypatch):
    def broken_tool():
        raise RuntimeError("고장")

    monkeypatch.setitem(tools.TOOL_FUNCTIONS, "broken", broken_tool)

    assert tools.run_tool("broken", {}) == "[오류] 도구 실행 실패: 고장"


def test_get_weather_returns_current_conditions(monkeypatch):
    payload = b"""{
        "current_condition": [{
            "temp_C": "24",
            "FeelsLikeC": "25",
            "humidity": "63",
            "weatherDesc": [{"value": "Partly cloudy"}]
        }]
    }"""
    requested_urls = []

    def fake_urlopen(url, timeout):
        requested_urls.append((url, timeout))
        return BytesIO(payload)

    monkeypatch.setattr(tools, "urlopen", fake_urlopen)

    result = tools.get_weather("서울")

    assert result == "서울: 24°C (체감 25°C), Partly cloudy, 습도 63%"
    assert "%EC%84%9C%EC%9A%B8" in requested_urls[0][0]
    assert requested_urls[0][1] == 10


def test_weather_tool_is_registered_for_model_selection():
    schema_names = [schema["function"]["name"] for schema in tools.TOOL_SCHEMAS]

    assert tools.TOOL_FUNCTIONS["get_weather"] is tools.get_weather
    assert "get_weather" in schema_names


def test_get_news_returns_requested_number_of_titles_without_long_links(monkeypatch):
    items = "".join(
        f"<item><title>기사 {number}</title><link>https://example.com/{number}</link></item>"
        for number in range(1, 7)
    )
    payload = f"<rss><channel>{items}</channel></rss>".encode()
    requested_urls = []

    def fake_urlopen(request, timeout):
        requested_urls.append((request.full_url, timeout))
        return BytesIO(payload)

    monkeypatch.setattr(tools, "urlopen", fake_urlopen)

    result = tools.get_news("인공지능", count=3)

    assert result == "- 기사 1\n- 기사 2\n- 기사 3"
    assert "https://" not in result
    assert "%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5" in requested_urls[0][0]
    assert requested_urls[0][1] == 10


def test_news_tool_is_registered_for_model_selection():
    schema_names = [schema["function"]["name"] for schema in tools.TOOL_SCHEMAS]
    news_schema = next(
        schema for schema in tools.TOOL_SCHEMAS if schema["function"]["name"] == "get_news"
    )

    assert tools.TOOL_FUNCTIONS["get_news"] is tools.get_news
    assert "get_news" in schema_names
    assert news_schema["function"]["parameters"]["properties"]["count"]["maximum"] == 5
