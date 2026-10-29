from recoup.extract.heuristic import HeuristicExtractor, HeuristicReplyClassifier
from recoup.extract.schema import ExtractedPromise
from tests.factories import email


def _extract(body: str) -> list[ExtractedPromise]:
    return HeuristicExtractor().extract(email(body)).promises


def test_finds_a_stated_refund_with_amount_reference_and_days() -> None:
    [promise] = _extract(
        "Your order 112-1234567 was returned. A refund of $234.18 has been processed and should "
        "appear within 7 business days."
    )

    assert (promise.kind, promise.amount, promise.reference) == ("refund", "234.18", "112-1234567")
    assert promise.expected_within_days == 10


def test_ignores_refusals_and_offers() -> None:
    assert _extract("Unfortunately, we're unable to issue a refund for this fare.") == []
    assert _extract("Refer a team and you'll receive a $200 account credit.") == []


def test_finds_cancellations() -> None:
    [promise] = _extract("Your Loom Business subscription has been cancelled.")

    assert promise.kind == "cancellation"


def test_reply_classification() -> None:
    classify = HeuristicReplyClassifier().classify

    assert classify(email("We've issued a refund of $40.00.")).decision == "agreed"
    assert classify(email("We're unable to refund this charge.")).decision == "declined"
    assert classify(email("Could you please send the receipt?")).decision == "needs_info"
    assert classify(email("Thanks, we got your message.")).decision == "other"
