# Ollama CLI Agent

로컬 Ollama의 `qwen2.5`와 대화하고, 질문에 따라 모델이 스스로 `get_datetime`, `get_weather`, `get_news`, `get_exchange_rate` 도구를 선택하는 CLI 에이전트입니다.

## 설치

Ollama가 실행 중이고 모델이 준비됐는지 먼저 확인합니다.

```bash
ollama list
ollama run qwen2.5
```

`ollama run` 대화는 `/bye`로 종료한 뒤 Python 환경을 준비합니다.

```bash
cd cli-agent
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## 실행

```bash
python main.py chat --model qwen2.5 --max-steps 3
```

종료하려면 `exit`, `quit`, `/exit`, 또는 `Ctrl+C`를 사용합니다. 대화는 실행 중 메모리에 누적되며 종료할 때 `history.json`에 저장됩니다.

다른 Ollama 모델을 사용할 때는 모델 이름만 바꿉니다.

```bash
python main.py chat --model qwen2.5:7b
```

## 데모 질문

```text
You: 파이썬 리스트와 튜플의 차이가 뭐야?
You: 내가 방금 무엇을 물었지?
You: 지금 몇 시야?
You: 서울 날씨 알려줘
You: 인공지능 최신 뉴스 알려줘
You: 100달러는 원화로 얼마야?
You: exit
```

세 번째 질문에서는 `get_datetime`, 네 번째 질문에서는 `get_weather`, 다섯 번째 질문에서는 `get_news`, 여섯 번째 질문에서는 `get_exchange_rate` 도구를 선택합니다. 날씨는 `wttr.in`, 뉴스는 Google News RSS, 환율은 Frankfurter API를 사용하며 API 키 없이 동작합니다. 환율은 실시간 매매 환율이 아니라 API가 제공하는 기준일 환율입니다. 외부 조회에는 인터넷 연결이 필요하고, 실패하면 에이전트가 종료되지 않고 오류 원인을 답변합니다.

## 테스트

```bash
python -m pytest -v
```
