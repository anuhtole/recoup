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
