import argparse
import csv
import html
import json
import math
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from statistics import mean

from app.scheduler import (
    assign_smoothed_schedules,
    candidate_review_dates,
    create_fsrs_scheduler,
    fsrs_card_for_progress,
    review_datetime_for_date,
    set_fsrs_card_due_date,
    update_progress
)
from app.services.map_modes import map_mode_difficulty


SIMULATION_MODES = ("type_all", "type_prompt", "click_prompt", "qcm")
DEFAULT_MODE_MIX = {
    "type_all": 0.25,
    "type_prompt": 0.25,
    "click_prompt": 0.25,
    "qcm": 0.25
}
DEFAULT_CLICK_SIZES = (2, 4, 8, 16, 32, 64)
SWEEP_STABILITIES = (1.0, 3.0, 7.0, 14.0)
SWEEP_DIFFICULTIES = (3.0, 5.0, 7.0)
SWEEP_PREVIOUS_INTERVALS = (1, 3, 7, 30)
SWEEP_QUALITIES = (0, 1, 2, 3)


PRESETS = {
    "balanced": {
        "type_all": {
            "success_ceiling": 0.82,
            "success_quality_weights": {1: 0.25, 2: 0.55, 3: 0.20}
        },
        "type_prompt": {
            "success_ceiling": 0.76,
            "success_quality_weights": {1: 0.35, 2: 0.50, 3: 0.15}
        },
        "click_prompt": {
            "success_ceiling": 0.88,
            "success_quality_weights": {1: 0.28, 2: 0.60, 3: 0.12}
        },
        "qcm": {
            "success_ceiling": 0.92,
            "success_quality_weights": {1: 0.36, 2: 0.56, 3: 0.08}
        }
    },
    "optimistic": {
        "type_all": {
            "success_ceiling": 0.88,
            "success_quality_weights": {1: 0.18, 2: 0.54, 3: 0.28}
        },
        "type_prompt": {
            "success_ceiling": 0.82,
            "success_quality_weights": {1: 0.25, 2: 0.52, 3: 0.23}
        },
        "click_prompt": {
            "success_ceiling": 0.92,
            "success_quality_weights": {1: 0.22, 2: 0.60, 3: 0.18}
        },
        "qcm": {
            "success_ceiling": 0.96,
            "success_quality_weights": {1: 0.30, 2: 0.58, 3: 0.12}
        }
    },
    "struggling": {
        "type_all": {
            "success_ceiling": 0.68,
            "success_quality_weights": {1: 0.38, 2: 0.48, 3: 0.14}
        },
        "type_prompt": {
            "success_ceiling": 0.60,
            "success_quality_weights": {1: 0.46, 2: 0.44, 3: 0.10}
        },
        "click_prompt": {
            "success_ceiling": 0.80,
            "success_quality_weights": {1: 0.34, 2: 0.56, 3: 0.10}
        },
        "qcm": {
            "success_ceiling": 0.86,
            "success_quality_weights": {1: 0.42, 2: 0.52, 3: 0.06}
        }
    }
}


@dataclass
class SimulationConfig:
    cards: int = 1000
    days: int = 365
    seed: int = 1
    out_dir: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent /
        "simulation_reports"
    )
    preset: str = "balanced"
    mode_mix: dict = field(default_factory=lambda: dict(DEFAULT_MODE_MIX))
    click_sizes: tuple = DEFAULT_CLICK_SIZES


@dataclass
class SimProgress:
    question_id: int
    stability: float
    difficulty: float
    reps: int
    lapses: int
    interval: int
    last_review: date | None
    next_review: date
    ideal_interval: int | None = None
    ideal_next_review: date | None = None
    fsrs_card: dict | None = None
    fsrs_version: str | None = None
    history: list = field(default_factory=list)


@dataclass
class SimCard:
    question_id: int
    mode: str
    context_count: int
    mode_difficulty: float
    progress: SimProgress


