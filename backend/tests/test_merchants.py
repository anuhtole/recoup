import pytest

from recoup.domain.merchants import normalize_merchant


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
