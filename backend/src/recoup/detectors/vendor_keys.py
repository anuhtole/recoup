"""Map card descriptors onto vendor-directory keys, so "AWS" and "AMAZON WEB SERVICES" agree."""

from recoup.domain.merchants import normalize_merchant
from recoup.domain.types import Transaction
from recoup.domain.vendors import VendorDirectory


def vendor_key(txn: Transaction, vendors: VendorDirectory) -> str:
    normalized = normalize_merchant(txn.merchant)
    vendor = vendors.for_merchant(normalized)
    return vendor.key if vendor else normalized
