"""Read any card or bank export as a ledger.

Every finance tool can export a CSV, so this is the one path that works for every
company. Columns are matched by common header names and can be overridden; a person
sees a preview before anything is stored.

Recoup's convention is that a charge is positive and a refund is negative. Bank
exports often use the opposite sign, or separate debit and credit columns; both are
detected and can be set by hand.

Keys are stable across uploads: an id column is used when there is one, otherwise a
hash of the row plus how many identical rows came before it. Re-uploading the same
export, or an overlapping one, adds nothing twice, and two genuinely identical charges
(the duplicates Recoup exists to find) stay two rows.
"""

import csv
import hashlib
import io
import re
import unicodedata
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Literal

from recoup.domain.money import MINOR_UNIT_EXPONENTS
from recoup.domain.types import Transaction, transaction_key

Column = Literal[
    "date", "merchant", "amount", "debit", "credit", "currency", "reference", "id", "card"
]
ChargeSign = Literal["positive", "negative"]
DateOrder = Literal["month_first", "day_first"]
DecimalMark = Literal[".", ","]

MAX_CSV_BYTES = 5_000_000
MAX_ROWS = 50_000
MAX_REPORTED_PROBLEMS = 20
# Below this ratio of charge to refund value, the sign is a guess a person should check.
SIGN_CONFIDENCE_RATIO = 3
SOURCE_PREFIX = "csv"
# Column widths in the transactions table.
MAX_MERCHANT_CHARS = 255
MAX_REFERENCE_CHARS = 128

# Header names seen in Ramp, Brex, Amex, Chase, Mercury, QuickBooks and Xero exports.
_SYNONYMS: dict[Column, tuple[str, ...]] = {
    "date": (
        "date",
        "posted",
        "posted at",
        "posted date",
        "post date",
        "transaction date",
        "trans date",
        "settlement date",
        "clear date",
        "cleared date",
        "posting date",
        "booking date",
        "date posted",
        "user transaction time",
        # German, Spanish, French bank exports.
        "buchungstag",
        "buchungsdatum",
        "fecha",
        "fecha operacion",
        "date operation",
        "created",
        "created at",
    ),
    "merchant": (
        "merchant",
        "merchant name",
        "description",
        "payee",
        "vendor",
        "name",
        "counterparty",
        "details",
        "transaction description",
        "empfanger",
        "auftraggeber empfanger",
        "beschreibung",
        "concepto",
        "beneficiario",
        "libelle",
    ),
    "amount": (
        "amount",
        "transaction amount",
        "total",
        "value",
        "net amount",
        "amount usd",
        "betrag",
        "importe",
        "montant",
    ),
    "debit": ("debit", "debits", "withdrawal", "withdrawals", "charge", "money out", "outflow"),
    "credit": ("credit", "credits", "deposit", "deposits", "refund", "money in", "inflow"),
    "currency": ("currency", "currency code", "original currency", "wahrung", "moneda", "devise"),
    "reference": ("reference", "ref", "invoice", "invoice number", "receipt", "order id", "memo"),
    "id": ("id", "transaction id", "external id", "reference number"),
    "card": ("card", "card last 4", "card last4", "last 4", "card number", "card ending"),
}
_ISO_FORMATS = ("%Y-%m-%d", "%Y/%m/%d")
_MONTH_FIRST = ("%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y")
_DAY_FIRST = ("%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d.%m.%Y")
_NON_KEY = re.compile(r"[^a-z0-9]+")
_NOT_NUMBER = re.compile(r"[^0-9.\-]")
# The decimal mark is the last . or , with only one or two digits after it: "1.234,56".
_DECIMAL_TAIL = re.compile(r"([.,])\d{1,2}\s*(?:CR|DR)?\)?\s*$", re.IGNORECASE)
_DELIMITERS = ",;\t|"
_DATE_PARTS = re.compile(r"[/.\-]")
_DIGITS = re.compile(r"\d")
_MONTHS_IN_YEAR = 12
# Reports (QuickBooks, Xero) put a title and dates above the header row.
MAX_PREAMBLE_LINES = 15
# Paying the card bill is not a vendor charge or refund, and its size would swamp the sign guess.
_CARD_PAYMENT = re.compile(
    r"\b(payment\s*-?\s*thank\s*you|autopay|online payment|mobile payment|payment received)\b",
    re.IGNORECASE,
)
_SUMMARY_ROW = re.compile(r"^\s*(total|subtotal|opening balance|closing balance)\b", re.IGNORECASE)


