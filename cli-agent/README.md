# Ollama CLI Agent

로컬 Ollama의 `qwen2.5`와 대화하고, 현재 날짜나 시각이 필요할 때 모델이 스스로 `get_datetime` 도구를 선택하는 CLI 에이전트입니다.

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
You: exit
```

세 번째 질문에서 모델은 `get_datetime` 도구를 선택하고, Python이 반환한 현재 시각을 바탕으로 최종 답변을 만듭니다.

## 테스트

```bash
python -m pytest -v
```
