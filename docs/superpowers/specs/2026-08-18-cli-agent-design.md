# CLI Agent Design

## Goal

Build a small Python CLI agent that uses the local Ollama `qwen2.5` model, keeps conversation context during one run, invokes a calculator tool when needed, and saves the completed conversation to JSON on exit.

## Scope

The implementation lives entirely under `cli-agent/` and does not modify the existing frontend or backend applications.

The CLI supports this entry point:

```bash
python main.py chat --model qwen2.5 --max-steps 3
```

The `chat` command starts a standard-input loop. The user exits with `exit`, `quit`, EOF, or an interrupt. Conversation history is retained in memory while the process runs and written to `history.json` when it exits. A later process does not automatically restore the saved history.

## Components

### `main.py`

- Parses the `chat`, `--model`, and `--max-steps` arguments with the Python standard-library `argparse` module.
- Runs the standard-input and standard-output conversation loop.
- Handles normal exit, EOF, and keyboard interruption.
- Saves the in-memory message history before termination.

### `agent.py`

- Sends the current message history and calculator schema to Ollama.
- Detects tool-call responses from the model.
- Executes requested tools and appends tool results to the message history.
- Repeats model/tool processing up to `max_steps` times for each user request.
- Returns the final assistant response or a clear error when the step limit is exceeded.

### `tools.py`

- Exposes a calculator tool for arithmetic expressions.
- Supports numeric literals, parentheses, and addition, subtraction, multiplication, division, modulo, powers, and unary signs.
- Parses expressions with Python's `ast` module and explicitly rejects names, attributes, calls, indexing, and other executable syntax. It does not use unrestricted `eval()`.

### `history.py`

- Serializes the completed in-memory conversation to UTF-8 JSON.
- Produces a human-readable, indented `history.json` file.

## Data Flow

1. The CLI appends user input to the message history.
2. The agent sends that history and the calculator definition to Ollama.
3. If the model returns a normal assistant message, the CLI prints it.
4. If the model requests the calculator, the agent validates and executes the expression, appends the tool result, and calls the model again.
5. The loop stops when a final assistant message is returned or `max_steps` is reached.
6. On process exit, the CLI writes all messages to `history.json`.

## Error Handling

- An unavailable Ollama service or missing model produces a concise user-facing error without a Python traceback in normal CLI use.
- Invalid calculator expressions return an error as a tool result so the model can explain the problem.
- A non-positive `--max-steps` value is rejected by argument parsing.
- Reaching the tool-loop limit produces an explicit limit error rather than looping indefinitely.
- A history write failure is reported without hiding the original exit behavior.

## Verification

Automated tests cover calculator arithmetic, precedence, unary operators, division by zero, and rejection of executable or unsupported syntax. CLI parsing tests cover the default model, configurable step limit, and invalid limits. Agent tests use a fake Ollama client to verify both direct responses and calculator tool-call flow without requiring a live model.

A manual smoke test verifies that:

1. `python main.py chat --model qwen2.5 --max-steps 3` starts the prompt.
2. A normal question receives a direct answer.
3. A request such as `12 * (3 + 4)를 계산해줘` invokes the calculator and returns `84`.
4. Entering `exit` terminates the CLI and creates `history.json`.

## Non-goals

- Restoring history automatically on the next run.
- Calling external web APIs.
- Supporting tools other than the calculator.
- Adding a graphical or web interface.
- Modifying the existing chat application.
