import json
from datetime import date, timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import AppSetting, Progress, Question, QuestionGroup
from app.routers.review import answer_map
from app.schemas import MapAnswerRequest
from app.scheduler import (
    easy_mode_interval,
    preview_intervals,
    success_reward_factor,
    update_progress
)
from app.services.image_modes import image_mode_difficulty
from app.services.map_modes import map_mode_difficulty
from app.services.mode_difficulty import click_prompt_base_difficulty
from app.services.review import get_review_items
from app.services.scheduler_tuning import (
    CalibrationSample,
    HistoryEvent,
    TuningParams,
    brier_score,
    choose_candidate,
    mode_difficulty_for_event,
    replay_progress_for_samples,
    sorted_history_events,
    tune_scheduler
)
from app.services.settings import (
    DEFAULT_SCHEDULER_TUNING_SETTINGS,
    SCHEDULER_TUNING_SETTINGS_KEY,
    save_scheduler_tuning_settings
)
from tune_scheduler import main as tune_scheduler_main


def memory_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return Session()


def mode_history(source_mode, source_quality, validation_quality, start, gap=40):
    return [
        {
            "reviewed_on": start.isoformat(),
            "quality": source_quality,
            "raw_quality": source_quality,
            "map_mode": source_mode,
            "map_context_count": 4
        },
        {
            "reviewed_on": (start + timedelta(days=gap)).isoformat(),
            "quality": validation_quality,
            "raw_quality": validation_quality,
            "map_mode": "type_all",
            "map_context_count": 4
        }
    ]


def progress_with_history(question_id, history):
    return Progress(question_id=question_id, history=history)


def add_question_with_history(db, question_id, history):
    question = Question(
        id=question_id,
        type_q="map",
        question=f"Question {question_id}",
        answer=f"Answer {question_id}",
        tags=[],
        data={}
    )
    progress = Progress(
        question_id=question_id,
        stability=1.0,
        difficulty=5.0,
        reps=len(history),
        lapses=sum(1 for entry in history if entry.get("quality") == 0),
        interval=0,
        next_review=date.today(),
        history=history
    )
    db.add(question)
    db.add(progress)
    return question


def seed_type_prompt_success_history(db, count=40):
    start = date(2026, 1, 1)

    for index in range(count):
        add_question_with_history(
            db,
            index + 1,
            mode_history(
                "type_prompt",
                3,
                3,
                start + timedelta(days=index),
                gap=60
            )
        )


def test_history_extraction_pairs_non_type_all_with_future_type_all():
    progress = progress_with_history(
        1,
        mode_history("multiple_choice", 3, 0, date(2026, 1, 1), gap=10)
    )

    samples = replay_progress_for_samples(progress, TuningParams())

    assert len(samples) == 1
    assert samples[0].source_mode == "multiple_choice"
    assert samples[0].observed_success == 0
    assert 0 <= samples[0].predicted_retrievability <= 1


def test_history_extraction_skips_incomplete_and_same_day_retries():
    progress = progress_with_history(
        1,
        [
            {"quality": 3, "map_mode": "multiple_choice"},
            {
                "reviewed_on": "2026-01-01",
                "quality": 3,
                "map_mode": "multiple_choice",
                "map_context_count": 4
            },
            {
                "reviewed_on": "2026-01-01",
                "quality": 0,
                "map_mode": "type_all",
                "map_context_count": 4
            }
        ]
    )

    assert len(sorted_history_events(progress)) == 2
    assert replay_progress_for_samples(progress, TuningParams()) == []


def test_brier_score_prefers_perfect_predictions():
    good = [
        CalibrationSample(1, 0, "type_prompt", date.today(), 0.95, 1),
        CalibrationSample(2, 0, "type_prompt", date.today(), 0.05, 0)
    ]
    bad = [
        CalibrationSample(1, 0, "type_prompt", date.today(), 0.05, 1),
        CalibrationSample(2, 0, "type_prompt", date.today(), 0.95, 0)
    ]

    assert brier_score(good) < brier_score(bad)


def test_type_all_reference_is_immutable():
    event = sorted_history_events(progress_with_history(
        1,
        [{
            "reviewed_on": "2026-01-01",
            "quality": 3,
            "map_mode": "type_all"
        }]
    ))[0]

    assert mode_difficulty_for_event(
        event,
        TuningParams(type_prompt_difficulty=1.35)
    ) == 1.0


