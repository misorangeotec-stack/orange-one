"""Shared configuration for WAT tools.

Loads environment variables from the project-root `.env` file and exposes
helpers so every tool reads secrets the same way. Import this at the top of
any tool that needs credentials:

    from config import get_env, ROOT, TMP_DIR

Never hard-code secrets in a tool — put them in `.env` and read them here.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError as exc:  # pragma: no cover - helpful failure message
    raise ImportError(
        "python-dotenv is not installed. Run: pip install -r requirements.txt"
    ) from exc

# Project root = parent of the tools/ directory that holds this file.
ROOT = Path(__file__).resolve().parent.parent
TMP_DIR = ROOT / ".tmp"
WORKFLOWS_DIR = ROOT / "workflows"

# Load .env from the project root (no-op if the file is absent).
load_dotenv(ROOT / ".env")


def get_env(key: str, default: str | None = None, *, required: bool = False) -> str | None:
    """Return an environment variable.

    Set required=True to raise a clear error when the key is missing — better
    than a cryptic failure deep inside an API call.
    """
    value = os.environ.get(key, default)
    if required and not value:
        raise RuntimeError(
            f"Missing required environment variable '{key}'. "
            f"Add it to {ROOT / '.env'} (see .env.example)."
        )
    return value


def ensure_tmp() -> Path:
    """Ensure the .tmp/ scratch directory exists and return its path."""
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    return TMP_DIR