class LedgerFileError(ValueError):
    """A file Recoup cannot read as a ledger. The message is safe to show."""


def _header_key(name: str) -> str:
    # "Empfänger" and "Fecha operación" match their unaccented spellings.
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return _NON_KEY.sub(" ", plain.lower()).strip()


def detect_columns(headers: Sequence[str]) -> dict[Column, str]:
    """Best guess at which header holds each field, by common names."""
    keyed = {_header_key(h): h for h in headers if h.strip()}
    found: dict[Column, str] = {}
    used: set[str] = set()
    for column, names in _SYNONYMS.items():
        match = next((keyed[n] for n in names if n in keyed and keyed[n] not in used), None)
        if match is not None:
            found[column] = match
            used.add(match)
    return found


@dataclass(frozen=True, slots=True)
class RowProblem:
    line: int
    reason: str


@dataclass(frozen=True, slots=True)
class LedgerParse:
    headers: tuple[str, ...]
    columns: dict[Column, str]
    charge_sign: ChargeSign
    # False when the sign or date order was guessed from weak evidence.
    is_sign_certain: bool
    date_order: DateOrder
    is_date_order_certain: bool
    transactions: tuple[Transaction, ...]
    problems: tuple[RowProblem, ...]
    skipped: int

    @property
    def first_date(self) -> str | None:
        return min((t.posted_at.date().isoformat() for t in self.transactions), default=None)

    @property
    def last_date(self) -> str | None:
        return max((t.posted_at.date().isoformat() for t in self.transactions), default=None)

    @property
    def charges_minor(self) -> int:
        return sum(t.amount_minor for t in self.transactions if t.amount_minor > 0)


def _decode(data: bytes) -> str:
    if len(data) > MAX_CSV_BYTES:
        raise LedgerFileError(f"That file is over {MAX_CSV_BYTES // 1_000_000} MB.")
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise LedgerFileError("That file is not readable text. Export the ledger as CSV.")


def _decimal_mark(samples: Sequence[str]) -> DecimalMark:
    """ "." unless the file writes decimals with a comma, as most of Europe does."""
    votes = Counter(m.group(1) for m in map(_DECIMAL_TAIL.search, samples) if m)
    return "," if votes[","] > votes["."] else "."


def _parse_amount(raw: str, mark: DecimalMark = ".") -> Decimal | None:
    text = raw.strip().replace("\u2212", "-")
    if not text:
        return None
    upper = text.upper().rstrip()
    # Accounting exports write negatives as (12.34) or $(12.34); statements as 12.34 CR.
    is_negative = ("(" in text and text.endswith(")")) or upper.endswith("CR")
    if mark == ",":
        text = text.replace(".", "").replace(",", ".")
    cleaned = _NOT_NUMBER.sub("", text.replace(",", ""))
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    return -abs(value) if is_negative else value


def _to_minor(value: Decimal, currency: str) -> int | None:
    scaled = value.scaleb(MINOR_UNIT_EXPONENTS[currency])
    return int(scaled) if scaled == scaled.to_integral_value() else None


def _date_order(samples: Sequence[str]) -> tuple[DateOrder, bool]:
    """US month-first unless a date can only be day-first, and whether any date decided it."""
    for sample in samples:
        parts = _DATE_PARTS.split(sample.strip())
        if len(parts) != 3 or not all(p.isdigit() for p in parts[:2]) or len(parts[0]) > 2:
            continue
        # 03.09.2026 is how day-first countries write dates; no US export uses dots.
        if "." in sample:
            return "day_first", True
        if int(parts[0]) > _MONTHS_IN_YEAR:
            return "day_first", True
        if int(parts[1]) > _MONTHS_IN_YEAR:
            return "month_first", True
    has_short_dates = any(
        len(parts := _DATE_PARTS.split(s.strip())) == 3 and len(parts[0]) <= 2 for s in samples
    )
    return "month_first", not has_short_dates


def _date_formats(order: DateOrder) -> tuple[str, ...]:
    return (*_ISO_FORMATS, *(_DAY_FIRST if order == "day_first" else _MONTH_FIRST))


