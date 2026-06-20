"""Backend configuration via environment variables with sensible defaults."""

import os
from pathlib import Path
from pydantic_settings import BaseSettings


class BackendConfig(BaseSettings):
    """Web backend settings, overridable via VIMAX_WEB_* env vars."""

    host: str = "0.0.0.0"
    port: int = 8000
    vi_max_root: Path = Path(__file__).resolve().parent.parent.parent
    working_dir_root: str = ".working_dir"

    allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    model_config = {"env_prefix": "VIMAX_WEB_"}


backend_config = BackendConfig()

MOCK_MODE = os.environ.get("VIMAX_MOCK", "0") == "1"
