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