def _parse_date(raw: str, formats: Sequence[str]) -> datetime | None:
    text = raw.strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        pass
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def _cell(row: dict[str, str | None], columns: dict[Column, str], column: Column) -> str:
    header = columns.get(column)
    return (row.get(header) or "").strip() if header else ""


def _signed_amount(
    row: dict[str, str | None], columns: dict[Column, str], mark: DecimalMark
) -> Decimal | None:
    if "amount" in columns:
        return _parse_amount(_cell(row, columns, "amount"), mark)
    debit = _parse_amount(_cell(row, columns, "debit"), mark)
    credit = _parse_amount(_cell(row, columns, "credit"), mark)
    if debit is None and credit is None:
        return None
    # Debit/credit exports hold positive numbers in both columns; a debit is a charge.
    return abs(debit or Decimal(0)) - abs(credit or Decimal(0))


def _guess_charge_sign(
    rows: Sequence[dict[str, str | None]], columns: dict[Column, str], mark: DecimalMark
) -> tuple[ChargeSign, bool]:
    if "amount" not in columns:
        return "positive", True
    totals = {True: Decimal(0), False: Decimal(0)}
    for row in rows:
        if _CARD_PAYMENT.search(_cell(row, columns, "merchant")):
            continue
        amount = _parse_amount(_cell(row, columns, "amount"), mark)
        if amount:
            totals[amount > 0] += abs(amount)
    # Money spent outweighs money refunded, so the heavier sign is the charge sign.
    heavier, lighter = sorted(totals.values(), reverse=True)
    sign: ChargeSign = "negative" if totals[False] > totals[True] else "positive"
    return sign, heavier >= lighter * SIGN_CONFIDENCE_RATIO


def _check_required(columns: dict[Column, str]) -> None:
    missing = [c for c in ("date", "merchant") if c not in columns]
    if "amount" not in columns and not ({"debit", "credit"} & columns.keys()):
        missing.append("amount")
    if missing:
        raise LedgerFileError(f"Could not find a column for: {', '.join(missing)}.")


_Parsed = tuple[datetime, str, int, str, str | None, str | None]


def _parse_row(
    row: dict[str, str | None],
    columns: dict[Column, str],
    sign: ChargeSign,
    formats: Sequence[str],
    mark: DecimalMark,
    default_currency: str,
) -> _Parsed | str:
    """The row's fields, or why it was skipped."""
    if any(_SUMMARY_ROW.match(v or "") for v in list(row.values())[:2] if isinstance(v, str)):
        return "summary row"
    posted_at = _parse_date(_cell(row, columns, "date"), formats)
    if posted_at is None:
        return "unreadable date"
    merchant = " ".join(_cell(row, columns, "merchant").split())[:MAX_MERCHANT_CHARS]
    if not merchant:
        return "no merchant"
    if _CARD_PAYMENT.search(merchant):
        return "card bill payment, not a vendor charge"
    amount = _signed_amount(row, columns, mark)
    if not amount:
        return "no amount"
    if sign == "negative" and "amount" in columns:
        amount = -amount
    currency = _cell(row, columns, "currency").upper() or default_currency
    if currency not in MINOR_UNIT_EXPONENTS:
        return f"unsupported currency {currency}"
    amount_minor = _to_minor(amount, currency)
    if amount_minor is None:
        return "amount has too many decimals"
    digits = "".join(_DIGITS.findall(_cell(row, columns, "card")))
    card = digits[-4:] if len(digits) >= 4 else None
    return (
        posted_at,
        merchant,
        amount_minor,
        currency,
        _cell(row, columns, "reference")[:MAX_REFERENCE_CHARS] or None,
        card,
    )


def _external_id(fields: _Parsed, given: str, seen: Counter[str]) -> str:
    if given:
        # An id column that repeats (a shared order number) must not merge distinct rows.
        given = given[: MAX_REFERENCE_CHARS - 8]
        seen[f"id:{given}"] += 1
        count = seen[f"id:{given}"]
        return given if count == 1 else f"{given}#{count}"
    posted_at, merchant, amount_minor, currency, reference, card = fields
    parts = (posted_at.isoformat(), merchant, amount_minor, currency, reference or "", card or "")
    fingerprint = "|".join(str(part) for part in parts)
    seen[fingerprint] += 1
    digest = hashlib.sha256(f"{fingerprint}|{seen[fingerprint]}".encode()).hexdigest()
    return f"row_{digest[:20]}"


