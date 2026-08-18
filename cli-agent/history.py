from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def save_history(
    messages: list[dict[str, Any]], path: str | Path = "history.json"
) -> None:
    Path(path).write_text(
        json.dumps(messages, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
