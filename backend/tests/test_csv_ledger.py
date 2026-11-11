import pytest

from recoup.ingest.csv_ledger import (
    LedgerFileError,
    detect_columns,
    parse_ledger,
    source_name,
)

RAMP_EXPORT = b"""Transaction ID,Date,Merchant,Amount,Currency,Card Last 4,Memo
t1,2026-09-03,FIGMA INC,45.00,USD,4242,INV-1
t2,2026-09-04,FIGMA INC,45.00,USD,4242,INV-1
t3,2026-09-10,AWS,"1,204.50",USD,4242,
"""


def test_detects_common_headers() -> None:
    columns = detect_columns(["Posted Date", "Description", "Debit", "Credit", "Card No."])

    assert columns == {
        "date": "Posted Date",
        "merchant": "Description",
        "debit": "Debit",
        "credit": "Credit",
    }


def test_reads_a_card_export_with_ids() -> None:
    parsed = parse_ledger(RAMP_EXPORT, source="csv:ramp")

    assert [t.amount_minor for t in parsed.transactions] == [4_500, 4_500, 120_450]
    assert parsed.transactions[0].external_id == "t1"
    assert parsed.transactions[0].card_last4 == "4242"
    assert parsed.transactions[0].reference == "INV-1"
    assert (parsed.first_date, parsed.last_date) == ("2026-09-03", "2026-09-10")
    assert parsed.charges_minor == 129_450


def test_bank_export_with_negative_charges_is_flipped() -> None:
    data = (
        b"Date,Description,Amount\n"
        b"09/03/2026,FIGMA,-45.00\n09/04/2026,SLACK,-12.00\n09/05/2026,FIGMA REFUND,45.00\n"
    )

    parsed = parse_ledger(data)

    assert parsed.charge_sign == "negative"
    assert [t.amount_minor for t in parsed.transactions] == [4_500, 1_200, -4_500]


def test_debit_and_credit_columns_become_one_signed_amount() -> None:
    data = b"Post Date,Payee,Debit,Credit\n2026-09-03,FIGMA,45.00,\n2026-09-08,FIGMA,,45.00\n"

    parsed = parse_ledger(data)

    assert [t.amount_minor for t in parsed.transactions] == [4_500, -4_500]


def test_day_first_dates_are_detected() -> None:
    data = b"Date,Merchant,Amount\n03/09/2026,FIGMA,45\n25/09/2026,FIGMA,45\n"

    parsed = parse_ledger(data)

    assert [t.posted_at.date().isoformat() for t in parsed.transactions] == [
        "2026-09-03",
        "2026-09-25",
    ]


def test_parenthesized_amounts_are_negative() -> None:
    data = b"Date,Merchant,Amount\n2026-09-03,FIGMA,45.00\n2026-09-04,FIGMA,(45.00)\n"

    assert [t.amount_minor for t in parse_ledger(data).transactions] == [4_500, -4_500]


def test_identical_rows_stay_distinct_and_reuploads_are_stable() -> None:
    data = b"Date,Merchant,Amount\n2026-09-03,FIGMA,45.00\n2026-09-03,FIGMA,45.00\n"

    first = parse_ledger(data, source="csv:card")
    again = parse_ledger(data, source="csv:card")

    ids = [t.id for t in first.transactions]
    assert len(set(ids)) == 2
    assert ids == [t.id for t in again.transactions]


def test_unreadable_rows_are_reported_not_fatal() -> None:
    data = (
        b"Date,Merchant,Amount\n"
        b"soon,FIGMA,45\n2026-09-03,,45\n2026-09-03,FIGMA,abc\n2026-09-04,FIGMA,45\n"
    )

    parsed = parse_ledger(data)

    assert len(parsed.transactions) == 1
    assert [(p.line, p.reason) for p in parsed.problems] == [
        (2, "unreadable date"),
        (3, "no merchant"),
        (4, "no amount"),
    ]


