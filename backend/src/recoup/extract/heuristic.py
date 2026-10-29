"""Keyword rules: the offline baseline Claude is measured against.

They run with no network or API key, so tests, CI, and the demo always work. They
are deliberately ordinary. The eval table shows where they fall short.
"""

import re

from recoup.domain.sources import Email
from recoup.extract.schema import EmailExtraction, ExtractedPromise, ReplyAssessment

_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_AMOUNT = re.compile(r"\$\s?([\d,]+\.\d{2})")
_MONEY_BACK = re.compile(r"\b(refund(ed)?|credit(ed)?|reimburs\w*)\b", re.IGNORECASE)
_COMMITTED = re.compile(
    r"\b(issued|processed|refunded|has been|have been|will (be )?(post|appear|issued|applied))\b",
    re.IGNORECASE,
)
_NEGATION = re.compile(
    r"\b(can't|cannot|unable|non-refundable|not eligible|won't be able)\b", re.IGNORECASE
)
_CANCELLED = re.compile(
    r"\b(subscription|plan|account)\b.*\b(has been|was) cancel+ed\b", re.IGNORECASE
)
_DAYS = re.compile(r"within (\d+)(?:\s*-\s*(\d+))? (business )?days", re.IGNORECASE)
_REFERENCE = re.compile(r"\b(\d{3}-\d{7,10}|[A-Z]{2,5}-\d{4,8})\b")


def _days(text: str) -> int | None:
    match = _DAYS.search(text)
    if match is None:
        return None
    days = int(match.group(2) or match.group(1))
    return days * 7 // 5 + 1 if match.group(3) else days


def _reference(sentence: str, email: Email) -> str | None:
    match = _REFERENCE.search(sentence) or _REFERENCE.search(f"{email.subject} {email.body}")
    return match.group(1) if match else None


def _money_back(sentence: str, email: Email) -> ExtractedPromise | None:
    if not (_MONEY_BACK.search(sentence) and _COMMITTED.search(sentence)):
        return None
    if _NEGATION.search(sentence):
        return None
    amount = _AMOUNT.search(sentence)
    is_credit = "credit" in sentence.lower() and "refund" not in sentence.lower()
    return ExtractedPromise(
        kind="credit" if is_credit else "refund",
        amount=amount.group(1).replace(",", "") if amount else None,
        currency="USD" if amount else None,
        reference=_reference(sentence, email),
        expected_within_days=_days(sentence) or _days(email.body),
        effective_date=None,
        quote=sentence,
    )


class HeuristicExtractor:
    name = "heuristic/1"

    def extract(self, email: Email) -> EmailExtraction:
        promises: list[ExtractedPromise] = []
        for raw in _SENTENCE.split(email.body):
            sentence = raw.strip()
            if _CANCELLED.search(sentence):
                promises.append(
                    ExtractedPromise(
                        kind="cancellation",
                        amount=None,
                        currency=None,
                        reference=None,
                        expected_within_days=None,
                        effective_date=email.sent_at.date().isoformat(),
                        quote=sentence,
                    )
                )
            elif (promise := _money_back(sentence, email)) is not None:
                promises.append(promise)
        return EmailExtraction(promises=promises)


_AGREED = re.compile(r"\b(approved|we've (issued|refunded|credited)|will (refund|credit))\b", re.I)
_DECLINED = re.compile(r"\b(unable to|cannot|can't|not eligible|declin\w+)\b", re.IGNORECASE)
_NEEDS_INFO = re.compile(r"\b(could you|please (send|provide|attach)|we need)\b", re.IGNORECASE)


class HeuristicReplyClassifier:
    name = "heuristic-replies/1"

    def classify(self, email: Email) -> ReplyAssessment:
        for raw in _SENTENCE.split(email.body):
            sentence = raw.strip()
            for pattern, decision in (
                (_DECLINED, "declined"),
                (_NEEDS_INFO, "needs_info"),
                (_AGREED, "agreed"),
            ):
                if pattern.search(sentence):
                    amount = _AMOUNT.search(sentence)
                    return ReplyAssessment(
                        decision=decision,
                        amount=amount.group(1).replace(",", "") if amount else None,
                        quote=sentence,
                        summary=f"Vendor reply classified as {decision} by keyword rules.",
                    )
        return ReplyAssessment(decision="other", amount=None, quote=email.body[:200], summary="")
