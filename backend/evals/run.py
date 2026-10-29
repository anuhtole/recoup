"""Run the eval suite and write results tables: `python -m evals.run [--claude]`.

Without --claude it runs the deterministic detectors and the offline baseline.
With --claude (and ANTHROPIC_API_KEY set) it also scores Claude extraction on the
same emails and reports token usage. That makes real API calls, which cost money.
"""

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from evals.extraction import ExtractionReport, score_extraction
from evals.scoring import EvalReport, score_findings
from evals.world import OracleExtractor, run_world
from recoup.config import get_settings
from recoup.domain.money import Money
from recoup.domain.types import LeakType
from recoup.extract.base import PromiseExtractor
from recoup.extract.heuristic import HeuristicExtractor
from recoup.synth.generate import DEFAULT_SEED, World, generate_world

SEEDS = [DEFAULT_SEED + offset for offset in range(5)]
RESULTS_DIR = Path(__file__).parent / "results"
LABELS = {
    LeakType.DUPLICATE_CHARGE: "Duplicate charges",
    LeakType.MISSING_REFUND: "Refunds promised, never posted",
    LeakType.CHARGED_AFTER_CANCELLATION: "Billed after cancellation",
    LeakType.SLA_CREDIT: "Outage credits owed",
}


def _detector_table(worlds: list[World]) -> tuple[str, list[dict[str, Any]]]:
    totals: dict[LeakType, list[EvalReport]] = {t: [] for t in LeakType}
    for world in worlds:
        run = run_world(world, OracleExtractor(world))
        for leak_type in LeakType:
            totals[leak_type].append(
                score_findings(run.findings, world.labels, leak_type, len(world.transactions))
            )
    lines = [
        f"### Detectors, given correct promises ({len(worlds)} seeds)",
        "",
        "| Leak | Found | False positives | Hard negatives flagged | Outcome accuracy | $ found |",
        "|---|---|---|---|---|---|",
    ]
    rows = []
    for leak_type, reports in totals.items():
        found = sum(r.true_positives for r in reports)
        planted = sum(r.positives for r in reports)
        fps = sum(r.false_positives for r in reports)
        negatives = sum(r.hard_negatives for r in reports)
        triggered = sum(r.hard_negatives_triggered for r in reports)
        correct = sum(r.outcome_correct for r in reports)
        dollars = Money(sum(r.found_minor for r in reports) // len(reports), "USD").format()
        lines.append(
            f"| {LABELS[leak_type]} | {found}/{planted} | {fps} | {triggered}/{negatives} "
            f"| {correct / found if found else 1:.2f} | {dollars} avg |"
        )
        rows.append({"leak_type": leak_type.value, "reports": [asdict(r) for r in reports]})
    return "\n".join(lines), rows


def _extraction_row(name: str, report: ExtractionReport, recall_by_type: dict[str, str]) -> str:
    return (
        f"| {name} | {report.precision:.2f} | {report.recall:.2f} "
        f"| {report.injection_extractions} | {report.injection_findings} "
        f"| {recall_by_type[LeakType.MISSING_REFUND.value]} "
        f"| {recall_by_type[LeakType.CHARGED_AFTER_CANCELLATION.value]} |"
    )


def _score_extractor(
    world: World, extractor: PromiseExtractor
) -> tuple[ExtractionReport, dict[str, str]]:
    run = run_world(world, extractor)
    report = score_extraction(world.labels, run.extractions, run.findings)
    recall = {}
    for leak_type in (LeakType.MISSING_REFUND, LeakType.CHARGED_AFTER_CANCELLATION):
        r = score_findings(run.findings, world.labels, leak_type, len(world.transactions))
        recall[leak_type.value] = f"{r.true_positives}/{r.positives}"
    return report, recall


def _claude_extractor() -> PromiseExtractor:
    from recoup.services import build_services

    services = build_services(get_settings())
    if services.llm is None:
        raise SystemExit("--claude needs ANTHROPIC_API_KEY (and RECOUP_LLM not set to off)")
    return services.extractor


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--claude", action="store_true", help="also score Claude (paid API calls)")
    args = parser.parse_args()

    worlds = [generate_world(seed) for seed in SEEDS]
    detector_md, detector_json = _detector_table(worlds)

    extractors: list[tuple[str, PromiseExtractor]] = [("Keyword baseline", HeuristicExtractor())]
    if args.claude:
        extractors.append((f"Claude ({get_settings().llm_model})", _claude_extractor()))
    # The inbox is identical across seeds, so extraction is scored on the default world.
    world = worlds[0]
    extraction_lines = [
        f"### Promise extraction ({len(world.emails)} vendor emails, 2 of them injections)",
        "",
        "| Extractor | Precision | Recall | Injection promises extracted "
        "| Findings from injections | Broken refunds found | Post-cancel charges found |",
        "|---|---|---|---|---|---|---|",
    ]
    extraction_json = []
    for name, extractor in extractors:
        report, recall = _score_extractor(world, extractor)
        extraction_lines.append(_extraction_row(name, report, recall))
        extraction_json.append({"extractor": name, **asdict(report), "recall_by_type": recall})

    output = "\n\n".join([detector_md, "\n".join(extraction_lines)])
    print(output)
    RESULTS_DIR.mkdir(exist_ok=True)
    (RESULTS_DIR / "summary.md").write_text(output + "\n")
    (RESULTS_DIR / "summary.json").write_text(
        json.dumps({"detectors": detector_json, "extraction": extraction_json}, indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
