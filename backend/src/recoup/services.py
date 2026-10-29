"""Pick implementations once: Claude when a key is configured, keyword rules otherwise."""

from dataclasses import dataclass

from anthropic import Anthropic

from recoup.config import Settings
from recoup.extract.base import PromiseExtractor, ReplyClassifier
from recoup.extract.claude import ClaudeExtractor, ClaudeReplyClassifier, ClaudeStructured
from recoup.extract.heuristic import HeuristicExtractor, HeuristicReplyClassifier
from recoup.recovery.drafting import ClaudeDrafter, Drafter, TemplateDrafter
from recoup.recovery.outbox import LocalOutbox, Outbox


@dataclass(frozen=True)
class Services:
    extractor: PromiseExtractor
    classifier: ReplyClassifier
    drafter: Drafter
    outbox: Outbox
    llm: ClaudeStructured | None = None

    @property
    def mode(self) -> str:
        return f"claude:{self.llm.model}" if self.llm else "offline"


def offline_services() -> Services:
    return Services(
        extractor=HeuristicExtractor(),
        classifier=HeuristicReplyClassifier(),
        drafter=TemplateDrafter(),
        outbox=LocalOutbox(),
    )


def build_services(settings: Settings) -> Services:
    if not settings.llm_enabled or settings.anthropic_api_key is None:
        return offline_services()
    client = Anthropic(api_key=settings.anthropic_api_key.get_secret_value(), max_retries=3)
    llm = ClaudeStructured(client=client, model=settings.llm_model, effort=settings.llm_effort)
    return Services(
        extractor=ClaudeExtractor(llm),
        classifier=ClaudeReplyClassifier(llm),
        drafter=ClaudeDrafter(llm, TemplateDrafter()),
        outbox=LocalOutbox(),
        llm=llm,
    )