def rounded(value, places=4):
    if value is None:
        return None

    return round(float(value), places)


def clamp(value, lower, upper):
    return max(lower, min(upper, value))


def normalize_weights(weights):
    total = sum(weights.values())

    if total <= 0:
        raise ValueError("Weights must sum to a positive value")

    return {
        key: value / total
        for key, value in weights.items()
        if value > 0
    }


def parse_mode_mix(value):
    if not value:
        return dict(DEFAULT_MODE_MIX)

    weights = {}

    for part in value.split(","):
        if "=" not in part:
            raise ValueError("Mode mix entries must look like mode=weight")

        key, raw_weight = part.split("=", 1)
        key = key.strip()

        if key not in SIMULATION_MODES:
            raise ValueError(f"Unknown mode in mode mix: {key}")

        try:
            weights[key] = float(raw_weight)
        except ValueError as error:
            raise ValueError(f"Invalid weight for mode {key}") from error

    return normalize_weights(weights)


def parse_click_sizes(value):
    if not value:
        return DEFAULT_CLICK_SIZES

    sizes = []

    for part in value.split(","):
        try:
            size = int(part.strip())
        except ValueError as error:
            raise ValueError("Click sizes must be comma-separated integers") from error

        if size <= 0:
            raise ValueError("Click sizes must be positive")

        sizes.append(size)

    return tuple(sizes)


def weighted_choice(rng, weights):
    threshold = rng.random()
    cumulative = 0.0
    last_key = None

    for key, weight in weights.items():
        cumulative += weight
        last_key = key

        if threshold <= cumulative:
            return key

    return last_key


def mode_difficulty_for(mode, context_count=0):
    if mode == "qcm":
        return map_mode_difficulty("multiple_choice", context_count)

    return map_mode_difficulty(mode, context_count)


def make_progress(
    question_id,
    today,
    stability,
    difficulty,
    previous_interval,
    reps=4
):
    previous_interval = max(1, int(previous_interval))
    last_review = today - timedelta(days=previous_interval)

    return SimProgress(
        question_id=question_id,
        stability=float(stability),
        difficulty=float(difficulty),
        reps=reps,
        lapses=0,
        interval=previous_interval,
        last_review=last_review,
        next_review=today
    )


def ratio(adjusted, reference):
    if reference == 0:
        return 1.0 if adjusted == 0 else None

    return adjusted / reference


def run_interval_sweep(today=None):
    today = today or date(2026, 1, 1)
    rows = []
    question_id = 1

    mode_contexts = [
        ("type_all", 0),
        ("type_prompt", 0),
        ("qcm", 4)
    ] + [
        ("click_prompt", size)
        for size in DEFAULT_CLICK_SIZES
    ]

    for mode, context_count in mode_contexts:
        mode_difficulty = mode_difficulty_for(mode, context_count)

        for quality in SWEEP_QUALITIES:
            for stability in SWEEP_STABILITIES:
                for difficulty in SWEEP_DIFFICULTIES:
                    for previous_interval in SWEEP_PREVIOUS_INTERVALS:
                        progress = make_progress(
                            question_id,
                            today,
                            stability,
                            difficulty,
                            previous_interval
                        )
                        reference = update_progress(
                            progress,
                            quality,
                            today=today,
                            mode_difficulty=1.0,
                            enable_fuzzing=False
                        )
                        adjusted = update_progress(
                            progress,
                            quality,
                            today=today,
                            mode_difficulty=mode_difficulty,
                            enable_fuzzing=False
                        )
                        reference_interval = reference["interval"]
                        adjusted_interval = adjusted["interval"]

                        rows.append({
                            "mode": mode,
                            "context_count": context_count,
                            "quality": quality,
                            "start_stability": stability,
                            "start_difficulty": difficulty,
                            "previous_interval": previous_interval,
                            "mode_difficulty": rounded(mode_difficulty),
                            "reference_interval": reference_interval,
                            "adjusted_interval": adjusted_interval,
                            "interval_delta": (
                                adjusted_interval - reference_interval
                            ),
                            "interval_ratio": rounded(
                                ratio(adjusted_interval, reference_interval)
                            ),
                            "reference_stability": rounded(reference["stability"]),
                            "adjusted_stability": rounded(adjusted["stability"]),
                            "stability_delta_vs_reference": rounded(
                                adjusted["stability"] - reference["stability"]
                            ),
                            "reference_difficulty": rounded(reference["difficulty"]),
                            "adjusted_difficulty": rounded(adjusted["difficulty"]),
                            "difficulty_delta_vs_reference": rounded(
                                adjusted["difficulty"] - reference["difficulty"]
                            )
                        })
                        question_id += 1

    return rows