def parse_ledger(
    data: bytes,
    *,
    source: str = SOURCE_PREFIX,
    columns: dict[Column, str] | None = None,
    charge_sign: ChargeSign | None = None,
    date_order: DateOrder | None = None,
    default_currency: str = "USD",
) -> LedgerParse:
    """Every readable row as a `Transaction`, plus why the rest were skipped."""
    if default_currency not in MINOR_UNIT_EXPONENTS:
        raise LedgerFileError(f"{default_currency} is not a supported currency.")
    text = _decode(data)
    header_index, delimiter = _find_header(text)
    lines = text.splitlines()[header_index:]
    reader = csv.DictReader(io.StringIO("\n".join(lines)), delimiter=delimiter)
    headers = tuple(reader.fieldnames or ())
    if not headers:
        raise LedgerFileError("That file has no header row.")
    rows: list[dict[str, str | None]] = list(reader)
    if len(rows) > MAX_ROWS:
        raise LedgerFileError(f"That file has over {MAX_ROWS:,} rows. Split it by date.")
    # An empty header in `columns` means "not in this file", overriding detection.
    merged = {**detect_columns(headers), **(columns or {})}
    mapping: dict[Column, str] = {c: h for c, h in merged.items() if h}
    unknown = [h for h in mapping.values() if h not in headers]
    if unknown:
        raise LedgerFileError(f"No column named {unknown[0]!r} in that file.")
    _check_required(mapping)
    amount_cells = [_cell(r, mapping, c) for r in rows for c in ("amount", "debit", "credit")]
    mark = _decimal_mark(amount_cells)
    guessed_sign, is_sign_certain = _guess_charge_sign(rows, mapping, mark)
    if "amount" in mapping and _has_balance(headers):
        # A bank account with a running balance: money out is always the negative side.
        guessed_sign, is_sign_certain = "negative", True
    sign = charge_sign or guessed_sign
    guessed_order, is_order_certain = _date_order([_cell(r, mapping, "date") for r in rows])
    order = date_order or guessed_order
    formats = _date_formats(order)

    transactions: list[Transaction] = []
    problems: list[RowProblem] = []
    seen: Counter[str] = Counter()
    for line, row in enumerate(rows, start=header_index + 2):
        parsed = _parse_row(row, mapping, sign, formats, mark, default_currency)
        if isinstance(parsed, str):
            problems.append(RowProblem(line, parsed))
            continue
        external = _external_id(parsed, _cell(row, mapping, "id"), seen)
        posted_at, merchant, amount_minor, currency, reference, card = parsed
        transactions.append(
            Transaction(
                id=transaction_key(source, external),
                source=source,
                external_id=external,
                posted_at=posted_at,
                merchant=merchant,
                amount_minor=amount_minor,
                currency=currency,
                reference=reference,
                card_last4=card,
            )
        )
    return LedgerParse(
        headers=headers,
        columns=mapping,
        charge_sign=sign,
        is_sign_certain=charge_sign is not None or is_sign_certain,
        date_order=order,
        is_date_order_certain=date_order is not None or is_order_certain,
        transactions=tuple(transactions),
        problems=tuple(problems[:MAX_REPORTED_PROBLEMS]),
        skipped=len(problems),
    )


def _delimiter(line: str) -> str:
    try:
        return csv.Sniffer().sniff(line, delimiters=_DELIMITERS).delimiter
    except csv.Error:
        return ","


def _find_header(text: str) -> tuple[int, str]:
    """The line holding the column names, and the file's delimiter."""
    best = (0, 0, ",")
    for index, line in enumerate(text.splitlines()[:MAX_PREAMBLE_LINES]):
        delimiter = _delimiter(line)
        cells = next(csv.reader([line], delimiter=delimiter), [])
        hits = len(detect_columns(cells))
        if hits > best[0]:
            best = (hits, index, delimiter)
    return best[1], best[2]


def _has_balance(headers: Sequence[str]) -> bool:
    return any(_header_key(h) in ("balance", "running balance", "saldo", "solde") for h in headers)


def source_name(label: str) -> str:
    """`csv:<label>`, so two accounts' exports never share keys."""
    slug = _NON_KEY.sub("-", label.lower()).strip("-")[:40]
    return f"{SOURCE_PREFIX}:{slug}" if slug else SOURCE_PREFIX
