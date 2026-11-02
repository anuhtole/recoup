"""Read card transactions from the Ramp Developer API.

Written against Ramp's published OpenAPI spec: client-credentials auth, the
`transactions:read` scope only, cursor pagination through `page.next`, and amounts
as signed integers in minor units, which is what Recoup already stores. Read-only:
nothing here can change anything in Ramp.
"""

import logging
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from recoup.domain.money import MINOR_UNIT_EXPONENTS
from recoup.domain.types import Transaction, transaction_key

logger = logging.getLogger(__name__)

BASE_URLS = {"sandbox": "https://demo-api.ramp.com", "production": "https://api.ramp.com"}
SOURCE = "ramp"
SCOPE = "transactions:read"
PAGE_SIZE = 100
MAX_PAGES = 1_000
MAX_ATTEMPTS = 4
# Ramp may block for 60 seconds after a 429 when it sends no Retry-After.
RATE_LIMIT_COOLDOWN_SECONDS = 60.0
MAX_RETRY_WAIT_SECONDS = 90.0
_POSTED_STATES = {"CLEARED", "COMPLETION"}


class RampError(Exception):
    """A sync failure whose message is safe to show a person: it never contains secrets."""


class _Amount(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: int
    currency: str


class _MerchantData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reference: str | None = None


class RampTransaction(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    state: str
    entity_amount: _Amount | None = None
    merchant_name: str | None = None
    merchant_descriptor: str | None = None
    settlement_date: datetime | None = None
    accounting_date: datetime | None = None
    user_transaction_time: datetime | None = None
    merchant_data: _MerchantData | None = None


def to_transaction(raw: RampTransaction) -> tuple[Transaction | None, str | None]:
    """The domain transaction, or None and why it was skipped."""
    if raw.state not in _POSTED_STATES:
        return None, "not_posted"
    amount = raw.entity_amount
    if amount is None or amount.value == 0:
        return None, "no_amount"
    if amount.currency not in MINOR_UNIT_EXPONENTS:
        return None, "unsupported_currency"
    posted_at = raw.settlement_date or raw.accounting_date or raw.user_transaction_time
    merchant = raw.merchant_name or raw.merchant_descriptor
    if posted_at is None or not merchant:
        return None, "incomplete"
    return (
        Transaction(
            id=transaction_key(SOURCE, raw.id),
            source=SOURCE,
            external_id=raw.id,
            posted_at=posted_at,
            merchant=merchant,
            amount_minor=amount.value,
            currency=amount.currency,
            reference=raw.merchant_data.reference if raw.merchant_data else None,
        ),
        None,
    )


@dataclass(frozen=True, slots=True)
class RampPull:
    transactions: tuple[Transaction, ...]
    skipped: dict[str, int]


class RampClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        environment: str = "sandbox",
        *,
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._base_url = BASE_URLS[environment]
        self._http = http or httpx.Client(timeout=30.0)
        self._sleep = sleep
        self._token: str | None = None

    def close(self) -> None:
        self._http.close()

    def _send(self, send: Callable[[], httpx.Response]) -> httpx.Response:
        """Retry rate limits and server errors. Reads and token requests are safe to repeat."""
        for attempt in range(MAX_ATTEMPTS):
            try:
                response = send()
            except httpx.TransportError as exc:
                if attempt == MAX_ATTEMPTS - 1:
                    raise RampError("Could not reach Ramp. Try again shortly.") from exc
                self._sleep(2.0**attempt)
                continue
            if response.status_code != 429 and response.status_code < 500:
                return response
            if attempt < MAX_ATTEMPTS - 1:
                self._sleep(_retry_wait(response, attempt))
        raise RampError(f"Ramp kept returning {response.status_code}. Try again shortly.")

    def _authenticate(self) -> str:
        response = self._send(
            lambda: self._http.post(
                f"{self._base_url}/developer/v1/token",
                auth=(self._client_id, self._client_secret),
                data={"grant_type": "client_credentials", "scope": SCOPE},
            )
        )
        if response.status_code != 200:
            raise RampError(
                f"Ramp rejected the credentials ({response.status_code}). Check the client id and "
                "secret, that the app has transactions:read, and that they match this environment."
            )
        token = response.json().get("access_token")
        if not isinstance(token, str) or not token:
            raise RampError("Ramp's token response had no access token.")
        return token

    def _get(self, url: str, params: dict[str, Any] | None) -> httpx.Response:
        def send() -> httpx.Response:
            self._token = self._token or self._authenticate()
            headers = {"Authorization": f"Bearer {self._token}"}
            return self._http.get(url, params=params, headers=headers)

        response = self._send(send)
        if response.status_code == 401:
            # An expired token gets one fresh attempt.
            self._token = None
            response = self._send(send)
        return response

    def _check_next(self, next_url: str) -> str:
        """Our token only ever goes to Ramp, whatever a response says the next page is."""
        expected, actual = urlsplit(self._base_url), urlsplit(next_url)
        if (actual.scheme, actual.netloc) != (expected.scheme, expected.netloc):
            raise RampError("Ramp returned a next page on an unexpected host; stopped the sync.")
        return next_url

    def iter_transactions(self, from_date: datetime) -> Iterator[RampTransaction]:
        url = f"{self._base_url}/developer/v1/transactions"
        params: dict[str, Any] | None = {
            "from_date": from_date.isoformat(),
            "page_size": PAGE_SIZE,
            "order_by_date_asc": "true",
        }
        for _ in range(MAX_PAGES):
            response = self._get(url, params)
            if response.status_code != 200:
                raise RampError(
                    f"Ramp returned {response.status_code} for transactions. A 403 means the app "
                    "is missing the transactions:read scope."
                )
            body = response.json()
            for item in body.get("data", []):
                yield RampTransaction.model_validate(item)
            next_url = (body.get("page") or {}).get("next")
            if not next_url:
                return
            url, params = self._check_next(next_url), None
        raise RampError(f"Stopped after {MAX_PAGES} pages; narrow the lookback window.")

    def pull(self, from_date: datetime) -> RampPull:
        transactions: list[Transaction] = []
        skipped: dict[str, int] = {}
        try:
            for raw in self.iter_transactions(from_date):
                transaction, reason = to_transaction(raw)
                if transaction is not None:
                    transactions.append(transaction)
                elif reason:
                    skipped[reason] = skipped.get(reason, 0) + 1
        except (ValidationError, ValueError) as exc:
            logger.warning("unexpected Ramp response: %s", exc)
            raise RampError("Ramp returned a transaction Recoup could not read.") from exc
        return RampPull(tuple(transactions), skipped)


def _retry_wait(response: httpx.Response, attempt: int) -> float:
    header = response.headers.get("Retry-After", "")
    if header.isdigit():
        return min(float(header), MAX_RETRY_WAIT_SECONDS)
    return RATE_LIMIT_COOLDOWN_SECONDS if response.status_code == 429 else 2.0**attempt
