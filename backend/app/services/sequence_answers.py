"""Authoritative grading and optional scheduling for sequence presentations."""

from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Progress, Question, QuestionGroup
from ..serializers import serialize_progress
from .collections import sync_generated_hard_collection
from .progress import (
    apply_scheduling_batch,
    create_initial_progress,
    progress_has_started
)
from .sequence import (
    dense_positions,
    grade_sequence_ordering,
    grade_sequence_position,
    reconcile_sequence_quality
)
from .sequence_modes import (
    DEFAULT_SEQUENCE_MODE,
    SEQUENCE_MODE_RECITE,
    SEQUENCE_MODE_REORDER,
    normalize_sequence_mode,
    sequence_mode_difficulty,
    sequence_review_goal
)
from .settings import load_scheduler_tuning_settings
from .answer_events import sequence_answer_event


def _bad_request(message):
    raise HTTPException(status_code=400, detail=message)


def _normalize_context_count(value):
    if value is None:
        return None

    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def _load_sequence_group(db, group_id):
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if group is None:
        raise HTTPException(status_code=404, detail="Sequence group not found")
    if group.type_group != "sequence":
        _bad_request("Group is not a sequence group")

    questions = (
        db.query(Question)
        .options(joinedload(Question.progress))
        .filter(
            Question.group_id == group_id,
            Question.type_q == "sequence"
        )
        .all()
    )

    return group, questions


def _validated_rail(data, mode, positions):
    rail = [
        {
            "question_id": slot.question_id,
            "position": slot.position,
            "kind": slot.kind
        }
        for slot in (data.rail or [])
    ]
    rail_positions = [slot["position"] for slot in rail]
    rail_ids = [slot["question_id"] for slot in rail]
    valid_positions = set(positions.values())

    if len(rail_positions) != len(set(rail_positions)):
        _bad_request("Sequence rail positions must be unique")
    if len(rail_ids) != len(set(rail_ids)):
        _bad_request("Sequence rail items must be unique")
    if rail_positions != sorted(rail_positions):
        _bad_request("Sequence rail must preserve the served order")
    if any(position not in valid_positions for position in rail_positions):
        _bad_request("Sequence rail contains a position outside the group")
    if any(question_id not in positions for question_id in rail_ids):
        _bad_request("Sequence rail contains an item outside the group")
    if any(
        positions[slot["question_id"]] != slot["position"]
        for slot in rail
    ):
        _bad_request("Sequence rail no longer matches the group order")

    submitted_ids = set(data.items)
    expected_blank_positions = {
        positions[question_id]
        for question_id in submitted_ids
    }
    actual_blank_positions = {
        slot["position"]
        for slot in rail
        if slot["kind"] == "blank"
    }

    if rail and actual_blank_positions != expected_blank_positions:
        _bad_request("Sequence rail blanks do not match the submitted items")
    if mode == SEQUENCE_MODE_REORDER and not rail:
        _bad_request("Reorder answers require the served rail")

    return rail


def _validate_ids(ids, siblings, label):
    ids = list(ids or [])

    if len(ids) != len(set(ids)):
        _bad_request(f"{label} must not contain duplicates")

    missing = [question_id for question_id in ids if question_id not in siblings]

    if missing:
        _bad_request(f"{label} are outside the submitted sequence group: {missing}")

    return ids


