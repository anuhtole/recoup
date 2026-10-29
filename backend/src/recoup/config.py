"""Runtime configuration, read from environment variables prefixed with RECOUP_."""

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="RECOUP_", extra="ignore")

    # SQLite keeps local setup to one command; CI also runs the suite against Postgres.
    database_url: str = "sqlite:///./recoup.db"
    data_dir: Path = REPO_ROOT / "data" / "synthetic"

    # Detector thresholds. These are deterministic hard stops, not model decisions.
    duplicate_window_days: int = 3
    min_recoverable_minor: int = 2_500
    dispute_window_days: int = 120
    promise_default_days: int = 14
    promise_grace_days: int = 3

    # "Today" for detection. Unset means the stored demo clock, or the real date.
    as_of: date | None = None
    # Enables the simulated vendor inbox (POST /api/demo/advance). Never on in production.
    demo_mode: bool = False

    # Claude. Read server-side only; the browser never sees the key.
    anthropic_api_key: SecretStr | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")
    llm: Literal["auto", "on", "off"] = "auto"
    llm_model: str = "claude-opus-5-5"
    llm_effort: Literal["low", "medium", "high"] = "medium"

    # Where card dispute packets go when a vendor is not in the directory.
    card_dispute_address: str = "disputes@card-issuer.example"

    @property
    def llm_enabled(self) -> bool:
        if self.llm == "off":
            return False
        if self.llm == "on" and self.anthropic_api_key is None:
            raise ValueError("RECOUP_LLM=on requires ANTHROPIC_API_KEY")
        return self.anthropic_api_key is not None


@lru_cache
def get_settings() -> Settings:
    return Settings()