def sample_quality(rng, mode, retrievability, preset):
    mode_preset = PRESETS[preset][mode]
    memory = 0.72 if retrievability is None else retrievability
    success_probability = mode_preset["success_ceiling"] * (
        0.35 + (0.65 * memory)
    )
    success_probability = clamp(success_probability, 0.02, 0.99)

    if rng.random() > success_probability:
        return 0

    return weighted_choice(rng, mode_preset["success_quality_weights"])


def create_synthetic_deck(config, start_date):
    rng = random.Random(config.seed)
    deck = []

    for index in range(config.cards):
        mode = weighted_choice(rng, config.mode_mix)
        context_count = (
            rng.choice(config.click_sizes)
            if mode == "click_prompt"
            else 4 if mode == "qcm" else 0
        )
        initial_interval = rng.choice([1, 2, 3, 7, 14, 30, 60])
        days_since_review = rng.randint(1, max(1, initial_interval))
        due_offset = rng.randint(0, min(45, max(1, config.days // 3)))
        last_review = start_date - timedelta(days=days_since_review)
        next_review = start_date + timedelta(days=due_offset)
        progress_interval = max(1, (next_review - last_review).days)
        progress = SimProgress(
            question_id=index + 1,
            stability=round(rng.uniform(0.8, 18.0), 4),
            difficulty=round(rng.uniform(3.0, 8.0), 4),
            reps=rng.randint(1, 8),
            lapses=rng.randint(0, 2),
            interval=progress_interval,
            last_review=last_review,
            next_review=next_review
        )
        deck.append(SimCard(
            question_id=index + 1,
            mode=mode,
            context_count=context_count,
            mode_difficulty=mode_difficulty_for(mode, context_count),
            progress=progress
        ))

    return deck


def card_retrievability(progress, day):
    if not progress.last_review:
        return None

    scheduler = create_fsrs_scheduler(enable_fuzzing=False)
    card = fsrs_card_for_progress(progress, today=day)

    try:
        return scheduler.get_card_retrievability(
            card,
            current_datetime=review_datetime_for_date(day)
        )
    except (AssertionError, TypeError, ValueError):
        return None


def write_progress(progress, quality, scheduling, retrievability, mode, context_count):
    progress.stability = scheduling["stability"]
    progress.difficulty = scheduling["difficulty"]
    progress.reps = scheduling["reps"]
    progress.lapses = scheduling["lapses"]
    progress.interval = scheduling["interval"]
    progress.ideal_interval = scheduling.get("ideal_interval", scheduling["interval"])
    progress.last_review = scheduling["last_review"]
    progress.next_review = scheduling["next_review"]
    progress.ideal_next_review = scheduling.get(
        "ideal_next_review",
        scheduling["next_review"]
    )
    progress.fsrs_card = scheduling.get("fsrs_card")
    progress.fsrs_version = scheduling.get("fsrs_version")
    progress.history.append({
        "reviewed_on": progress.last_review.isoformat(),
        "quality": quality,
        "mode": mode,
        "context_count": context_count,
        "retrievability": rounded(retrievability),
        "stability": rounded(progress.stability),
        "difficulty": rounded(progress.difficulty),
        "interval": progress.interval,
        "next_review": progress.next_review.isoformat(),
        "mode_difficulty": scheduling.get("mode_difficulty")
    })


def future_daily_loads(deck, candidate_dates, exclude_ids):
    loads = {}
    type_loads = {}

    for card in deck:
        if card.question_id in exclude_ids:
            continue

        next_review = card.progress.next_review

        if next_review not in candidate_dates:
            continue

        loads[next_review] = loads.get(next_review, 0) + 1
        counts = type_loads.setdefault(next_review, {})
        counts[card.mode] = counts.get(card.mode, 0) + 1

    return loads, type_loads


def run_synthetic_deck(config, start_date=None):
    start_date = start_date or date(2026, 1, 1)
    rng = random.Random(config.seed + 1009)
    deck = create_synthetic_deck(config, start_date)
    daily_load = []
    review_rows = []

    for day_index in range(config.days):
        current_day = start_date + timedelta(days=day_index)
        due_cards = [
            card
            for card in deck
            if card.progress.next_review <= current_day
        ]
        schedulings = []
        review_context = []
        candidate_dates = set()

        for card in due_cards:
            retrievability = card_retrievability(card.progress, current_day)
            quality = sample_quality(
                rng,
                card.mode,
                retrievability,
                config.preset
            )
            scheduling = update_progress(
                card.progress,
                quality,
                today=current_day,
                mode_difficulty=card.mode_difficulty,
                enable_fuzzing=False
            )
            scheduling["type_q"] = card.mode
            schedulings.append(scheduling)
            review_context.append((card, quality, retrievability))
            candidate_dates.update(
                candidate_review_dates(
                    scheduling["last_review"],
                    scheduling["next_review"],
                    scheduling["interval"]
                )
            )

        if schedulings:
            exclude_ids = {
                card.question_id
                for card, _, _ in review_context
            }
            loads, type_loads = future_daily_loads(
                deck,
                candidate_dates,
                exclude_ids
            )
            schedulings = assign_smoothed_schedules(
                schedulings,
                loads,
                daily_type_loads=type_loads
            )

        for (card, quality, retrievability), scheduling in zip(
            review_context,
            schedulings
        ):
            write_progress(
                card.progress,
                quality,
                scheduling,
                retrievability,
                card.mode,
                card.context_count
            )
            review_rows.append({
                "card_id": card.question_id,
                "day_index": day_index,
                "date": current_day.isoformat(),
                "mode": card.mode,
                "context_count": card.context_count,
                "quality": quality,
                "retrievability": rounded(retrievability),
                "mode_difficulty": rounded(card.mode_difficulty),
                "interval": scheduling["interval"],
                "next_review": scheduling["next_review"].isoformat(),
                "stability": rounded(scheduling["stability"]),
                "difficulty": rounded(scheduling["difficulty"])
            })

        daily_load.append({
            "day_index": day_index,
            "date": current_day.isoformat(),
            "due_count": len(due_cards),
            "review_count": len(due_cards)
        })

    return {
        "deck": deck,
        "daily_load": daily_load,
        "reviews": review_rows
    }


def summarize_by_mode(reviews):
    by_mode = defaultdict(list)

    for review in reviews:
        by_mode[review["mode"]].append(review)

    rows = []

    for mode in SIMULATION_MODES:
        items = by_mode.get(mode, [])
        qualities = Counter(item["quality"] for item in items)
        retrievabilities = [
            item["retrievability"]
            for item in items
            if item["retrievability"] is not None
        ]
        intervals = [item["interval"] for item in items]
        difficulties = [item["mode_difficulty"] for item in items]

        rows.append({
            "mode": mode,
            "reviews": len(items),
            "again": qualities.get(0, 0),
            "hard": qualities.get(1, 0),
            "good": qualities.get(2, 0),
            "easy": qualities.get(3, 0),
            "success_rate": rounded(
                sum(1 for item in items if item["quality"] > 0) / len(items)
                if items else None
            ),
            "avg_interval": rounded(mean(intervals) if intervals else None),
            "avg_retrievability": rounded(
                mean(retrievabilities)
                if retrievabilities else None
            ),
            "avg_mode_difficulty": rounded(
                mean(difficulties)
                if difficulties else None
            )
        })

    return rows


def retrievability_histogram(reviews, bucket_count=10):
    buckets = [0] * bucket_count

    for review in reviews:
        value = review["retrievability"]

        if value is None:
            continue

        index = min(bucket_count - 1, int(value * bucket_count))
        buckets[index] += 1

    return [
        {
            "bucket": index,
            "label": f"{index / bucket_count:.1f}-{(index + 1) / bucket_count:.1f}",
            "count": count
        }
        for index, count in enumerate(buckets)
    ]


def build_outliers(interval_sweep, daily_load, reviews):
    outliers = []
    positive_sweep = [
        row
        for row in interval_sweep
        if row["quality"] > 0
    ]

    for row in sorted(positive_sweep, key=lambda item: item["adjusted_interval"])[:12]:
        outliers.append({
            "category": "short_interval",
            "label": f"{row['mode']} q{row['quality']}",
            "value": row["adjusted_interval"],
            "mode": row["mode"],
            "card_id": "",
            "day_index": "",
            "interval": row["adjusted_interval"],
            "extra": (
                f"ref={row['reference_interval']} "
                f"stability={row['start_stability']} "
                f"difficulty={row['start_difficulty']}"
            )
        })

    for row in sorted(
        positive_sweep,
        key=lambda item: item["adjusted_interval"],
        reverse=True
    )[:12]:
        outliers.append({
            "category": "long_interval",
            "label": f"{row['mode']} q{row['quality']}",
            "value": row["adjusted_interval"],
            "mode": row["mode"],
            "card_id": "",
            "day_index": "",
            "interval": row["adjusted_interval"],
            "extra": (
                f"ref={row['reference_interval']} "
                f"stability={row['start_stability']} "
                f"difficulty={row['start_difficulty']}"
            )
        })

    for row in sorted(
        interval_sweep,
        key=lambda item: abs(item["interval_delta"]),
        reverse=True
    )[:12]:
        outliers.append({
            "category": "largest_mode_delta",
            "label": f"{row['mode']} q{row['quality']}",
            "value": row["interval_delta"],
            "mode": row["mode"],
            "card_id": "",
            "day_index": "",
            "interval": row["adjusted_interval"],
            "extra": (
                f"ref={row['reference_interval']} "
                f"ratio={row['interval_ratio']}"
            )
        })

    for row in sorted(
        daily_load,
        key=lambda item: item["due_count"],
        reverse=True
    )[:12]:
        outliers.append({
            "category": "overloaded_day",
            "label": row["date"],
            "value": row["due_count"],
            "mode": "",
            "card_id": "",
            "day_index": row["day_index"],
            "interval": "",
            "extra": "daily due count"
        })

    low_retrievability = [
        row
        for row in reviews
        if row["retrievability"] is not None
    ]

    for row in sorted(
        low_retrievability,
        key=lambda item: item["retrievability"]
    )[:12]:
        outliers.append({
            "category": "low_retrievability_review",
            "label": row["date"],
            "value": row["retrievability"],
            "mode": row["mode"],
            "card_id": row["card_id"],
            "day_index": row["day_index"],
            "interval": row["interval"],
            "extra": f"quality={row['quality']}"
        })

    return outliers


def interval_heatmap(interval_sweep):
    grouped = defaultdict(list)

    for row in interval_sweep:
        grouped[(row["mode"], row["context_count"], row["quality"])].append(row)

    heatmap = []

    for mode, context_count in sorted({key[:2] for key in grouped}):
        row = {
            "mode": mode,
            "context_count": context_count,
            "qualities": {}
        }

        for quality in SWEEP_QUALITIES:
            items = grouped.get((mode, context_count, quality), [])
            ratios = [
                item["interval_ratio"]
                for item in items
                if item["interval_ratio"] is not None
            ]
            row["qualities"][quality] = rounded(
                mean(ratios)
                if ratios else None
            )

        heatmap.append(row)

    return heatmap


def svg_bar_chart(values, width=900, height=220):
    if not values:
        return "<svg></svg>"

    max_value = max(max(values), 1)
    bar_width = width / len(values)
    bars = []

    for index, value in enumerate(values):
        bar_height = (value / max_value) * (height - 28)
        x = index * bar_width
        y = height - bar_height - 18
        bars.append(
            f'<rect x="{x:.2f}" y="{y:.2f}" width="{max(1, bar_width - 1):.2f}" '
            f'height="{bar_height:.2f}" fill="#5b8def" />'
        )

    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="Daily due-count chart">{"".join(bars)}'
        f'<line x1="0" y1="{height - 18}" x2="{width}" y2="{height - 18}" '
        f'stroke="#334155" />'
        f'<text x="0" y="14" fill="#475569" font-size="12">'
        f'max {max_value} due</text></svg>'
    )


def svg_histogram(histogram, width=620, height=220):
    max_count = max((item["count"] for item in histogram), default=1) or 1
    bar_width = width / len(histogram)
    bars = []

    for index, item in enumerate(histogram):
        bar_height = (item["count"] / max_count) * (height - 46)
        x = index * bar_width
        y = height - bar_height - 28
        bars.append(
            f'<rect x="{x + 4:.2f}" y="{y:.2f}" width="{bar_width - 8:.2f}" '
            f'height="{bar_height:.2f}" fill="#22c55e" />'
            f'<text x="{x + (bar_width / 2):.2f}" y="{height - 8}" '
            f'fill="#475569" font-size="10" text-anchor="middle">'
            f'{index / len(histogram):.1f}</text>'
        )

    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="Retrievability histogram">{"".join(bars)}'
        f'<text x="0" y="14" fill="#475569" font-size="12">'
        f'max {max_count} reviews</text></svg>'
    )


def heat_color(value):
    if value is None:
        return "#e2e8f0"

    value = clamp(value, 0.5, 1.5)

    if value < 1:
        intensity = int(255 - ((1 - value) / 0.5 * 70))
        return f"rgb(255,{intensity},{intensity})"

    intensity = int(255 - ((value - 1) / 0.5 * 70))
    return f"rgb({intensity},255,{intensity})"


def render_table(headers, rows):
    header_html = "".join(f"<th>{html.escape(str(header))}</th>" for header in headers)
    row_html = []

    for row in rows:
        cells = "".join(
            f"<td>{html.escape(str(row.get(header, '')))}</td>"
            for header in headers
        )
        row_html.append(f"<tr>{cells}</tr>")

    return f"<table><thead><tr>{header_html}</tr></thead><tbody>{''.join(row_html)}</tbody></table>"


def render_heatmap(heatmap):
    rows = []

    for item in heatmap:
        label = item["mode"]

        if item["context_count"]:
            label = f"{label} n={item['context_count']}"

        cells = [
            f"<td>{html.escape(label)}</td>"
        ]

        for quality in SWEEP_QUALITIES:
            value = item["qualities"][quality]
            display = "" if value is None else f"{value:.2f}"
            cells.append(
                f'<td style="background:{heat_color(value)}">{display}</td>'
            )

        rows.append(f"<tr>{''.join(cells)}</tr>")

    return (
        "<table><thead><tr><th>Mode</th><th>Q0</th><th>Q1</th>"
        "<th>Q2</th><th>Q3</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
    )


def render_html_report(summary, interval_sweep, daily_load, outliers):
    daily_values = [row["due_count"] for row in daily_load]
    histogram = summary["retrievability_histogram"]
    heatmap = interval_heatmap(interval_sweep)
    mode_rows = summary["mode_summary"]
    outlier_rows = outliers[:60]
    config_json = json.dumps(summary["config"], indent=2, sort_keys=True)

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Scheduler Simulation Report</title>
  <style>
    body {{
      background: #f8fafc;
      color: #0f172a;
      font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 24px;
    }}
    h1, h2 {{ margin: 0 0 12px; }}
    section {{
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin: 0 0 18px;
      padding: 18px;
    }}
    table {{
      border-collapse: collapse;
      width: 100%;
    }}
    th, td {{
      border-bottom: 1px solid #e2e8f0;
      padding: 7px 8px;
      text-align: left;
      white-space: nowrap;
    }}
    th {{ background: #f1f5f9; }}
    pre {{
      background: #0f172a;
      border-radius: 8px;
      color: #e2e8f0;
      overflow-x: auto;
      padding: 14px;
    }}
    .grid {{
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    }}
    .metric {{
      display: inline-block;
      margin-right: 18px;
    }}
    .metric strong {{
      display: block;
      font-size: 22px;
    }}
  </style>
</head>
<body>
  <h1>Scheduler Simulation Report</h1>
  <section>
    <span class="metric"><strong>{summary["total_reviews"]}</strong>reviews</span>
    <span class="metric"><strong>{summary["max_daily_due"]}</strong>max daily due</span>
    <span class="metric"><strong>{summary["avg_daily_due"]:.2f}</strong>avg daily due</span>
    <span class="metric"><strong>{summary["avg_retrievability"]}</strong>avg retrievability</span>
  </section>
  <section>
    <h2>Daily Due Count</h2>
    {svg_bar_chart(daily_values)}
  </section>
  <div class="grid">
    <section>
      <h2>Interval Ratio Heatmap</h2>
      <p>Average adjusted interval divided by type_all reference. Red is shorter, green is longer.</p>
      {render_heatmap(heatmap)}
    </section>
    <section>
      <h2>Retrievability At Review</h2>
      {svg_histogram(histogram)}
    </section>
  </div>
  <section>
    <h2>Mode Summary</h2>
    {render_table([
        "mode", "reviews", "again", "hard", "good", "easy",
        "success_rate", "avg_interval", "avg_retrievability",
        "avg_mode_difficulty"
    ], mode_rows)}
  </section>
  <section>
    <h2>Outliers</h2>
    {render_table([
        "category", "label", "value", "mode", "card_id",
        "day_index", "interval", "extra"
    ], outlier_rows)}
  </section>
  <section>
    <h2>Config</h2>
    <pre>{html.escape(config_json)}</pre>
  </section>
</body>
</html>
"""


def write_csv(path, rows, fieldnames):
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def build_summary(config, synthetic_result):
    reviews = synthetic_result["reviews"]
    daily_load = synthetic_result["daily_load"]
    retrievabilities = [
        review["retrievability"]
        for review in reviews
        if review["retrievability"] is not None
    ]

    return {
        "config": {
            "cards": config.cards,
            "days": config.days,
            "seed": config.seed,
            "preset": config.preset,
            "mode_mix": config.mode_mix,
            "click_sizes": list(config.click_sizes),
            "fuzzing": False
        },
        "total_reviews": len(reviews),
        "max_daily_due": max(
            (row["due_count"] for row in daily_load),
            default=0
        ),
        "avg_daily_due": rounded(
            mean(row["due_count"] for row in daily_load)
            if daily_load else 0,
            2
        ),
        "avg_retrievability": rounded(
            mean(retrievabilities)
            if retrievabilities else None
        ),
        "mode_summary": summarize_by_mode(reviews),
        "retrievability_histogram": retrievability_histogram(reviews)
    }


def run_simulation(config):
    interval_sweep = run_interval_sweep()
    synthetic_result = run_synthetic_deck(config)
    summary = build_summary(config, synthetic_result)
    outliers = build_outliers(
        interval_sweep,
        synthetic_result["daily_load"],
        synthetic_result["reviews"]
    )

    return {
        "summary": summary,
        "interval_sweep": interval_sweep,
        "daily_load": synthetic_result["daily_load"],
        "outliers": outliers
    }


def write_report(config, result):
    out_dir = Path(config.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    summary_path = out_dir / "summary.json"
    interval_path = out_dir / "interval_sweep.csv"
    daily_path = out_dir / "daily_load.csv"
    outliers_path = out_dir / "outliers.csv"
    html_path = out_dir / "report.html"

    with summary_path.open("w", encoding="utf-8") as handle:
        json.dump(result["summary"], handle, indent=2, sort_keys=True)

    write_csv(
        interval_path,
        result["interval_sweep"],
        [
            "mode", "context_count", "quality", "start_stability",
            "start_difficulty", "previous_interval", "mode_difficulty",
            "reference_interval", "adjusted_interval", "interval_delta",
            "interval_ratio", "reference_stability", "adjusted_stability",
            "stability_delta_vs_reference", "reference_difficulty",
            "adjusted_difficulty", "difficulty_delta_vs_reference"
        ]
    )
    write_csv(
        daily_path,
        result["daily_load"],
        ["day_index", "date", "due_count", "review_count"]
    )
    write_csv(
        outliers_path,
        result["outliers"],
        [
            "category", "label", "value", "mode", "card_id",
            "day_index", "interval", "extra"
        ]
    )

    html_report = render_html_report(
        result["summary"],
        result["interval_sweep"],
        result["daily_load"],
        result["outliers"]
    )
    html_path.write_text(html_report, encoding="utf-8")

    return {
        "html": html_path,
        "summary": summary_path,
        "interval_sweep": interval_path,
        "daily_load": daily_path,
        "outliers": outliers_path
    }


def build_parser():
    default_out = Path(__file__).resolve().parent / "simulation_reports"
    parser = argparse.ArgumentParser(
        description="Simulate synthetic scheduler behavior without touching the DB"
    )
    parser.add_argument("--cards", type=int, default=1000)
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--out-dir", default=str(default_out))
    parser.add_argument("--preset", default="balanced", choices=sorted(PRESETS))
    parser.add_argument(
        "--mode-mix",
        default=None,
        help="Comma-separated weights, e.g. type_all=0.25,type_prompt=0.25"
    )
    parser.add_argument(
        "--click-sizes",
        default=None,
        help="Comma-separated click_prompt group sizes"
    )

    return parser


def config_from_args(args, parser=None):
    if args.cards <= 0:
        raise ValueError("--cards must be positive")

    if args.days <= 0:
        raise ValueError("--days must be positive")

    try:
        mode_mix = parse_mode_mix(args.mode_mix)
        click_sizes = parse_click_sizes(args.click_sizes)
    except ValueError as error:
        if parser:
            parser.error(str(error))
        raise

    return SimulationConfig(
        cards=args.cards,
        days=args.days,
        seed=args.seed,
        out_dir=Path(args.out_dir),
        preset=args.preset,
        mode_mix=mode_mix,
        click_sizes=click_sizes
    )


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        config = config_from_args(args, parser=parser)
    except ValueError as error:
        parser.error(str(error))

    result = run_simulation(config)
    paths = write_report(config, result)

    print(f"Simulation report written to {paths['html']}")
    print(f"Summary JSON: {paths['summary']}")
    print(f"Interval sweep CSV: {paths['interval_sweep']}")
    print(f"Daily load CSV: {paths['daily_load']}")
    print(f"Outliers CSV: {paths['outliers']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
