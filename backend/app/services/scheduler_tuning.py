import csv
import html
import json
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

from ..config import BACKEND_DIR
from ..models import Progress, Question
from ..scheduler import (
    create_fsrs_scheduler,
    fsrs_card_for_progress,
    new_fsrs_card_data,
    parse_history_date,
    review_datetime_for_date,
    update_progress
)
from .mode_difficulty import click_prompt_base_difficulty
from .sequence_modes import (
    SEQUENCE_GOAL_RECITATION,
    sequence_reorder_difficulty
)
from .settings import (
    SCHEDULER_TUNING_SETTINGS_KEY,
    load_scheduler_tuning_settings,
    normalize_scheduler_tuning_settings,
    save_scheduler_tuning_settings
)


DEFAULT_TUNING_REPORT_DIR = BACKEND_DIR / "tuning_reports"
TUNABLE_MODES = {
    "type_prompt",
    "multiple_choice",
    "click_prompt",
    "sequence_reorder"
}
PARAMETER_STEPS = {
    "type_prompt_difficulty": 0.03,
    "multiple_choice_difficulty": 0.03,
    "click_prompt_bias": 0.025,
    "sequence_reorder_bias": 0.025,
    "easy_reward_floor": 0.025,
    "failure_penalty_power": 0.05
}


@dataclass
class TuningParams:
    type_prompt_difficulty: float = 1.05
    multiple_choice_difficulty: float = 0.55
    click_prompt_bias: float = 0.0
    sequence_reorder_bias: float = 0.0
    easy_reward_floor: float = 0.50
    failure_penalty_power: float = 1.0

    @classmethod
    def from_settings(cls, settings):
        normalized = normalize_scheduler_tuning_settings(settings)
        return cls(**normalized)

    def to_settings(self):
        return normalize_scheduler_tuning_settings(asdict(self))


@dataclass
class ReplayProgress:
    question_id: int
    stability: float = 1.0
    difficulty: float = 5.0
    reps: int = 0
    lapses: int = 0
    interval: int = 0
    last_review: object = None
    next_review: object = None
    ideal_interval: int | None = None
    ideal_next_review: object = None
    fsrs_card: dict | None = None
    fsrs_version: str | None = None
    history: list = field(default_factory=list)


@dataclass
class HistoryEvent:
    question_id: int
    index: int
    reviewed_on: object
    mode: str
    quality: int
    context_count: int
    goal: str | None = None
    recorded_difficulty: float | None = None
    recorded_sequence_reorder_bias: float = 0.0


@dataclass
class CalibrationSample:
    question_id: int
    sequence: int
    source_mode: str
    validation_date: object
    predicted_retrievability: float
    observed_success: int


def clamp(value, lower, upper):
    return max(lower, min(upper, value))


def normalize_history_mode(entry):
    answer_event = entry.get("answer_event")
    event_mode = (
        answer_event.get("mode")
        if isinstance(answer_event, dict)
        else None
    )
    event_type = (
        answer_event.get("type_q")
        if isinstance(answer_event, dict)
        else None
    )
    sequence_mode = entry.get("sequence_mode")

    if sequence_mode in {
        "type_position",
        "gap_fill",
        "multiple_choice",
        "reorder",
        "recite"
    }:
        return f"sequence_{sequence_mode}"

    if event_type == "sequence" and event_mode in {
        "type_position",
        "gap_fill",
        "multiple_choice",
        "reorder",
        "recite"
    }:
        return f"sequence_{event_mode}"

    text_mode = entry.get("text_mode")

    if event_type == "text" and not text_mode:
        text_mode = event_mode

    if text_mode == "match":
        return "text_match"
    if text_mode == "type_all":
        return "type_all"

    if event_type == "timeline":
        return f"timeline_{event_mode or 'event_to_date'}"

    mode = entry.get("map_mode") or entry.get("image_mode") or event_mode

    if mode in {
        "multiple_choice",
        "multiple_choice_label",
        "multiple_choice_media",
        "multiple_choice_image"
    }:
        return "multiple_choice"

    if mode in {"type_all", "type_prompt", "click_prompt"}:
        return mode

    return None


def history_context_count(entry):
    for key in (
        "sequence_context_count",
        "map_context_count",
        "image_context_count",
        "context_count"
    ):
        if entry.get(key) is None:
            continue

        try:
            return max(0, int(entry[key]))
        except (TypeError, ValueError):
            return 0

    return 0


def history_mode_difficulty(entry):
    try:
        return float(entry.get("mode_difficulty"))
    except (TypeError, ValueError):
        return None


