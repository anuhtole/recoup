"""Exports as real banks and finance tools write them."""

from recoup.ingest.csv_ledger import LedgerParse, parse_ledger


def _rows(parsed: LedgerParse) -> list[tuple[str, str, int]]:
    return [
        (t.posted_at.date().isoformat(), t.merchant, t.amount_minor) for t in parsed.transactions
    ]


def test_chase_card_writes_charges_negative_and_lists_bill_payments() -> None:
    parsed = parse_ledger(
        b"Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n"
        b"09/03/2026,09/04/2026,FIGMA,Software,Sale,-45.00,\n"
        b"09/05/2026,09/06/2026,FIGMA,Software,Return,45.00,\n"
        b"09/10/2026,09/11/2026,AMAZON WEB SERVICES,Software,Sale,-1204.50,\n"
        b"09/15/2026,09/15/2026,Payment Thank You-Mobile,,Payment,1249.50,\n"
    )

    assert parsed.charge_sign == "negative" and parsed.is_sign_certain
    assert [a for _, _, a in _rows(parsed)] == [4500, -4500, 120450]
    assert parsed.problems[0].reason.startswith("card bill payment")


def test_amex_with_a_bom_and_thousands_separators() -> None:
    parsed = parse_ledger(
        "﻿Date,Description,Card Member,Account #,Amount\n"
        '09/03/2026,FIGMA,JANE DOE,-41004,45.00\n09/10/2026,AWS,JANE DOE,-41004,"1,204.50"\n'
        "09/12/2026,ONLINE PAYMENT - THANK YOU,JANE DOE,-41004,-1249.50\n".encode()
    )

    assert parsed.charge_sign == "positive" and parsed.is_sign_certain
    assert _rows(parsed) == [("2026-09-03", "FIGMA", 4500), ("2026-09-10", "AWS", 120450)]


def test_bank_account_with_a_balance_column_treats_money_out_as_charges() -> None:
    parsed = parse_ledger(
        b"Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n"
        b"DEBIT,09/03/2026,GUSTO PAYROLL,-12000.00,ACH_DEBIT,50000.00,\n"
        b"CREDIT,09/04/2026,STRIPE TRANSFER,30000.00,ACH_CREDIT,80000.00,\n"
        b"DEBIT,09/10/2026,FIGMA,-45.00,DEBIT_CARD,79955.00,\n"
    )

    assert parsed.columns["merchant"] == "Description"
    assert [a for _, _, a in _rows(parsed)] == [1200000, -3000000, 4500]


def test_quickbooks_report_with_a_title_and_total_row() -> None:
    parsed = parse_ledger(
        b"Transaction Report\nAcme Corp\n\n"
        b"Date,Transaction Type,Num,Name,Memo/Description,Account,Split,Amount\n"
        b"09/03/2026,Expense,101,Figma,Org plan,Software,Amex,45.00\n"
        b'09/10/2026,Expense,102,AWS,,Software,Amex,"1,204.50"\n'
        b'Total,,,,,,,"1,249.50"\n'
    )

    assert _rows(parsed) == [("2026-09-03", "Figma", 4500), ("2026-09-10", "AWS", 120450)]
    assert [(p.line, p.reason) for p in parsed.problems] == [(7, "summary row")]


def test_german_bank_export_in_windows_1252() -> None:
    parsed = parse_ledger(
        "Buchungstag;Empfänger;Betrag;Währung\n"
        "03.09.2026;FIGMA;-45,00;EUR\n10.09.2026;HETZNER;-1.204,50;EUR\n".encode("cp1252"),
        default_currency="EUR",
    )

    assert parsed.charge_sign == "negative"
    assert _rows(parsed) == [("2026-09-03", "FIGMA", 4500), ("2026-09-10", "HETZNER", 120450)]
    assert parsed.transactions[0].currency == "EUR"


def test_brex_timestamps_and_masked_cards() -> None:
    parsed = parse_ledger(
        b"Posted At,Description,Amount,Currency,Card\n"
        b"2026-09-03T14:22:00Z,FIGMA,45.00,USD,**** 4242\n"
        b"2026-09-03T14:23:00Z,FIGMA,45.00,USD,**** 4242\n"
    )

    assert [t.card_last4 for t in parsed.transactions] == ["4242", "4242"]
    assert len({t.id for t in parsed.transactions}) == 2
