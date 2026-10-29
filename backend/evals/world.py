"""Run the full detection stack over a synthetic world, in memory, with any extractor.

`OracleExtractor` returns the answer key's promises, which isolates the
deterministic detectors from extraction quality. Real extractors are then
scored on the same emails.
"""

from dataclasses import dataclass
from datetime import date

from recoup.detectors.duplicates import detect_duplicates
from recoup.detectors.outages import detect_sla_credits
from recoup.detectors.promises import detect_broken_promises
from recoup.domain.sources import Email, Promise
from recoup.domain.types import FindingCandidate
from recoup.domain.vendors import VendorDirectory
from recoup.extract.base import PromiseExtractor
from recoup.extract.schema import EmailExtraction, ExtractedPromise
from recoup.extract.validate import validate_extraction
from recoup.synth.generate import World


class OracleExtractor:
    name = "oracle"

    def __init__(self, world: World) -> None:
        self._labels = world.labels["emails"]

    def extract(self, email: Email) -> EmailExtraction:
        promises = self._labels[email.id]["promises"]
        return EmailExtraction(promises=[ExtractedPromise.model_validate(p) for p in promises])


@dataclass(frozen=True)
class WorldRun:
    extractions: dict[str, EmailExtraction]
    promises: list[Promise]
    rejected: int
    findings: list[FindingCandidate]


def run_world(world: World, extractor: PromiseExtractor) -> WorldRun:
    vendors = VendorDirectory(world.vendors)
    as_of = date.fromisoformat(world.labels["as_of"])
    extractions = {email.id: extractor.extract(email) for email in world.emails}
    promises: list[Promise] = []
    rejected = 0
    for email in world.emails:
        accepted, rejections = validate_extraction(email, extractions[email.id], vendors)
        promises.extend(accepted)
        rejected += len(rejections)
    findings = [
        *detect_duplicates(world.transactions),
        *detect_broken_promises(world.transactions, promises, vendors, as_of),
        *detect_sla_credits(world.transactions, world.contracts, world.incidents, vendors, as_of),
    ]
    return WorldRun(extractions, promises, rejected, findings)
