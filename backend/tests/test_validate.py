from datetime import date

from recoup.domain.sources import Email, Promise
from recoup.extract.schema import EmailExtraction, ExtractedPromise
from recoup.extract.validate import PromiseTiming, Rejection, validate_extraction
from tests.factories import directory, email, promised

QUOTE = "We've refunded $96.00 for the 4 unused seats on invoice NTN-202606."


def _validate(
    body: str, *items: ExtractedPromise, sender: str = "team@makenotion.com"
) -> tuple[Email, tuple[list[Promise], list[Rejection]]]:
    message = email(body, sender=sender)
    return message, validate_extraction(message, EmailExtraction(promises=list(items)), directory())


def test_grounded_promise_from_a_known_vendor_is_accepted() -> None:
    message, (promises, rejections) = _validate(
        f"Hi.\n\n{QUOTE}", promised(QUOTE, amount="96.00", reference="NTN-202606", days=10)
    )

    assert rejections == []
    [promise] = promises
    assert (promise.vendor_name, promise.amount_minor, promise.reference) == (
        "Notion",
        9_600,
        "NTN-202606",
    )
    assert (promise.due_by - message.sent_at.date()).days == 10 + PromiseTiming().grace_days


def test_unknown_sender_domain_is_rejected_whatever_the_model_says() -> None:
    _, (promises, rejections) = _validate(
        QUOTE, promised(QUOTE, amount="96.00"), sender="billing@notion-refunds.co"
    )

    assert promises == []
    assert [r.reason for r in rejections] == ["unverified_sender"]


def test_quote_that_is_not_in_the_email_is_rejected() -> None:
    _, (promises, rejections) = _validate(
        "Thanks for reaching out.", promised("We've refunded $9,800.00.", amount="9800.00")
    )

    assert promises == []
    assert [r.reason for r in rejections] == ["quote_not_in_email"]


def test_amount_must_appear_inside_the_quote() -> None:
    _, (promises, rejections) = _validate(QUOTE, promised(QUOTE, amount="960.00"))

    assert promises == []
    assert [r.reason for r in rejections] == ["amount_not_in_quote"]


def test_amount_with_thousands_separator_matches() -> None:
    quote = "We've refunded $1,250.00 to your card."
    _, (promises, _) = _validate(quote, promised(quote, amount="1250.00"))

    assert promises[0].amount_minor == 125_000


def test_reference_not_in_the_email_is_dropped() -> None:
    _, (promises, _) = _validate(QUOTE, promised(QUOTE, amount="96.00", reference="NTN-999999"))

    assert promises[0].reference is None


def test_whitespace_differences_do_not_break_grounding() -> None:
    body = "We've refunded $96.00 for the 4 unused\nseats on invoice NTN-202606."
    _, (promises, _) = _validate(body, promised(QUOTE, amount="96.00"))

    assert len(promises) == 1


def test_shared_domain_needs_the_exact_support_address() -> None:
    quote = "Your refund of $20.00 will be issued."
    _, (from_retail, _) = _validate(
        quote, promised(quote, amount="20.00"), sender="cs-reply@amazon.com"
    )
    _, (unknown, rejections) = _validate(
        quote, promised(quote, amount="20.00"), sender="deals@amazon.com"
    )

    assert from_retail[0].vendor_name == "Amazon"
    assert unknown == []
    assert rejections[0].reason == "unverified_sender"


def test_amount_must_be_a_whole_number_in_the_quote_not_a_substring() -> None:
    quote = "We've refunded $1,250.00 to your card."
    _, (promises, rejections) = _validate(quote, promised(quote, amount="250.00"))

    assert promises == []
    assert [r.reason for r in rejections] == ["amount_not_in_quote"]


def _cancellation(quote: str, effective: str) -> ExtractedPromise:
    return promised(quote, kind="cancellation").model_copy(update={"effective_date": effective})


def test_cancellation_date_the_email_does_not_state_falls_back_to_the_email_date() -> None:
    quote = "Your subscription has been cancelled."
    for invented in ("2099-01-01", "1999-01-01", "not a date"):
        message, (promises, _) = _validate(quote, _cancellation(quote, invented))

        assert promises[0].effective_on == message.sent_at.date()


def test_cancellation_date_written_in_the_email_is_used() -> None:
    quote = "Your subscription has been cancelled, effective June 30."
    _, (promises, _) = _validate(quote, _cancellation(quote, "2026-06-30"))

    assert promises[0].effective_on == date(2026, 6, 30)