def history_sequence_reorder_bias(entry):
    try:
        return float(entry.get("sequence_reorder_bias", 0.0))
    except (TypeError, ValueError):
        return 0.0


def history_quality(entry):
    value = entry.get("raw_quality", entry.get("quality"))

    try:
        quality = int(value)
    except (TypeError, ValueError):
        return None

    return max(0, min(3, quality))


def sorted_history_events(progress):
    events = []

    for index, entry in enumerate(progress.history or []):
        if not isinstance(entry, dict):
            continue

        reviewed_on = parse_history_date(entry.get("reviewed_on"))
        mode = normalize_history_mode(entry)
        quality = history_quality(entry)

        if not reviewed_on or mode is None or quality is None:
            continue

        events.append(HistoryEvent(
            question_id=progress.question_id or 0,
            index=index,
            reviewed_on=reviewed_on,
            mode=mode,
            quality=quality,
            context_count=history_context_count(entry),
            goal=entry.get("sequence_goal"),
            recorded_difficulty=history_mode_difficulty(entry),
            recorded_sequence_reorder_bias=history_sequence_reorder_bias(entry)
        ))

    return sorted(events, key=lambda item: (item.reviewed_on, item.index))


def mode_difficulty_for_event(event, params):
    if event.mode == "type_all":
        return 1.0

    if event.mode == "type_prompt":
        return params.type_prompt_difficulty

    if event.mode == "multiple_choice":
        return params.multiple_choice_difficulty

    if event.mode == "click_prompt":
        difficulty = click_prompt_base_difficulty(event.context_count)
        return clamp(difficulty + params.click_prompt_bias, 0.35, 0.98)

    if event.mode == "sequence_reorder":
        if event.recorded_difficulty is not None:
            base = (
                event.recorded_difficulty -
                event.recorded_sequence_reorder_bias
            )
            return clamp(base + params.sequence_reorder_bias, 0.4, 0.95)

        return sequence_reorder_difficulty(
            event.context_count,
            tuning=params.to_settings()
        )

    if event.mode.startswith("sequence_") and event.recorded_difficulty is not None:
        return event.recorded_difficulty

    if event.mode == "sequence_multiple_choice":
        return params.multiple_choice_difficulty

    if event.mode == "sequence_type_position":
        return 1.0

    if (
        event.mode.startswith("text_") or
        event.mode.startswith("timeline_")
    ) and event.recorded_difficulty is not None:
        return event.recorded_difficulty

    return 1.0


def write_replay_progress(progress, quality, scheduling):
    # update_progress reads the previous answer back off the history to spot a
    # same-day retry, so the replay has to keep one exactly like the live write
    # path does. Without it the tuner would fit against compounded lapses the
    # real scheduler no longer books.
    progress.history = [
        *(progress.history or []),
        {
            "reviewed_on": scheduling["last_review"].isoformat(),
            "quality": quality,
            "repeat_lapse": scheduling.get("repeat_lapse", False)
        }
    ]
    progress.stability = scheduling["stability"]
    progress.difficulty = scheduling["difficulty"]
    progress.reps = scheduling["reps"]
    progress.lapses = scheduling["lapses"]
    progress.interval = scheduling["interval"]
    progress.ideal_interval = scheduling.get(
        "ideal_interval",
        scheduling["interval"]
    )
    progress.last_review = scheduling["last_review"]
    progress.next_review = scheduling["next_review"]
    progress.ideal_next_review = scheduling.get(
        "ideal_next_review",
        scheduling["next_review"]
    )
    progress.fsrs_card = scheduling.get("fsrs_card")
    progress.fsrs_version = scheduling.get("fsrs_version")


def replay_retrievability(progress, day):
    if not progress.last_review:
        return None

    card = fsrs_card_for_progress(progress, today=day)
    scheduler = create_fsrs_scheduler(enable_fuzzing=False)

    try:
        return scheduler.get_card_retrievability(
            card,
            current_datetime=review_datetime_for_date(day)
        )
    except (AssertionError, TypeError, ValueError):
        return None