def test_overrewarded_qcm_candidate_lowers_multiple_choice():
    rows = [
        progress_with_history(
            index + 1,
            mode_history(
                "multiple_choice",
                3,
                0,
                date(2026, 1, 1) + timedelta(days=index),
                gap=60
            )
        )
        for index in range(40)
    ]

    result = choose_candidate(
        rows,
        TuningParams(),
        min_total_pairs=10,
        min_mode_pairs=5
    )

    assert result["candidate"]["changed_param"] == "multiple_choice_difficulty"
    assert (
        result["candidate"]["params"].multiple_choice_difficulty <
        result["current"]["params"].multiple_choice_difficulty
    )


def test_underrewarded_type_prompt_candidate_is_accepted():
    rows = [
        progress_with_history(
            index + 1,
            mode_history(
                "type_prompt",
                3,
                3,
                date(2026, 1, 1) + timedelta(days=index),
                gap=60
            )
        )
        for index in range(40)
    ]

    result = choose_candidate(
        rows,
        TuningParams(),
        min_total_pairs=10,
        min_mode_pairs=5
    )

    assert result["accepted"]
    assert result["candidate"]["changed_param"] == "type_prompt_difficulty"
    assert (
        result["candidate"]["params"].type_prompt_difficulty >
        result["current"]["params"].type_prompt_difficulty
    )


def test_insufficient_samples_do_not_apply(tmp_path):
    db = memory_session()
    seed_type_prompt_success_history(db, count=5)

    result = tune_scheduler(
        db,
        apply_enabled=True,
        min_total_pairs=100,
        min_mode_pairs=25,
        out_dir=tmp_path
    )

    assert not result["summary"]["applied"]
    assert result["summary"]["reason"] == "insufficient_total_pairs"
    assert (
        db.query(AppSetting)
        .filter(AppSetting.key == SCHEDULER_TUNING_SETTINGS_KEY)
        .first()
    ) is None
    db.close()


def test_worse_validation_score_does_not_apply(tmp_path):
    db = memory_session()
    start = date(2026, 1, 1)

    for index in range(70):
        add_question_with_history(
            db,
            index + 1,
            mode_history(
                "multiple_choice",
                3,
                0,
                start + timedelta(days=index),
                gap=40
            )
        )

    for index in range(70, 100):
        add_question_with_history(
            db,
            index + 1,
            mode_history(
                "multiple_choice",
                3,
                3,
                start + timedelta(days=200 + index),
                gap=40
            )
        )

    result = tune_scheduler(
        db,
        apply_enabled=True,
        min_total_pairs=10,
        min_mode_pairs=5,
        out_dir=tmp_path
    )

    assert not result["summary"]["applied"]
    assert result["summary"]["validation_improvement"] < 0
    db.close()


def test_easy_mode_scales_whole_interval_on_correct_answer():
    # An established card that FSRS would push well past its current interval.
    progress = Progress(
        question_id=1,
        stability=20.0,
        difficulty=5.0,
        reps=5,
        lapses=0,
        interval=10,
        last_review=date.today() - timedelta(days=10),
        next_review=date.today(),
        history=[]
    )

    base = update_progress(
        progress, 2, mode_difficulty=1.0, enable_fuzzing=False
    )["interval"]
    easy = update_progress(
        progress, 2, mode_difficulty=0.5, enable_fuzzing=False
    )["interval"]
    hard = update_progress(
        progress, 2, mode_difficulty=1.15, enable_fuzzing=False
    )["interval"]

    # Sanity: the correct answer really does push the card further out.
    assert base > progress.interval

    # Easy mode scales the WHOLE interval (not just its growth), so it lands
    # strictly sooner than the neutral FSRS interval.
    assert easy == easy_mode_interval(base, success_reward_factor(0.5))
    assert easy < base

    # It is also sooner than the old growth-only dampening would have given.
    previous = progress.interval
    old_growth_dampened = previous + round((base - previous) * 0.75)
    assert easy < old_growth_dampened

    # Hard mode still only extends the growth and never lands sooner than base.
    assert hard >= base