def _validate_recitation(data, siblings, positions):
    target_ids = _validate_ids(data.target_ids, siblings, "Recitation targets")
    scheduled_ids = _validate_ids(
        data.scheduled_ids,
        siblings,
        "Scheduled recitation items"
    )

    if not scheduled_ids:
        _bad_request("A recitation presentation requires scheduled items")
    if any(question_id not in target_ids for question_id in scheduled_ids):
        _bad_request("Scheduled recitation items must be presentation targets")
    scheduled_set = set(scheduled_ids)
    if scheduled_ids != [
        question_id
        for question_id in target_ids
        if question_id in scheduled_set
    ]:
        _bad_request("Scheduled recitation items must preserve target order")

    expected_positions = list(
        range(data.run_start + 1, data.run_start + len(target_ids) + 1)
    )
    actual_positions = [positions[question_id] for question_id in target_ids]

    if actual_positions != expected_positions:
        _bad_request("Recitation targets must be one current contiguous segment")

    for question_id in target_ids:
        if (
            question_id not in scheduled_ids and
            not progress_has_started(siblings[question_id].progress)
        ):
            _bad_request("Recitation cannot expose an unstarted context item")

    run = list(data.run or [])

    if len(run) > len(target_ids):
        _bad_request("Recitation run is longer than its presentation")

    for item in run:
        if item.question_id is not None and item.question_id not in siblings:
            _bad_request("Recitation answer resolves outside the submitted group")

    mismatch_index = next(
        (
            index
            for index, item in enumerate(run)
            if item.question_id != target_ids[index]
        ),
        None
    )

    if mismatch_index is not None:
        if data.stop_reason != "wrong_answer" or len(run) != mismatch_index + 1:
            _bad_request("A wrong recitation must stop at its first mismatch")
    elif len(run) < len(target_ids):
        if data.stop_reason != "declared_stall":
            _bad_request("An incomplete correct run must be a declared stall")
    elif data.stop_reason != "completed":
        _bad_request("A complete recitation must use the completed stop reason")

    return target_ids, set(scheduled_ids), mismatch_index


def _due_or_new(question, today):
    progress = question.progress

    return (
        not progress_has_started(progress) or
        progress.next_review is None or
        progress.next_review <= today
    )


def _grade_recitation(data, siblings, positions):
    target_ids, scheduled_ids, mismatch_index = _validate_recitation(
        data,
        siblings,
        positions
    )
    run = list(data.run or [])
    stall_index = mismatch_index

    if stall_index is None and len(run) < len(target_ids):
        stall_index = len(run)

    rows = []

    for index, question_id in enumerate(target_ids):
        if stall_index is not None and index > stall_index:
            rows.append({
                "question_id": question_id,
                "quality": None,
                "auto_quality": None,
                "distance": None,
                "guessed_position": None,
                "status": "unattempted",
                "stall": False,
                "scheduled": question_id in scheduled_ids
            })
            continue

        is_stall = stall_index == index
        rows.append({
            "question_id": question_id,
            "quality": 0 if is_stall else 2,
            "auto_quality": 0 if is_stall else 2,
            "distance": None,
            "guessed_position": None,
            "status": "graded",
            "stall": is_stall,
            "scheduled": question_id in scheduled_ids
        })

    stall_id = target_ids[stall_index] if stall_index is not None else None

    return rows, stall_id, scheduled_ids


def _grade_placements(data, mode, positions, rail, by_position):
    guessed = {
        question_id: guess.position
        for question_id, guess in data.items.items()
    }
    valid_positions = set(positions.values())

    if any(
        position is not None and position not in valid_positions
        for position in guessed.values()
    ):
        _bad_request("A sequence answer contains a position outside the group")

    if mode == SEQUENCE_MODE_REORDER:
        placed_positions = [
            position
            for position in guessed.values()
            if position is not None
        ]
        if len(placed_positions) != len(set(placed_positions)):
            _bad_request("Reorder placements must use each position once")
        placed_by_position = {
            position: question_id
            for question_id, position in guessed.items()
            if position is not None
        }
        blanks = {
            slot["position"]
            for slot in rail
            if slot["kind"] == "blank"
        }
        if set(placed_positions) != blanks:
            _bad_request("Reorder placements must fill the served blank slots")
        true_order = [by_position[slot["position"]] for slot in rail]
        produced_order = [
            placed_by_position.get(slot["position"])
            if slot["position"] in blanks
            else by_position[slot["position"]]
            for slot in rail
        ]
        grades = grade_sequence_ordering(
            true_order,
            [item for item in produced_order if item is not None],
            list(data.items.keys())
        )

        for question_id, grade in grades.items():
            grade["guessed_position"] = guessed.get(question_id)

        return grades

    grades = {}

    for question_id, position in guessed.items():
        grade = grade_sequence_position(positions.get(question_id), position)
        grade["guessed_position"] = position
        grades[question_id] = grade

    return grades


