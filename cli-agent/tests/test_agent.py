import agent as agent_module
from agent import Agent, SYSTEM_PROMPT


class FakeChatClient:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


def response(content="", tool_calls=None):
    return {
        "message": {
            "role": "assistant",
            "content": content,
            "tool_calls": tool_calls or [],
        }
    }


def datetime_call(arguments=None):
    return {
        "function": {
            "name": "get_datetime",
            "arguments": {} if arguments is None else arguments,
        }
    }


def test_returns_direct_answer_and_records_it():
    client = FakeChatClient([response("안녕하세요")])
    agent = Agent(chat_client=client)

    assert agent.ask("안녕") == "안녕하세요"
    assert agent.messages[-2:] == [
        {"role": "user", "content": "안녕"},
        {"role": "assistant", "content": "안녕하세요"},
    ]


def test_second_question_sends_previous_conversation():
    client = FakeChatClient([response("첫 답"), response("둘째 답")])
    agent = Agent(chat_client=client)

    agent.ask("첫 질문")
    agent.ask("내가 방금 뭐라고 했지?")

    second_messages = client.calls[1]["messages"]
    assert {"role": "user", "content": "첫 질문"} in second_messages
    assert {"role": "assistant", "content": "첫 답"} in second_messages


def test_executes_datetime_tool_and_returns_follow_up_answer():
    client = FakeChatClient(
        [response(tool_calls=[datetime_call()]), response("현재 시각을 확인했습니다.")]
    )
    agent = Agent(chat_client=client)

    assert agent.ask("지금 몇 시야?") == "현재 시각을 확인했습니다."
    assert client.calls[0]["tools"][0]["function"]["name"] == "get_datetime"
    assert any(message["role"] == "tool" for message in agent.messages)


def test_malformed_tool_arguments_become_error_result():
    client = FakeChatClient(
        [response(tool_calls=[datetime_call("not-json")]), response("인자를 해석하지 못했습니다.")]
    )
    agent = Agent(chat_client=client)

    agent.ask("시간 알려줘")

    tool_message = next(message for message in agent.messages if message["role"] == "tool")
    assert "[오류] 도구 인자" in tool_message["content"]


def test_model_failure_is_explained_and_recorded():
    client = FakeChatClient([RuntimeError("연결 거부")])
    agent = Agent(chat_client=client)

    answer = agent.ask("안녕")

    assert "모델 호출에 실패" in answer
    assert "연결 거부" in answer
    assert agent.messages[-1] == {"role": "assistant", "content": answer}


def test_forces_final_answer_when_tool_call_limit_is_reached():
    client = FakeChatClient(
        [
            response(tool_calls=[datetime_call()]),
            response(tool_calls=[datetime_call()]),
            response("수집한 결과로 답변합니다."),
        ]
    )
    agent = Agent(max_steps=2, chat_client=client)

    answer = agent.ask("시간 알려줘")

    assert answer == "수집한 결과로 답변합니다."
    assert len(client.calls) == 3
    assert "tools" not in client.calls[-1]


def test_system_prompt_forbids_inventing_news_links():
    assert "뉴스 도구 결과에 없는 링크나 사실을 만들지 마세요" in SYSTEM_PROMPT


def test_system_prompt_prioritizes_fresh_tool_results():
    assert "최신 정보는 기존 지식보다 도구 결과를 우선하세요" in SYSTEM_PROMPT
    assert "도구 결과와 모순되는 내용을 덧붙이지 마세요" in SYSTEM_PROMPT


def test_executes_registered_tool_from_text_fallback(monkeypatch):
    client = FakeChatClient(
        [
            response(
                'Escorts\n<tool_call>\n{"name":"get_news","arguments":{"count":3}}\n</tool_call>'
            ),
            response("뉴스 3개입니다."),
        ]
    )
    calls = []

    def fake_run_tool(name, arguments):
        calls.append((name, arguments))
        return "- 기사 1\n- 기사 2\n- 기사 3"

    monkeypatch.setattr(agent_module, "run_tool", fake_run_tool)
    agent = Agent(chat_client=client)

    assert agent.ask("뉴스 3개 알려줘") == "뉴스 3개입니다."
    assert calls == [("get_news", {"count": 3})]
    assert any(message["role"] == "tool" for message in agent.messages)
