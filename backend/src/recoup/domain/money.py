"""Money as integer minor units. Floats never touch an amount.

Sign convention used everywhere in Recoup: a positive amount is money leaving the
company (a debit), a negative amount is money coming back (a credit or refund).
"""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

# ISO 4217 minor-unit exponents for the currencies Recoup supports today.
MINOR_UNIT_EXPONENTS: dict[str, int] = {"USD": 2, "EUR": 2, "GBP": 2, "CAD": 2, "JPY": 0}

_CURRENCY_SYMBOLS: dict[str, str] = {"USD": "$", "EUR": "€", "GBP": "£", "CAD": "CA$", "JPY": "¥"}


def _require_supported(currency: str) -> None:
    if currency not in MINOR_UNIT_EXPONENTS:
        raise ValueError(f"Unsupported currency: {currency!r}")


@dataclass(frozen=True, slots=True)
class Money:
    amount_minor: int
    currency: str

    def __post_init__(self) -> None:
        if isinstance(self.amount_minor, bool) or not isinstance(self.amount_minor, int):
            raise TypeError("amount_minor must be an int")
        _require_supported(self.currency)

    @classmethod
    def parse(cls, text: str, currency: str) -> "Money":
        """Parse a human-written amount like "$1,234.50" or "-12" exactly.

        Rejects more decimal places than the currency allows instead of rounding,
        because a silently rounded amount is a wrong amount.
        """
        _require_supported(currency)
        cleaned = text.strip().replace(",", "").replace(" ", "")
        for symbol in sorted(_CURRENCY_SYMBOLS.values(), key=len, reverse=True):
            cleaned = cleaned.replace(symbol, "")
        try:
            value = Decimal(cleaned)
        except InvalidOperation as exc:
            raise ValueError(f"Not a monetary amount: {text!r}") from exc
        if not value.is_finite():
            raise ValueError(f"Not a monetary amount: {text!r}")

        scaled = value.scaleb(MINOR_UNIT_EXPONENTS[currency])
        if scaled != scaled.to_integral_value():
            raise ValueError(f"{text!r} has more precision than {currency} allows")
        return cls(int(scaled), currency)

    def _same_currency(self, other: "Money") -> None:
        if self.currency != other.currency:
            raise ValueError(f"Currency mismatch: {self.currency} vs {other.currency}")

    def __add__(self, other: "Money") -> "Money":
        self._same_currency(other)
        return Money(self.amount_minor + other.amount_minor, self.currency)

    def __sub__(self, other: "Money") -> "Money":
        self._same_currency(other)
        return Money(self.amount_minor - other.amount_minor, self.currency)

    def __neg__(self) -> "Money":
        return Money(-self.amount_minor, self.currency)

    def __abs__(self) -> "Money":
        return Money(abs(self.amount_minor), self.currency)

    def format(self) -> str:
        """Render for people, e.g. "$1,234.50" or "-€12.00"."""
        exponent = MINOR_UNIT_EXPONENTS[self.currency]
        major = Decimal(abs(self.amount_minor)).scaleb(-exponent)
        sign = "-" if self.amount_minor < 0 else ""
        return f"{sign}{_CURRENCY_SYMBOLS[self.currency]}{major:,.{exponent}f}"