def test_column_overrides_win() -> None:
    data = b"When,Who,How Much\n2026-09-03,FIGMA,45\n"

    parsed = parse_ledger(data, columns={"date": "When", "merchant": "Who", "amount": "How Much"})

    assert parsed.transactions[0].merchant == "FIGMA"


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"", "no header row"),
        (b"Date,Amount\n2026-09-03,45\n", "merchant"),
        (b"\xff\xfe\x00\x00" * 2_000_000, "over 5 MB"),
    ],
)
def test_files_that_are_not_ledgers_fail_clearly(data: bytes, message: str) -> None:
    with pytest.raises(LedgerFileError, match=message):
        parse_ledger(data)


def test_unknown_override_column_is_rejected() -> None:
    with pytest.raises(LedgerFileError, match="No column named"):
        parse_ledger(b"Date,Merchant,Amount\n", columns={"amount": "Total"})


def test_source_name_is_a_safe_slug() -> None:
    assert source_name("Amex Platinum (Ops)") == "csv:amex-platinum-ops"
    assert source_name("!!!") == "csv"


def _amounts(data: bytes, **kwargs: object) -> list[int]:
    return [t.amount_minor for t in parse_ledger(data, **kwargs).transactions]  # type: ignore[arg-type]


def test_sign_is_guessed_by_value_not_row_count() -> None:
    data = b"Date,Merchant,Amount\n2026-09-01,A,-5\n2026-09-02,B,-5\n2026-09-03,C,-7\n" + (
        b"2026-09-04,D,500\n2026-09-05,E,900\n"
    )
    parsed = parse_ledger(data)

    assert parsed.charge_sign == "positive" and parsed.is_sign_certain
    assert _amounts(data) == [-500, -500, -700, 50000, 90000]


def test_a_close_sign_call_is_flagged_for_a_person() -> None:
    parsed = parse_ledger(b"Date,Merchant,Amount\n2026-09-01,A,-50\n2026-09-02,B,60\n")

    assert not parsed.is_sign_certain
    assert parse_ledger(
        b"Date,Merchant,Amount\n2026-09-01,A,-50\n", charge_sign="positive"
    ).is_sign_certain


def test_reads_semicolons_and_european_decimals() -> None:
    data = "Date;Description;Amount\n03.09.2026;FIGMA;1.500,00\n04.09.2026;AWS;€12,30\n"

    parsed = parse_ledger(data.encode())

    assert [t.amount_minor for t in parsed.transactions] == [150000, 1230]


def test_every_way_of_writing_a_negative() -> None:
    data = "Date,Merchant,Amount\n2026-09-01,A,\N{MINUS SIGN}5.00\n2026-09-02,B,$(12.34)\n".encode()
    data += b"2026-09-03,C,7.00 CR\n2026-09-04,D,500.00\n"

    assert _amounts(data) == [-500, -1234, -700, 50000]


def test_day_first_is_decided_by_any_row_and_can_be_set() -> None:
    rows = "".join(f"0{d}/04/2026,A{d},1\n" for d in range(1, 10))
    late = "25/04/2026,Z,1\n"
    parsed = parse_ledger(f"Date,Merchant,Amount\n{rows}{late}".encode())

    assert parsed.date_order == "day_first" and parsed.is_date_order_certain
    assert parsed.transactions[0].posted_at.month == 4 and parsed.skipped == 0

    ambiguous = parse_ledger(b"Date,Merchant,Amount\n03/04/2026,A,1\n")
    assert not ambiguous.is_date_order_certain
    forced = parse_ledger(b"Date,Merchant,Amount\n03/04/2026,A,1\n", date_order="day_first")
    assert forced.transactions[0].posted_at.month == 4


def test_a_repeated_id_keeps_both_rows() -> None:
    data = b"ID,Date,Merchant,Amount\nX,2026-09-01,A,1\nX,2026-09-01,A,2\n"

    assert len({t.id for t in parse_ledger(data).transactions}) == 2


def test_a_detected_column_can_be_switched_off() -> None:
    data = b"Date,Merchant,Amount,Debit,Credit\n2026-09-01,A,99,5,\n"

    assert _amounts(data, columns={"amount": ""}) == [500]


def test_the_same_charge_on_two_cards_is_two_rows() -> None:
    data = b"Date,Merchant,Amount,Card\n2026-09-01,A,5,1111\n2026-09-01,A,5,2222\n"

    assert len({t.id for t in parse_ledger(data).transactions}) == 2