def replay_progress_for_samples(progress, params):
    events = sorted_history_events(progress)

    if not events:
        return []

    replay = ReplayProgress(
        question_id=progress.question_id or 0,
        next_review=events[0].reviewed_on,
        fsrs_card=new_fsrs_card_data(
            progress.question_id or 0,
            due=events[0].reviewed_on
        )
    )
    samples = []
    previous_event = None

    for sequence, event in enumerate(events):
        validates_shared_mode = (
            event.mode == "type_all" and
            previous_event and
            previous_event.mode in {
                "type_prompt",
                "multiple_choice",
                "click_prompt"
            }
        )
        validates_sequence_reorder = (
            event.mode == "sequence_recite" and
            event.goal == SEQUENCE_GOAL_RECITATION and
            previous_event and
            previous_event.mode == "sequence_reorder" and
            previous_event.goal == SEQUENCE_GOAL_RECITATION
        )

        if (
            previous_event and
            (validates_shared_mode or validates_sequence_reorder) and
            (event.reviewed_on - previous_event.reviewed_on).days >= 1
        ):
            retrievability = replay_retrievability(replay, event.reviewed_on)

            if retrievability is not None:
                samples.append(CalibrationSample(
                    question_id=progress.question_id or 0,
                    sequence=sequence,
                    source_mode=previous_event.mode,
                    validation_date=event.reviewed_on,
                    predicted_retrievability=float(retrievability),
                    observed_success=1 if event.quality > 0 else 0
                ))

        scheduling = update_progress(
            replay,
            event.quality,
            today=event.reviewed_on,
            mode_difficulty=mode_difficulty_for_event(event, params),
            scheduler_tuning=params.to_settings(),
            enable_fuzzing=False
        )
        write_replay_progress(replay, event.quality, scheduling)
        previous_event = event

    return samples


def load_progress_rows(db):
    return [
        progress
        for progress, _ in (
            db.query(Progress, Question.type_q)
            .join(Question, Question.id == Progress.question_id)
            .all()
        )
        if progress.history
    ]


def collect_calibration_samples(progress_rows, params):
    samples = []

    for progress in progress_rows:
        samples.extend(replay_progress_for_samples(progress, params))

    return sorted(
        samples,
        key=lambda item: (item.validation_date, item.question_id, item.sequence)
    )


def brier_score(samples):
    if not samples:
        return None

    return mean(
        (
            sample.predicted_retrievability -
            sample.observed_success
        ) ** 2
        for sample in samples
    )


def split_samples(samples):
    if not samples:
        return [], []

    split_index = max(1, int(len(samples) * 0.7))

    if split_index >= len(samples):
        split_index = len(samples)

    return samples[:split_index], samples[split_index:]


def retrievability_bucket(value):
    index = min(9, max(0, int(value * 10)))
    return f"{index / 10:.1f}-{(index + 1) / 10:.1f}"


def summarize_calibration(samples):
    grouped = defaultdict(list)

    for sample in samples:
        grouped[(sample.source_mode, retrievability_bucket(
            sample.predicted_retrievability
        ))].append(sample)

    rows = []

    for (mode, bucket), items in sorted(grouped.items()):
        predicted = [item.predicted_retrievability for item in items]
        observed = [item.observed_success for item in items]
        rows.append({
            "source_mode": mode,
            "bucket": bucket,
            "count": len(items),
            "avg_predicted_retrievability": round(mean(predicted), 4),
            "observed_success_rate": round(mean(observed), 4),
            "brier_score": round(brier_score(items), 6)
        })

    return rows


def sample_counts_by_mode(samples):
    counts = Counter(sample.source_mode for sample in samples)

    return {
        mode: counts.get(mode, 0)
        for mode in sorted(TUNABLE_MODES)
    }


def evaluate_params(progress_rows, params):
    samples = collect_calibration_samples(progress_rows, params)
    train_samples, validation_samples = split_samples(samples)

    return {
        "params": params,
        "samples": samples,
        "train_samples": train_samples,
        "validation_samples": validation_samples,
        "train_brier": brier_score(train_samples),
        "validation_brier": brier_score(validation_samples),
        "sample_counts": sample_counts_by_mode(samples),
        "validation_sample_counts": sample_counts_by_mode(validation_samples)
    }


def candidate_params(current):
    yield "current", None, current

    for key, step in PARAMETER_STEPS.items():
        for direction in (-1, 1):
            values = current.to_settings()
            values[key] = values[key] + (step * direction)
            yield (
                f"{key}{'+' if direction > 0 else '-'}",
                key,
                TuningParams.from_settings(values)
            )


def validation_improvement(base_score, candidate_score):
    if base_score is None or candidate_score is None:
        return 0.0

    if base_score <= 0:
        return 0.0

    return (base_score - candidate_score) / base_score


