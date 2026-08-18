import re

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
