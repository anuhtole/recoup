import pytest

from recoup.domain.merchants import display_merchant, normalize_merchant


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("SQ *JOES CATERING", "JOES CATERING"),
        ("Joe's Catering LLC", "JOES CATERING"),
        ("FIGMA INC", "FIGMA"),
        ("Figma", "FIGMA"),
        ("WeWork Inc", "WEWORK"),
        ("ZOOM.US", "ZOOM US"),
        ("AMZN Mktp US", "AMZN MKTP US"),
        ("TST* NOPALITO 123", "NOPALITO"),
    ],
)
def test_normalize_merchant(raw: str, expected: str) -> None:
    assert normalize_merchant(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("SQ *JOES CATERING", "Joes Catering"),
        ("LYFT RIDE", "Lyft"),
        ("UBER TRIP", "Uber"),
        ("ZUNI CAFE", "Zuni Cafe"),
        ("OFFICE DEPOT", "Office Depot"),
        ("TST* NOPALITO", "Nopalito"),
        ("MARRIOTT SF UNION SQ", "Marriott SF Union Sq"),
        ("Joe's Catering LLC", "Joe's Catering"),
    ],
)
def test_display_merchant_reads_like_a_name(raw: str, expected: str) -> None:
    assert display_merchant(raw) == expected
