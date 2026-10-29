from collections import Counter

from recoup.synth.generate import DEFAULT_SEED, generate, generate_world


def test_generation_is_deterministic() -> None:
    assert generate(DEFAULT_SEED) == generate(DEFAULT_SEED)


def test_different_seeds_change_background_spend() -> None:
    first, _ = generate(DEFAULT_SEED)
    second, _ = generate(DEFAULT_SEED + 1)

    assert first != second


def test_labels_reference_real_transactions() -> None:
    transactions, labels = generate()
    ids = {t.id for t in transactions}

    assert len(ids) == len(transactions)
    for case in labels["cases"]:
        assert set(case["transaction_ids"]) <= ids, case["case_id"]


def test_answer_key_shape() -> None:
    _, labels = generate()
    counts = Counter((case["leak_type"], case["kind"]) for case in labels["cases"])

    assert counts == {
        ("duplicate_charge", "positive"): 12,
        ("duplicate_charge", "hard_negative"): 13,
        ("missing_refund", "positive"): 5,
        ("missing_refund", "hard_negative"): 4,
        ("charged_after_cancellation", "positive"): 1,
        ("charged_after_cancellation", "hard_negative"): 1,
        ("sla_credit", "positive"): 3,
        ("sla_credit", "hard_negative"): 2,
    }
    case_ids = [case["case_id"] for case in labels["cases"]]
    assert len(case_ids) == len(set(case_ids))


def test_email_labels_quote_the_email_verbatim() -> None:
    world = generate_world()
    bodies = {email.id: email.body for email in world.emails}

    assert set(world.labels["emails"]) == set(bodies)
    for email_id, label in world.labels["emails"].items():
        for promise in label["promises"]:
            assert promise["quote"] in bodies[email_id], label["case_id"]


def test_case_sources_reference_real_emails_and_incidents() -> None:
    world = generate_world()
    known = {e.id for e in world.emails} | {i.id for i in world.incidents}

    for case in world.labels["cases"]:
        assert set(case["source_refs"]) <= known, case["case_id"]