def test_above_reference_difficulty_rewards_and_forgives_in_lockstep():
    # Characterization for modes priced ABOVE type_all = 1.0. Nothing shipped
    # there until sequence recitation: the highest production value is 1.05 and
    # the highest previously under test is 1.15. These numbers are what a mode
    # author is signing up for, so they are pinned rather than described.
    def fresh():
        return Progress(
            question_id=1,
            stability=20.0,
            difficulty=5.0,
            reps=5,
            lapses=0,
            interval=10,
            last_review=date.today() - timedelta(days=10),
            next_review=date.today(),
            history=[]
        )

    intervals = {
        difficulty: update_progress(
            fresh(), 2, mode_difficulty=difficulty, enable_fuzzing=False
        )["interval"]
        for difficulty in [1.0, 1.2, 1.4]
    }
    lapsed = {
        difficulty: update_progress(
            fresh(), 0, mode_difficulty=difficulty, enable_fuzzing=False
        )["stability"]
        for difficulty in [1.0, 1.2, 1.4]
    }

    assert intervals == {1.0: 43, 1.2: 50, 1.4: 57}

    # The catch a mode author is most likely to miss: a hard mode does not only
    # earn a longer interval on success, it also SOFTENS the lapse. At 1.4 a
    # failed card keeps nearly twice the stability of a failed reference-mode
    # card, so the mode is rewarded twice and punished less.
    assert round(lapsed[1.2] / lapsed[1.0], 2) == 1.48
    assert round(lapsed[1.4] / lapsed[1.0], 2) == 1.96

    # The reward saturates: MAX_SUCCESS_REWARD_FACTOR silently caps at 1.5, so
    # pricing a mode above that buys nothing on success while still discounting
    # every failure.
    assert success_reward_factor(1.6) == success_reward_factor(1.5)


def test_click_prompt_difficulty_models_shrinking_pool():
    # Re-anchored curve tracks the AVERAGE (shrinking) pool, so it is lower than
    # the old 0.95 - 0.55/sqrt(N) at every pool size, and both formula sites
    # (map serve, scheduler replay) agree for a given pool size.
    expected = {5: 0.5509, 9: 0.65, 16: 0.7225, 30: 0.7812}
    tuning = DEFAULT_SCHEDULER_TUNING_SETTINGS

    for n, value in expected.items():
        assert abs(click_prompt_base_difficulty(n) - value) < 0.001
        assert click_prompt_base_difficulty(n) < 0.95 - (0.55 / (n ** 0.5))

        served_map = map_mode_difficulty("click_prompt", context_count=n, tuning=tuning)
        replayed = mode_difficulty_for_event(
            HistoryEvent(
                question_id=1,
                index=0,
                reviewed_on=date.today(),
                mode="click_prompt",
                quality=2,
                context_count=n
            ),
            TuningParams()
        )
        assert abs(served_map - replayed) < 1e-9


def test_mode_difficulty_defaults_match_retune():
    tuning = DEFAULT_SCHEDULER_TUNING_SETTINGS

    assert map_mode_difficulty("multiple_choice", 20, tuning=tuning) == 0.55
    assert image_mode_difficulty("multiple_choice_label", 20, tuning=tuning) == 0.55
    assert map_mode_difficulty("type_prompt", 20, tuning=tuning) == 1.05
    assert image_mode_difficulty("type_prompt", 20, tuning=tuning) == 1.05


def test_click_prompt_correct_answer_schedules_sooner_than_old_curve():
    n = 9
    new_difficulty = map_mode_difficulty(
        "click_prompt", context_count=n, tuning=DEFAULT_SCHEDULER_TUNING_SETTINGS
    )
    old_difficulty = 0.95 - (0.55 / (n ** 0.5))

    def interval_for(difficulty):
        progress = Progress(
            question_id=1,
            stability=20.0,
            difficulty=5.0,
            reps=5,
            lapses=0,
            interval=10,
            last_review=date.today() - timedelta(days=10),
            next_review=date.today(),
            history=[]
        )
        return update_progress(
            progress, 2, mode_difficulty=difficulty, enable_fuzzing=False
        )["interval"]

    assert new_difficulty < old_difficulty
    assert interval_for(new_difficulty) < interval_for(old_difficulty)


def test_answer_scheduling_uses_active_tuning():
    db = memory_session()
    db.add(Question(
        id=1,
        type_q="map",
        question="Map zone",
        answer="Zone",
        tags=[],
        data={"code": "z"}
    ))
    save_scheduler_tuning_settings(
        db,
        {
            "multiple_choice_difficulty": 0.3,
            "easy_reward_floor": 0.35
        }
    )

    answer_map(
        MapAnswerRequest(items={1: 3}, mode="multiple_choice"),
        db=db
    )
    progress = db.query(Progress).filter(Progress.question_id == 1).first()

    assert progress.history[-1]["mode_difficulty"] == 0.3
    assert abs(progress.history[-1]["mode_reward_factor"] - 0.545) < 0.0001
    db.close()


