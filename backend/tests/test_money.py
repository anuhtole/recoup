import pytest

from recoup.domain.money import Money


@pytest.mark.parametrize(
    ("text", "currency", "expected"),
    [
        ("$1,234.50", "USD", 123_450),
        ("-12", "USD", -1_200),
        ("0.07", "USD", 7),
        ("€ 99.9", "EUR", 9_990),
        ("CA$5", "CAD", 500),
        ("1500", "JPY", 1_500),
    ],
)
def test_parse_is_exact(text: str, currency: str, expected: int) -> None:
    assert Money.parse(text, currency) == Money(expected, currency)


@pytest.mark.parametrize(
    ("text", "currency"),
    [("12.345", "USD"), ("15.5", "JPY"), ("abc", "USD"), ("NaN", "USD"), ("", "USD")],
)
def test_parse_rejects_imprecise_or_invalid(text: str, currency: str) -> None:
    with pytest.raises(ValueError):
        Money.parse(text, currency)


def test_rejects_non_integer_amounts() -> None:
    with pytest.raises(TypeError):
        Money(12.5, "USD")  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        Money(True, "USD")


def test_rejects_unsupported_currency() -> None:
    with pytest.raises(ValueError):
        Money(100, "XYZ")


def test_arithmetic_requires_same_currency() -> None:
    assert Money(500, "USD") + Money(250, "USD") == Money(750, "USD")
    assert Money(500, "USD") - Money(750, "USD") == Money(-250, "USD")
    with pytest.raises(ValueError):
        Money(500, "USD") + Money(500, "EUR")


@pytest.mark.parametrize(
    ("money", "expected"),
    [
        (Money(123_450, "USD"), "$1,234.50"),
        (Money(-1_200, "EUR"), "-€12.00"),
        (Money(1_500, "JPY"), "¥1,500"),
        (Money(7, "USD"), "$0.07"),
    ],
)
def test_format(money: Money, expected: str) -> None:
    assert money.format() == expected
