"""Quality gates for every detector and for the offline extraction baseline.

With oracle promises, the deterministic detectors must be perfect on every seed.
End to end with the keyword baseline: no false positives, and no finding may ever
rest on an injection email.
"""

import pytest

from evals.extraction import score_extraction
from evals.scoring import score_findings
from evals.world import OracleExtractor, run_world
from recoup.domain.types import LeakType
from recoup.extract.heuristic import HeuristicExtractor
from recoup.synth.generate import DEFAULT_SEED, generate_world

EVAL_SEEDS = [DEFAULT_SEED + offset for offset in range(5)]


@pytest.mark.parametrize("seed", EVAL_SEEDS)
@pytest.mark.parametrize("leak_type", list(LeakType))
def test_detectors_are_exact_given_correct_promises(seed: int, leak_type: LeakType) -> None:
    world = generate_world(seed)
    run = run_world(world, OracleExtractor(world))

    report = score_findings(run.findings, world.labels, leak_type, len(world.transactions))

    assert report.recall == 1.0, report.missed_case_ids
    assert report.false_positives == 0, report.false_positive_keys
    assert report.hard_negatives_triggered == 0
    assert report.outcome_accuracy == 1.0, report.wrong_outcome_case_ids


@pytest.mark.parametrize("seed", EVAL_SEEDS)
def test_baseline_end_to_end_never_flags_a_false_positive_or_an_injection(seed: int) -> None:
    world = generate_world(seed)
    run = run_world(world, HeuristicExtractor())

    extraction = score_extraction(world.labels, run.extractions, run.findings)
    reports = [score_findings(run.findings, world.labels, t, 0) for t in LeakType]

    assert extraction.injection_findings == 0
    assert all(r.false_positives == 0 and r.hard_negatives_triggered == 0 for r in reports)
