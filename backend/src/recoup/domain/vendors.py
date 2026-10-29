"""Lookups over the vendor directory."""

from collections.abc import Iterable, Iterator

from recoup.domain.sources import Vendor


class VendorDirectory:
    def __init__(self, vendors: Iterable[Vendor]) -> None:
        self._vendors = tuple(vendors)
        self._by_key: dict[str, Vendor] = {}
        for vendor in self._vendors:
            for key in (vendor.key, *vendor.aliases):
                self._by_key[key] = vendor

    def __iter__(self) -> Iterator[Vendor]:
        return iter(self._vendors)

    def for_merchant(self, merchant_norm: str) -> Vendor | None:
        return self._by_key.get(merchant_norm)

    def for_sender(self, address: str) -> Vendor | None:
        """The vendor an email verifiably comes from, or None.

        Matches on the sender's domain. When several vendors share a domain
        (Amazon retail and AWS), the exact support address decides; otherwise
        the sender is ambiguous and treated as unverified.

        Production would also require a passing DKIM/SPF Authentication-Results
        header, which Gmail exposes; the synthetic mailbox has no headers.
        """
        candidates = [v for v in self._vendors if v.sends_from(address)]
        if len(candidates) == 1:
            return candidates[0]
        normalized = address.strip().lower()
        exact = [v for v in candidates if v.support_email.lower() == normalized]
        return exact[0] if len(exact) == 1 else None
