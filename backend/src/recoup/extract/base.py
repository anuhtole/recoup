"""Interfaces the pipeline depends on, so Claude and the offline baseline are swappable."""

from typing import Protocol

from recoup.domain.sources import Email
from recoup.extract.schema import EmailExtraction, ReplyAssessment


class PromiseExtractor(Protocol):
    @property
    def name(self) -> str:
        """Identifies the extractor and prompt version; results are cached per name."""
        ...

    def extract(self, email: Email) -> EmailExtraction: ...


class ReplyClassifier(Protocol):
    @property
    def name(self) -> str: ...

    def classify(self, email: Email) -> ReplyAssessment: ...