def changed_param_sample_gate(
    changed_param,
    sample_counts,
    validation_counts,
    min_total_pairs,
    min_mode_pairs
):
    if changed_param == "type_prompt_difficulty":
        return validation_counts.get("type_prompt", 0) >= min_mode_pairs

    if changed_param == "multiple_choice_difficulty":
        return validation_counts.get("multiple_choice", 0) >= min_mode_pairs

    if changed_param == "click_prompt_bias":
        return validation_counts.get("click_prompt", 0) >= min_mode_pairs

    if changed_param == "sequence_reorder_bias":
        return (
            sample_counts.get("sequence_reorder", 0) >= max(100, min_total_pairs) and
            validation_counts.get("sequence_reorder", 0) >= max(25, min_mode_pairs)
        )

    if changed_param in {"easy_reward_floor", "failure_penalty_power"}:
        return sum(
            1
            for count in validation_counts.values()
            if count >= min_mode_pairs
        ) >= 2

    return False


def choose_candidate(progress_rows, current, min_total_pairs, min_mode_pairs):
    records = []

    for label, changed_param, params in candidate_params(current):
        evaluation = evaluate_params(progress_rows, params)
        records.append({
            "label": label,
            "changed_param": changed_param,
            **evaluation
        })

    current_record = records[0]
    scored_candidates = [
        record
        for record in records[1:]
        if record["train_brier"] is not None
    ]
    best_record = min(
        scored_candidates,
        key=lambda record: record["train_brier"],
        default=current_record
    )
    total_pairs = len(current_record["samples"])
    validation_pairs = len(current_record["validation_samples"])
    accepted = False
    reason = "candidate_not_better"

    if total_pairs < min_total_pairs:
        reason = "insufficient_total_pairs"
    elif validation_pairs <= 0:
        reason = "insufficient_validation_pairs"
    elif best_record is current_record:
        reason = "candidate_not_better"
    elif not changed_param_sample_gate(
        best_record["changed_param"],
        current_record["sample_counts"],
        current_record["validation_sample_counts"],
        min_total_pairs,
        min_mode_pairs
    ):
        reason = "insufficient_mode_pairs"
    else:
        improvement = validation_improvement(
            current_record["validation_brier"],
            best_record["validation_brier"]
        )

        if improvement >= 0.01:
            accepted = True
            reason = "accepted"
        else:
            reason = "validation_improvement_below_threshold"

    return {
        "current": current_record,
        "candidate": best_record,
        "records": records,
        "accepted": accepted,
        "reason": reason,
        "validation_improvement": validation_improvement(
            current_record["validation_brier"],
            best_record["validation_brier"]
        )
    }


def rounded(value, places=6):
    if value is None:
        return None

    return round(float(value), places)


def candidate_score_rows(records):
    rows = []

    for record in records:
        row = {
            "label": record["label"],
            "changed_param": record["changed_param"] or "",
            "train_brier": rounded(record["train_brier"]),
            "validation_brier": rounded(record["validation_brier"]),
            "sample_count": len(record["samples"]),
            "validation_count": len(record["validation_samples"])
        }
        row.update(record["params"].to_settings())
        rows.append(row)

    return rows


def expected_direction(current, candidate):
    directions = {}
    current_values = current.to_settings()
    candidate_values = candidate.to_settings()

    for key, value in candidate_values.items():
        delta = round(value - current_values[key], 6)

        if delta > 0:
            directions[key] = "increase"
        elif delta < 0:
            directions[key] = "decrease"
        else:
            directions[key] = "unchanged"

    return directions


def build_summary(result, apply_enabled, applied):
    current = result["current"]
    candidate = result["candidate"]
    reason = result["reason"]

    if result["accepted"] and not apply_enabled:
        reason = "dry_run"
    elif applied:
        reason = "applied"

    current_params = current["params"].to_settings()
    candidate_params = candidate["params"].to_settings()

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "setting_key": SCHEDULER_TUNING_SETTINGS_KEY,
        "apply_enabled": apply_enabled,
        "accepted": result["accepted"],
        "applied": applied,
        "reason": reason,
        "validation_improvement": rounded(result["validation_improvement"]),
        "total_pairs": len(current["samples"]),
        "validation_pairs": len(current["validation_samples"]),
        "sample_counts": current["sample_counts"],
        "validation_sample_counts": current["validation_sample_counts"],
        "current_params": current_params,
        "candidate_params": candidate_params,
        "difficulty_effect_contract": {
            "current": {
                "success_reward_floor": current_params["easy_reward_floor"],
                "failure_penalty_power": current_params["failure_penalty_power"]
            },
            "candidate": {
                "success_reward_floor": candidate_params["easy_reward_floor"],
                "failure_penalty_power": candidate_params["failure_penalty_power"]
            },
            "note": (
                "Mode difficulty changes both success reward and lapse "
                "forgiveness; tune them as one scheduling contract."
            )
        },
        "expected_direction": expected_direction(
            current["params"],
            candidate["params"]
        ),
        "current_train_brier": rounded(current["train_brier"]),
        "current_validation_brier": rounded(current["validation_brier"]),
        "candidate_train_brier": rounded(candidate["train_brier"]),
        "candidate_validation_brier": rounded(candidate["validation_brier"])
    }


