"""Score findings against a labeled answer key.

A finding counts as a true positive only if it names exactly the transactions and
sources (emails, incidents) of a planted case. Anything else is a false positive,
including findings that touch a hard negative (a look-alike that must not be flagged).
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from recoup.domain.types import FindingCandidate, LeakType, Transaction

Detector = Callable[[Sequence[Transaction]], list[FindingCandidate]]
CaseKey = tuple[tuple[str, ...], tuple[str, ...]]


def _case_key(case: dict[str, Any]) -> CaseKey:
    return tuple(case["transaction_ids"]), tuple(case.get("source_refs", []))


@dataclass(frozen=True, slots=True)
class EvalReport:
    seed: int
    transactions: int
    positives: int
    hard_negatives: int
    true_positives: int
    false_positives: int
    false_negatives: int
    outcome_correct: int
    hard_negatives_triggered: int
    planted_minor: int
    found_minor: int
    false_positive_keys: tuple[str, ...]
    missed_case_ids: tuple[str, ...]
    wrong_outcome_case_ids: tuple[str, ...]

    @property
    def precision(self) -> float:
        flagged = self.true_positives + self.false_positives
        return self.true_positives / flagged if flagged else 1.0

    @property
    def recall(self) -> float:
        return self.true_positives / self.positives if self.positives else 1.0

    @property
    def outcome_accuracy(self) -> float:
        return self.outcome_correct / self.true_positives if self.true_positives else 1.0


def evaluate(
    transactions: Sequence[Transaction],
    labels: dict[str, Any],
    detector: Detector,
    leak_type: LeakType = LeakType.DUPLICATE_CHARGE,
) -> EvalReport:
    return score_findings(detector(transactions), labels, leak_type, len(transactions))


def score_findings(
    all_findings: Sequence[FindingCandidate],
    labels: dict[str, Any],
    leak_type: LeakType,
    transaction_count: int,
) -> EvalReport:
    cases = [c for c in labels["cases"] if c["leak_type"] == leak_type.value]
    positives = {_case_key(c): c for c in cases if c["kind"] == "positive"}
    hard_negative_ids = [
        set(c["transaction_ids"]) | set(c.get("source_refs", []))
        for c in cases
        if c["kind"] == "hard_negative"
    ]

    findings = [f for f in all_findings if f.leak_type is leak_type]
    matched: set[str] = set()
    false_positive_keys: list[str] = []
    wrong_outcome: list[str] = []
    found_minor = 0

    for finding in findings:
        case = positives.get((finding.transaction_ids, finding.source_refs))
        if case is None:
            false_positive_keys.append(finding.key)
            continue
        matched.add(case["case_id"])
        found_minor += finding.amount_minor
        if finding.outcome.value != case["expected_outcome"]:
            wrong_outcome.append(case["case_id"])

    triggered = sum(
        1
        for ids in hard_negative_ids
        if any(ids & (set(f.transaction_ids) | set(f.source_refs)) for f in findings)
    )
    missed = sorted(c["case_id"] for c in positives.values() if c["case_id"] not in matched)

    return EvalReport(
        seed=int(labels["seed"]),
        transactions=transaction_count,
        positives=len(positives),
        hard_negatives=len(hard_negative_ids),
        true_positives=len(matched),
        false_positives=len(false_positive_keys),
        false_negatives=len(missed),
        outcome_correct=len(matched) - len(wrong_outcome),
        hard_negatives_triggered=triggered,
        planted_minor=sum(int(c["amount_minor"]) for c in positives.values()),
        found_minor=found_minor,
        false_positive_keys=tuple(false_positive_keys),
        missed_case_ids=tuple(missed),
        wrong_outcome_case_ids=tuple(sorted(wrong_outcome)),
    )
