"""Merchant name normalization for deterministic matching.

Card descriptors vary ("SQ *JOES CATERING", "Joe's Catering LLC"). Normalizing
them in code handles the common cases cheaply; genuinely ambiguous names are a
job for the model later, not for more regexes here.
"""

import re

_PROCESSOR_PREFIXES = ("SQ *", "SQ*", "TST*", "TST *", "PAYPAL *", "PP*", "SP *", "SP*")
_LEGAL_SUFFIXES = {"INC", "LLC", "LTD", "CO", "CORP", "CORPORATION", "COMPANY", "COM"}
_NON_ALNUM = re.compile(r"[^A-Z0-9 ]+")
_DIGITS = re.compile(r"\d+")
_SPACES = re.compile(r"\s+")


def normalize_merchant(name: str) -> str:
    text = name.upper().strip()
    for prefix in _PROCESSOR_PREFIXES:
        if text.startswith(prefix):
            text = text[len(prefix) :]
            break
    text = text.replace("'", "")
    text = _NON_ALNUM.sub(" ", text)
    text = _DIGITS.sub(" ", text)
    tokens = [token for token in _SPACES.split(text) if token and token not in _LEGAL_SUFFIXES]
    return " ".join(tokens)


# Card networks append what was bought ("LYFT RIDE", "UBER TRIP"); the merchant is the rest.
_DESCRIPTOR_TAILS = {"RIDE", "TRIP"}
# Short tokens that are codes, not words, and stay upper-case.
_KEEP_UPPER = {"SF", "NY", "LA", "US", "UK", "EU", "AWS"}


def display_merchant(name: str) -> str:
    """A card descriptor as a person writes the name: "SQ *JOES CATERING" -> "Joes Catering"."""
    text = name.strip()
    for prefix in _PROCESSOR_PREFIXES:
        if text.upper().startswith(prefix):
            text = text[len(prefix) :].strip()
            break
    words = text.split()
    while len(words) > 1 and words[-1].upper().strip(".,") in _LEGAL_SUFFIXES | _DESCRIPTOR_TAILS:
        words = words[:-1]
    if not text.isupper():
        return " ".join(words)
    return " ".join(w if w in _KEEP_UPPER else w.capitalize() for w in words)