def write_csv(path, rows, fieldnames):
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def render_report(summary, calibration_rows, score_rows):
    def table(rows):
        if not rows:
            return "<p>No rows.</p>"

        headers = list(rows[0].keys())
        head = "".join(f"<th>{html.escape(str(item))}</th>" for item in headers)
        body = []

        for row in rows:
            body.append(
                "<tr>" +
                "".join(
                    f"<td>{html.escape(str(row.get(header, '')))}</td>"
                    for header in headers
                ) +
                "</tr>"
            )

        return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"

    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Scheduler Tuning Report</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 32px; color: #1f2933; }}
    h1, h2 {{ margin-bottom: 8px; }}
    code, pre {{ background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }}
    table {{ border-collapse: collapse; width: 100%; margin: 16px 0 28px; }}
    th, td {{ border: 1px solid #d9dee7; padding: 6px 8px; text-align: left; }}
    th {{ background: #eef2f7; }}
    .metrics {{ display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }}
    .metric {{ border: 1px solid #d9dee7; padding: 10px 12px; border-radius: 6px; }}
  </style>
</head>
<body>
  <h1>Scheduler Tuning Report</h1>
  <div class="metrics">
    <div class="metric"><strong>{summary["total_pairs"]}</strong><br>total pairs</div>
    <div class="metric"><strong>{summary["validation_pairs"]}</strong><br>validation pairs</div>
    <div class="metric"><strong>{summary["accepted"]}</strong><br>accepted</div>
    <div class="metric"><strong>{summary["applied"]}</strong><br>applied</div>
    <div class="metric"><strong>{summary["reason"]}</strong><br>reason</div>
  </div>
  <h2>Summary</h2>
  <pre>{html.escape(json.dumps(summary, indent=2, sort_keys=True))}</pre>
  <h2>Calibration By Mode</h2>
  {table(calibration_rows)}
  <h2>Candidate Scores</h2>
  {table(score_rows)}
</body>
</html>
"""


def write_reports(out_dir, summary, calibration_rows, score_rows):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True)
    )
    write_csv(
        out_dir / "calibration_by_mode.csv",
        calibration_rows,
        [
            "source_mode",
            "bucket",
            "count",
            "avg_predicted_retrievability",
            "observed_success_rate",
            "brier_score"
        ]
    )
    score_rows = candidate_score_rows(score_rows)
    write_csv(
        out_dir / "candidate_scores.csv",
        score_rows,
        [
            "label",
            "changed_param",
            "train_brier",
            "validation_brier",
            "sample_count",
            "validation_count",
            "type_prompt_difficulty",
            "multiple_choice_difficulty",
            "click_prompt_bias",
            "sequence_reorder_bias",
            "easy_reward_floor",
            "failure_penalty_power"
        ]
    )
    (out_dir / "report.html").write_text(
        render_report(summary, calibration_rows, score_rows)
    )

    return {
        "summary": out_dir / "summary.json",
        "calibration": out_dir / "calibration_by_mode.csv",
        "candidate_scores": out_dir / "candidate_scores.csv",
        "html": out_dir / "report.html"
    }


def tune_scheduler(
    db,
    apply_enabled=True,
    min_total_pairs=100,
    min_mode_pairs=25,
    out_dir=DEFAULT_TUNING_REPORT_DIR
):
    current = TuningParams.from_settings(load_scheduler_tuning_settings(db))
    progress_rows = load_progress_rows(db)
    result = choose_candidate(
        progress_rows,
        current,
        min_total_pairs=min_total_pairs,
        min_mode_pairs=min_mode_pairs
    )
    applied = False

    if apply_enabled and result["accepted"]:
        save_scheduler_tuning_settings(
            db,
            result["candidate"]["params"].to_settings()
        )
        applied = True

    summary = build_summary(result, apply_enabled, applied)
    calibration_rows = summarize_calibration(result["current"]["samples"])
    report_paths = write_reports(
        out_dir,
        summary,
        calibration_rows,
        result["records"]
    )

    return {
        "summary": summary,
        "calibration_by_mode": calibration_rows,
        "candidate_scores": candidate_score_rows(result["records"]),
        "report_paths": report_paths
    }