def test_projected_intervals_use_active_tuning():
    db = memory_session()
    group = QuestionGroup(
        id=1,
        type_group="map",
        name="Map",
        media=None,
        data={}
    )
    question = Question(
        id=1,
        type_q="map",
        question="Map zone",
        answer="Zone",
        tags=[],
        data={"code": "z"},
        group=group
    )
    progress = Progress(
        question_id=1,
        stability=1.0,
        difficulty=7.0,
        reps=1,
        lapses=0,
        interval=0,
        next_review=date.today(),
        history=[]
    )
    db.add(group)
    db.add(question)
    db.add(progress)

    for index in range(2, 6):
        db.add(Question(
            id=index,
            type_q="map",
            question=f"Map zone {index}",
            answer=f"Zone {index}",
            tags=[],
            data={"code": f"z{index}"},
            group=group
        ))
        db.add(Progress(
            question_id=index,
            stability=1.0,
            difficulty=5.0,
            reps=1,
            lapses=0,
            interval=0,
            next_review=date.today() + timedelta(days=1),
            history=[]
        ))

    save_scheduler_tuning_settings(
        db,
        {"multiple_choice_difficulty": 0.3}
    )

    with patch("app.services.mode_selection.random.random", return_value=0):
        review = get_review_items(db)

    map_group = next(item for item in review if item["type_q"] == "map")
    projected = map_group["items"][0]["projected_intervals"]
    expected = preview_intervals(
        progress,
        mode_difficulty=0.3,
        scheduler_tuning={
            "type_prompt_difficulty": 1.15,
            "multiple_choice_difficulty": 0.3,
            "click_prompt_bias": 0.0,
            "easy_reward_floor": 0.3,
            "failure_penalty_power": 1.0
        }
    )

    assert map_group["mode"] == "multiple_choice"
    assert projected == expected
    db.close()


def test_existing_schedules_are_not_rewritten_when_settings_change():
    db = memory_session()
    original_next_review = date(2026, 2, 1)
    db.add(Question(
        id=1,
        type_q="map",
        question="Map zone",
        answer="Zone",
        tags=[],
        data={"code": "z"}
    ))
    db.add(Progress(
        question_id=1,
        stability=1.0,
        difficulty=5.0,
        reps=1,
        lapses=0,
        interval=10,
        next_review=original_next_review,
        history=[]
    ))

    save_scheduler_tuning_settings(
        db,
        {"multiple_choice_difficulty": 0.3}
    )

    progress = db.query(Progress).filter(Progress.question_id == 1).first()

    assert progress.next_review == original_next_review
    db.close()


def test_cli_dry_run_writes_reports_only(tmp_path):
    db = memory_session()
    seed_type_prompt_success_history(db, count=40)
    db.commit()
    Session = sessionmaker(bind=db.get_bind())

    result = tune_scheduler_main([
        "--dry-run",
        "--min-total-pairs",
        "10",
        "--min-mode-pairs",
        "5",
        "--out-dir",
        str(tmp_path)
    ], session_factory=Session)

    assert result == 0
    assert {
        "summary.json",
        "calibration_by_mode.csv",
        "candidate_scores.csv",
        "report.html"
    } == {path.name for path in tmp_path.iterdir()}

    summary = json.loads((tmp_path / "summary.json").read_text())
    assert summary["accepted"]
    assert not summary["applied"]
    assert (
        db.query(AppSetting)
        .filter(AppSetting.key == SCHEDULER_TUNING_SETTINGS_KEY)
        .first()
    ) is None
    db.close()


def test_cli_apply_writes_scheduler_tuning_when_gates_pass(tmp_path):
    database_file = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{database_file.as_posix()}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    seed_type_prompt_success_history(db, count=40)
    db.commit()
    db.close()

    result = tune_scheduler_main([
        "--apply",
        "--min-total-pairs",
        "10",
        "--min-mode-pairs",
        "5",
        "--out-dir",
        str(tmp_path / "reports")
    ], session_factory=Session)

    db = Session()
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == SCHEDULER_TUNING_SETTINGS_KEY)
        .first()
    )

    assert result == 0
    assert setting is not None
    assert setting.value["type_prompt_difficulty"] > 1.05
    db.close()
