"""Read the inbox: extract promises from vendor email and apply replies to our requests.

Results are cached per (email, extractor version). If the model call fails, that
email falls back to the keyword baseline for this run only and is retried next run.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field

from anthropic import AnthropicError
from sqlalchemy import select
from sqlalchemy.orm import Session

from recoup.db.models import DraftRow, EmailRow, ExtractionRow, FindingRow
from recoup.domain.sources import Email, Promise, sender_domain
from recoup.domain.vendors import VendorDirectory
from recoup.extract.base import PromiseExtractor, ReplyClassifier
from recoup.extract.claude import LlmError
from recoup.extract.heuristic import HeuristicExtractor, HeuristicReplyClassifier
from recoup.extract.schema import EmailExtraction, ReplyAssessment
from recoup.extract.validate import PromiseTiming, validate_extraction
from recoup.ingest.sources import row_to_email
from recoup.recovery.workflow import SYSTEM_ACTOR, apply_reply, audit

logger = logging.getLogger(__name__)
_MODEL_ERRORS = (LlmError, AnthropicError)


@dataclass
class InboxResult:
    read: int = 0
    newly_extracted: int = 0
    errors: int = 0
    replies: int = 0
    promises: list[Promise] = field(default_factory=list)
    rejected: int = 0


def _cached(session: Session, email_id: str, name: str) -> ExtractionRow | None:
    return session.scalar(
        select(ExtractionRow).where(
            ExtractionRow.email_id == email_id, ExtractionRow.extractor == name
        )
    )


def _extract(
    session: Session, email: Email, extractor: PromiseExtractor, result: InboxResult
) -> tuple[EmailExtraction, bool]:
    cached = _cached(session, email.id, extractor.name)
    if cached is not None and cached.result is not None:
        return EmailExtraction.model_validate(cached.result), False
    try:
        extraction = extractor.extract(email)
    except _MODEL_ERRORS as exc:
        logger.warning("extraction failed for %s, using baseline: %s", email.id, exc)
        result.errors += 1
        return HeuristicExtractor().extract(email), False
    session.add(
        ExtractionRow(email_id=email.id, extractor=extractor.name, result=extraction.model_dump())
    )
    result.newly_extracted += 1
    return extraction, True


def read_promises(
    session: Session,
    emails: Sequence[Email],
    extractor: PromiseExtractor,
    vendors: VendorDirectory,
    timing: PromiseTiming,
    result: InboxResult,
) -> None:
    for email in emails:
        result.read += 1
        extraction, is_new = _extract(session, email, extractor, result)
        promises, rejections = validate_extraction(email, extraction, vendors, timing)
        result.promises.extend(promises)
        result.rejected += len(rejections)
        if is_new:
            for rejection in rejections:
                audit(
                    session,
                    SYSTEM_ACTOR,
                    "email.rejected",
                    None,
                    email_id=email.id,
                    reason=rejection.reason,
                    detail=rejection.detail,
                )


def _classify(
    email: Email, classifier: ReplyClassifier, result: InboxResult
) -> tuple[ReplyAssessment, str]:
    try:
        return classifier.classify(email), classifier.name
    except _MODEL_ERRORS as exc:
        logger.warning("reply classification failed for %s, using baseline: %s", email.id, exc)
        result.errors += 1
        fallback = HeuristicReplyClassifier()
        return fallback.classify(email), fallback.name


def apply_replies(
    session: Session,
    replies: Sequence[tuple[Email, DraftRow]],
    classifier: ReplyClassifier,
    result: InboxResult,
) -> None:
    for email, draft in replies:
        if _cached(session, email.id, classifier.name) is not None:
            continue
        assessment, used = _classify(email, classifier, result)
        # Cached under the requested classifier even after a fallback: a reply is applied once.
        session.add(
            ExtractionRow(
                email_id=email.id,
                extractor=classifier.name,
                result={**assessment.model_dump(), "classified_by": used},
            )
        )
        row = session.get(FindingRow, draft.finding_id)
        if row is not None:
            apply_reply(session, row, email, assessment, used)
            result.replies += 1


def is_from_recipient(email: Email, draft: DraftRow, vendors: VendorDirectory) -> bool:
    """A reply counts only from whoever we wrote to; In-Reply-To alone is forgeable.

    Anything else stays an ordinary email and goes through promise extraction.
    """
    if not draft.to_addr:
        return False
    if sender_domain(email.from_addr) == sender_domain(draft.to_addr):
        return True
    vendor = vendors.for_sender(draft.to_addr)
    return vendor is not None and vendor.sends_from(email.from_addr)


def read_inbox(
    session: Session,
    extractor: PromiseExtractor,
    classifier: ReplyClassifier,
    vendors: VendorDirectory,
    timing: PromiseTiming,
) -> InboxResult:
    sent = {
        d.message_id: d
        for d in session.scalars(select(DraftRow).where(DraftRow.message_id.is_not(None)))
        if d.message_id
    }
    rows = session.scalars(select(EmailRow).order_by(EmailRow.sent_at, EmailRow.id)).all()
    emails = [row_to_email(r) for r in rows]
    replies = [
        (e, sent[e.in_reply_to])
        for e in emails
        if e.in_reply_to in sent and is_from_recipient(e, sent[e.in_reply_to], vendors)
    ]
    reply_ids = {e.id for e, _ in replies}

    result = InboxResult()
    read_promises(
        session, [e for e in emails if e.id not in reply_ids], extractor, vendors, timing, result
    )
    apply_replies(session, replies, classifier, result)
    return result
