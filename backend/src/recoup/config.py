"""Runtime configuration, read from environment variables prefixed with RECOUP_."""

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


# The company Recoup works for, in one place: the app shows it and letters are signed with it.
DEFAULT_ORG = "Acme Inc."


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
    # Replays the demo's past claims (recovered and in flight) on `recoup run` and on a
    # demo scan. Off, so the scripted demo starts from a clean slate.
    demo_history: bool = False

    # Claude. Read server-side only; the browser never sees the key.
    anthropic_api_key: SecretStr | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")
    llm: Literal["auto", "on", "off"] = "auto"
    llm_model: str = "claude-opus-5-5"
    llm_effort: Literal["low", "medium", "high"] = "medium"

    org_name: str = DEFAULT_ORG

    # Where card dispute packets go when a vendor is not in the directory.
    card_dispute_address: str = "disputes@card-issuer.example"

    # Ramp Developer API. Client credentials stay server-side, like the Claude key.
    ramp_client_id: str | None = None
    ramp_client_secret: SecretStr | None = None
    ramp_env: Literal["sandbox", "production"] = "sandbox"
    ramp_lookback_days: int = 180

    # Gmail, read-only. `recoup connect gmail` fills in the refresh token.
    gmail_client_id: str | None = None
    gmail_client_secret: SecretStr | None = None
    gmail_refresh_token: SecretStr | None = None
    # Send approved requests from the connected mailbox. Off: sends stay in the local outbox.
    # Turning it on adds the gmail.send scope, so Gmail must be connected again.
    gmail_send: bool = False
    # Where connecting Gmail from the web app saves the refresh token.
    env_path: Path = Path(".env")
    gmail_lookback_days: int = 180
    gmail_max_messages: int = 500

    # Background sync inside `recoup serve`, in minutes. 0 turns it off.
    sync_interval_minutes: int = 0

    @property
    def data_mode(self) -> Literal["demo", "live"]:
        """Demo data ships its ledger as a file; live data only arrives by sync."""
        return "demo" if (self.data_dir / "transactions.json").exists() else "live"

    @property
    def ramp_configured(self) -> bool:
        return bool(self.ramp_client_id and self.ramp_client_secret)

    @property
    def gmail_configured(self) -> bool:
        return bool(self.gmail_client_id and self.gmail_client_secret and self.gmail_refresh_token)

    @property
    def gmail_send_configured(self) -> bool:
        return self.gmail_send and self.gmail_configured

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
