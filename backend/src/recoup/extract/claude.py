"""Claude-backed extraction, reply classification, and drafting.

Every call is a single structured-output request: no tools and no agent loop, so
the model can return data and nothing else. Server-side fallbacks retry a
declined request on Anthropic's recommended fallback model.
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Literal, TypeVar

from anthropic import Anthropic
from pydantic import BaseModel

from recoup.domain.sources import Email
from recoup.extract.prompts import (
    EXTRACTION_PROMPT_VERSION,
    EXTRACTION_SYSTEM,
    REPLY_PROMPT_VERSION,
    REPLY_SYSTEM,
)
from recoup.extract.schema import EmailExtraction, ReplyAssessment

logger = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"
Effort = Literal["low", "medium", "high", "xhigh", "max"]
T = TypeVar("T", bound=BaseModel)


class LlmError(RuntimeError):
    """The model returned nothing usable. Callers fall back or record a rejection."""


@dataclass
class Usage:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0

    def add(self, usage: Any) -> None:
        self.calls += 1
        self.input_tokens += int(getattr(usage, "input_tokens", 0) or 0)
        self.output_tokens += int(getattr(usage, "output_tokens", 0) or 0)


@dataclass
class ClaudeStructured:
    client: Anthropic
    model: str
    effort: Effort = "medium"
    max_tokens: int = 4_096
    usage: Usage = field(default_factory=Usage)

    def parse(self, system: str, user: str, schema: type[T]) -> T:
        response = self.client.beta.messages.parse(
            model=self.model,
            max_tokens=self.max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=schema,
            output_config={"effort": self.effort},
            betas=[FALLBACK_BETA],
            fallbacks="default",
        )
        self.usage.add(response.usage)
        if response.stop_reason in ("refusal", "max_tokens"):
            raise LlmError(f"model stopped with {response.stop_reason}")
        parsed = response.parsed_output
        if parsed is None:
            raise LlmError("model returned no structured output")
        return parsed


def render_email(email: Email) -> str:
    return (
        "<email>\n"
        f"From: {email.from_addr}\n"
        f"Date: {email.sent_at:%Y-%m-%d}\n"
        f"Subject: {email.subject}\n\n"
        f"{email.body}\n"
        "</email>"
    )


@dataclass
class ClaudeExtractor:
    llm: ClaudeStructured

    @property
    def name(self) -> str:
        return f"claude:{self.llm.model}:{EXTRACTION_PROMPT_VERSION}"

    def extract(self, email: Email) -> EmailExtraction:
        return self.llm.parse(EXTRACTION_SYSTEM, render_email(email), EmailExtraction)


@dataclass
class ClaudeReplyClassifier:
    llm: ClaudeStructured

    @property
    def name(self) -> str:
        return f"claude:{self.llm.model}:{REPLY_PROMPT_VERSION}"

    def classify(self, email: Email) -> ReplyAssessment:
        return self.llm.parse(REPLY_SYSTEM, render_email(email), ReplyAssessment)