def _recitation_metadata(data, goal, difficulty, stall_id, positions):
    run = [item.model_dump() for item in (data.run or [])]

    return {
        "sequence_mode": SEQUENCE_MODE_RECITE,
        "sequence_goal": goal,
        "sequence_context_count": len(data.target_ids),
        "sequence_target_count": len(data.target_ids),
        "sequence_scheduled_count": len(data.scheduled_ids),
        "sequence_run_count": len(run),
        "sequence_target_ids": list(data.target_ids),
        "sequence_run_start": data.run_start,
        "sequence_run": run,
        "sequence_stop_reason": data.stop_reason,
        "sequence_stall_question_id": stall_id,
        "sequence_stall_position": positions.get(stall_id),
        "mode_adjusted": difficulty != 1.0,
        "mode_difficulty": difficulty
    }


def grade_sequence_answer(db, data, schedule=False):
    """Grade one canonical sequence request; optionally move due progress."""
    mode = normalize_sequence_mode(data.mode or DEFAULT_SEQUENCE_MODE)
    group, group_questions = _load_sequence_group(db, data.group_id)
    siblings = {question.id: question for question in group_questions}
    positions = dense_positions(group_questions)
    by_position = {position: question_id for question_id, position in positions.items()}
    goal = sequence_review_goal(group)
    submitted_ids = list(data.items)

    _validate_ids(submitted_ids, siblings, "Sequence answers")
    _validate_ids(data.qualities, siblings, "Sequence quality overrides")
    for question_id, candidate_ids in (data.candidates or {}).items():
        _validate_ids([question_id], siblings, "Sequence candidate targets")
        _validate_ids(candidate_ids, siblings, "Sequence candidates")

    scheduler_tuning = load_scheduler_tuning_settings(db)
    context_count = _normalize_context_count(data.context_count)
    rail = (
        []
        if data.run is not None
        else _validated_rail(data, mode, positions)
    )
    difficulty = sequence_mode_difficulty(
        mode,
        context_count=(
            context_count
            if context_count is not None
            else len(data.target_ids or group_questions)
        ),
        rail=rail or None,
        tuning=scheduler_tuning
    )

    if data.run is not None:
        if mode != SEQUENCE_MODE_RECITE:
            _bad_request("Only recite mode accepts a run")
        results, stall_id, scheduled_ids = _grade_recitation(
            data,
            siblings,
            positions
        )
        result_by_id = {result["question_id"]: result for result in results}
        if any(
            question_id not in scheduled_ids or
            result_by_id[question_id]["quality"] is None
            for question_id in data.qualities
        ):
            _bad_request(
                "Recitation quality overrides require an attempted scheduled item"
            )
        if schedule:
            expected_scheduled_ids = [
                question_id
                for question_id in data.target_ids
                if _due_or_new(
                    siblings[question_id],
                    data.review_date or date.today()
                )
            ]
            if list(data.scheduled_ids) != expected_scheduled_ids:
                _bad_request(
                    "Scheduled recitation items no longer match the due presentation"
                )
        metadata_base = _recitation_metadata(
            data,
            goal,
            difficulty,
            stall_id,
            positions
        )
    else:
        if mode == SEQUENCE_MODE_RECITE:
            _bad_request("Recite mode requires a run")
        if data.qualities:
            _bad_request("Placement quality overrides belong inside each item")
        grades = _grade_placements(data, mode, positions, rail, by_position)
        scheduled_ids = set(data.items)
        stall_id = None
        results = []

        for question_id in data.items:
            grade = grades[question_id]
            auto_quality = grade["quality"]
            results.append({
                "question_id": question_id,
                "quality": reconcile_sequence_quality(
                    auto_quality,
                    data.items[question_id].quality
                ),
                "auto_quality": auto_quality,
                "distance": grade["distance"],
                "guessed_position": grade.get("guessed_position"),
                "status": "graded",
                "stall": False,
                "scheduled": True
            })
        metadata_base = {
            "sequence_mode": mode,
            "sequence_goal": goal,
            "sequence_context_count": len(rail) or context_count,
            "sequence_rail": rail,
            "sequence_target_count": len(data.items),
            "sequence_scheduled_count": len(data.items),
            "mode_adjusted": difficulty != 1.0,
            "mode_difficulty": difficulty
        }
        if mode == SEQUENCE_MODE_REORDER:
            metadata_base["sequence_reorder_bias"] = scheduler_tuning.get(
                "sequence_reorder_bias",
                0.0
            )

    progress_map = {
        question.id: question.progress
        for question in group_questions
        if question.progress is not None
    }
    progress_quality_pairs = []
    run_by_target = {
        question_id: (data.run or [])[index]
        for index, question_id in enumerate(data.target_ids)
        if index < len(data.run or [])
    }

    for result in results:
        question_id = result["question_id"]
        question = siblings[question_id]
        result["expected_position"] = positions[question_id]
        result["label"] = question.answer

        if result["quality"] is not None and data.run is not None:
            requested = data.qualities.get(question_id)
            result["quality"] = reconcile_sequence_quality(
                result["auto_quality"],
                requested
            )

        if (
            not schedule or
            question_id not in scheduled_ids or
            result["quality"] is None
        ):
            continue

        progress = progress_map.get(question_id)

        if progress is None:
            progress = create_initial_progress(
                question_id,
                today=data.review_date
            )
            db.add(progress)
            progress_map[question_id] = progress

        if data.run is not None:
            run_item = run_by_target.get(question_id)
            answer = run_item.text if run_item is not None else None
            answer_metadata = {
                "answer": answer,
                "sequence_resolved_answer_id": (
                    run_item.question_id if run_item is not None else None
                )
            }
            event_candidate_ids = (
                (data.candidates or {}).get(question_id) or data.target_ids
            )
            event_context = {
                "context_count": context_count,
                "goal": goal,
                "target_ids": data.target_ids,
                "scheduled_ids": data.scheduled_ids,
                "run_start": data.run_start,
                "stop_reason": data.stop_reason,
                "stall_id": stall_id
            }
        else:
            guess = data.items[question_id]
            answer_metadata = {
                "answer": (
                    guess.text
                    if guess.text is not None
                    else guess.position
                ),
                "sequence_resolved_position": guess.position
            }
            event_candidate_ids = (
                (data.candidates or {}).get(question_id) or [
                    slot["question_id"]
                    for slot in rail
                    if slot.get("question_id") is not None
                ]
            )
            event_context = {
                "context_count": len(rail) or context_count,
                "goal": goal,
                "rail": rail
            }

        progress_quality_pairs.append((
            progress,
            result["quality"],
            {
                **metadata_base,
                **answer_metadata,
                "answer_event": sequence_answer_event(
                    question=question,
                    raw_response=answer_metadata["answer"],
                    resolved_response_id=(
                        answer_metadata.get("sequence_resolved_answer_id") or
                        by_position.get(
                            answer_metadata.get("sequence_resolved_position")
                        )
                    ),
                    expected_value={
                        "answer": question.answer,
                        "position": positions[question_id]
                    },
                    mode=mode,
                    candidate_ids=event_candidate_ids,
                    context=event_context
                ),
                "raw_quality": result["auto_quality"],
                "effective_quality": result["quality"]
            }
        ))

    if progress_quality_pairs:
        apply_scheduling_batch(
            db,
            progress_quality_pairs,
            scheduler_tuning=scheduler_tuning,
            today=data.review_date
        )

    for result in results:
        result["progress"] = serialize_progress(
            progress_map.get(result["question_id"])
        )

    if schedule:
        db.commit()
        sync_generated_hard_collection(db)

    return {
        "status": "ok",
        "mode": mode,
        "committed": bool(schedule),
        "results": results
    }
