"""Which new questions enter review, and in what order.

``compute_intake_quota`` (intake.py) decides HOW MANY new questions a day
takes; this module decides WHICH ones. The user arranges decks rather than
individual questions: a deck is a group of two or more questions, and every
other unseen question (loose, or alone in its group) shares one "Questions
isolées" deck.

The stored plan is the deck order, a per-deck pause, how many decks feed at
once (the focus window) and where unknown decks land. Pausing a deck is an
intake-only decision: it never touches ``Question.suspended``, which stays
the single source of truth for review eligibility. That is also what makes a
pause stick for questions a pack update adds later.

``build_intake_feed`` is the one place the feed order is computed; the review
session, the menu tile and the manager all read it, so what the manager shows
is exactly what reviews will introduce.
"""

from collections import Counter
from datetime import date
import random

from fastapi import HTTPException
from sqlalchemy import case, func, not_

from ..models import Progress, Question, QuestionGroup, ReviewLog
from .cloze import cloze_is_buried
from .intake import RUNWAY_MIN_PER_DAY, compute_intake_quota, recent_intake_per_day
from .map_eligibility import training_content_question_filter
from .progress import progress_has_started, started_progress_filter
from .settings import (
    INTAKE_PLAN_FOCUS_CHOICES,
    INTAKE_PLAN_NEW_DECK_POLICIES,
    load_intake_plan,
    save_intake_plan
)


LOOSE_DECK_KEY = "loose"
LOOSE_DECK_NAME = "Questions isolées"
# Coarse on purpose, like intake_runway_days: the rate self-regulates, so a
# projected day count would promise a precision the estimate does not have.
ETA_BUCKETS = (("week", 7), ("month", 31), ("months", 92))


class IntakePlanConflict(Exception):
    """The request was built against a plan or deck state that has moved on."""


def intake_order_sort_expressions():
    # Manual order first, then the historical creation order for questions
    # that were never arranged. Only the order WITHIN a deck is read from it.
    return (
        case((Question.intake_order == None, 1), else_=0),
        Question.intake_order,
        Question.id,
    )


def _legacy_sort_key(row):
    # Python twin of intake_order_sort_expressions.
    return (row.intake_order is None, row.intake_order or 0, row.id)


def _deck_catalog(db):
    """Every group that counts as a deck, keyed by group id.

    Keyed on the group guid so the plan survives sync and pack updates, which
    keep guids but not necessarily integer ids.
    """
    sizes = dict(
        db.query(Question.group_id, func.count(Question.id))
        .filter(Question.group_id.isnot(None))
        .group_by(Question.group_id)
        .all()
    )
    deck_group_ids = [group_id for group_id, size in sizes.items() if size >= 2]

    if not deck_group_ids:
        return {}

    groups = (
        db.query(
            QuestionGroup.id,
            QuestionGroup.guid,
            QuestionGroup.name,
            QuestionGroup.type_group
        )
        .filter(QuestionGroup.id.in_(deck_group_ids))
        .all()
    )

    return {
        group.id: {
            "key": f"group:{group.guid}",
            "group_id": group.id,
            "name": group.name or f"Groupe {group.id}",
            "type_group": group.type_group
        }
        for group in groups
    }


def _loose_deck_info():
    return {
        "key": LOOSE_DECK_KEY,
        "group_id": None,
        "name": LOOSE_DECK_NAME,
        "type_group": None
    }


def _unseen_rows(db, today):
    rows = (
        db.query(
            Question.id,
            Question.type_q,
            Question.question,
            Question.answer,
            Question.data,
            Question.group_id,
            Question.suspended,
            Question.intake_order,
            Progress.reps,
            Progress.last_review,
            Progress.history
        )
        .outerjoin(Progress, Question.id == Progress.question_id)
        # Map readiness without the suspension clause: suspended unseen
        # questions stay listed so they can be resumed from the manager.
        .filter(
            training_content_question_filter(),
            not_(started_progress_filter())
        )
        .order_by(*intake_order_sort_expressions())
        .all()
    )

    # The SQL filter is only a pre-filter: its Python twin also treats a row
    # with history but no reps as started, and cloze burying is date-based.
    return [
        row
        for row in rows
        if not progress_has_started(row) and not cloze_is_buried(row, today)
    ]


def _introduced_today(db, today):
    """Questions whose first ever review is today (count_introduced_on's
    definition), with what is needed to place them in their deck."""
    seen_before = (
        db.query(ReviewLog.question_id)
        .filter(ReviewLog.reviewed_on < today)
    )

    return (
        db.query(Question.id, Question.group_id, Question.intake_order)
        .join(ReviewLog, ReviewLog.question_id == Question.id)
        .filter(
            ReviewLog.reviewed_on == today,
            ReviewLog.question_id.notin_(seen_before)
        )
        .distinct()
        .all()
    )


def interleave(decks, focus, served=None):
    """Merge per-deck queues into one feed order.

    `decks` is [(key, [question ids])] in plan order. The first `focus` decks
    (all of them when focus is 0) form the window; the window deck that has
    served the fewest questions goes next, ties going to the higher-ranked
    deck. An exhausted deck leaves and the next waiting one joins level with
    the window, so it neither starves nor floods the others.

    `served` seeds the counts with what each deck already introduced today.
    Without it, reopening a session mid-day would restart the round from the
    top deck and skew the day's split.
    """
    served = served or {}
    queues = [(key, list(ids)) for key, ids in decks if ids]
    size = focus if focus else len(queues)
    window = queues[:size]
    waiting = queues[size:]
    rank = {key: index for index, (key, _ids) in enumerate(queues)}
    counts = {key: served.get(key, 0) for key, _ids in window}
    cursors = {key: 0 for key, _ids in queues}
    order = []

    while window:
        slot = min(
            range(len(window)),
            key=lambda index: (counts[window[index][0]], rank[window[index][0]])
        )
        key, ids = window[slot]
        order.append(ids[cursors[key]])
        cursors[key] += 1
        counts[key] += 1

        if cursors[key] < len(ids):
            continue

        window.pop(slot)

        if waiting:
            joining_key, joining_ids = waiting.pop(0)
            level = min((counts[other] for other, _ids in window), default=0)
            counts[joining_key] = max(served.get(joining_key, 0), level)
            window.append((joining_key, joining_ids))

    return order


def _resolve_order(plan, existing_keys, first_keys):
    """The full deck order to store, and each deck's pause.

    Before the user has arranged anything, decks follow the order the legacy
    global queue implied (each deck's first question), so upgrading keeps what
    the user already set up. Afterwards, decks the plan has never seen land
    where the new-deck policy says. Entries for decks that no longer exist are
    dropped.
    """
    by_first_position = sorted(first_keys, key=first_keys.get)

    if not plan["arranged"]:
        return by_first_position, {}

    stored = [entry for entry in plan["decks"] if entry["key"] in existing_keys]
    known = {entry["key"] for entry in stored}
    stored_keys = [entry["key"] for entry in stored]
    unknown = [key for key in by_first_position if key not in known]
    policy = plan["new_decks"]
    order = unknown + stored_keys if policy == "start" else stored_keys + unknown
    paused = {entry["key"]: entry["paused"] for entry in stored}

    for key in unknown:
        paused[key] = policy == "paused"

    return order, paused


def build_intake_feed(db, today=None):
    today = today or date.today()
    plan = load_intake_plan(db)
    catalog = _deck_catalog(db)
    decks = {}
    rows_by_id = {}
    deck_of = {}

    for row in _unseen_rows(db, today):
        info = catalog.get(row.group_id) or _loose_deck_info()
        deck = decks.get(info["key"])

        if deck is None:
            deck = {
                **info,
                "first_key": _legacy_sort_key(row),
                "active": [],
                "suspended": []
            }
            decks[info["key"]] = deck

        deck["suspended" if row.suspended else "active"].append(row.id)
        rows_by_id[row.id] = row
        deck_of[row.id] = info["key"]

    served = Counter()

    for row in _introduced_today(db, today):
        key = (catalog.get(row.group_id) or _loose_deck_info())["key"]
        served[key] += 1

        # Today's introductions still rank their deck: otherwise consuming a
        # deck's first question would let the derived order flip mid-day.
        if key in decks:
            decks[key]["first_key"] = min(
                decks[key]["first_key"],
                _legacy_sort_key(row)
            )

    existing_keys = {LOOSE_DECK_KEY} | {info["key"] for info in catalog.values()}
    order, paused = _resolve_order(
        plan,
        existing_keys,
        {key: deck["first_key"] for key, deck in decks.items()}
    )
    listed = [key for key in order if key in decks]
    active = [key for key in listed if not paused.get(key)]
    feedable = [key for key in active if decks[key]["active"]]
    window = feedable if not plan["focus"] else feedable[:plan["focus"]]
    feed = interleave(
        [(key, decks[key]["active"]) for key in feedable],
        plan["focus"],
        served
    )

    return {
        "plan": plan,
        "order": order,
        "paused": {key: bool(paused.get(key)) for key in order},
        "decks": decks,
        # Active decks in plan order, then paused ones: the manager's order.
        "listed": active + [key for key in listed if paused.get(key)],
        "window": set(window),
        "feed": feed,
        "deck_of": deck_of,
        "rows_by_id": rows_by_id
    }


def planned_new_question_ids(db, today=None, limit=None):
    feed = build_intake_feed(db, today)["feed"]
    return feed if limit is None else feed[:max(0, limit)]


def intake_pool_counts(feed):
    decks = feed["decks"]
    paused = feed["paused"]

    return {
        "waiting": sum(
            len(deck["active"]) for key, deck in decks.items()
            if not paused.get(key)
        ),
        "paused": sum(
            len(deck["active"]) for key, deck in decks.items()
            if paused.get(key)
        ),
        "suspended": sum(len(deck["suspended"]) for deck in decks.values()),
        "decks": len(decks),
        "paused_decks": sum(1 for key in decks if paused.get(key))
    }


def _daily_rate(db, today, quota):
    rate = recent_intake_per_day(db, today)

    if rate >= RUNWAY_MIN_PER_DAY:
        return rate

    return float(quota) if quota > 0 else None


def _eta_bucket(index, quota, rate):
    if index < quota:
        return "today"

    if not rate:
        return None

    days = index / rate

    for label, limit in ETA_BUCKETS:
        if days < limit:
            return label

    return "later"


def build_intake_plan_snapshot(db, today=None):
    today = today or date.today()
    quota_info = compute_intake_quota(db, today=today)
    quota = max(0, quota_info["quota"])
    feed = build_intake_feed(db, today)
    plan = feed["plan"]
    today_ids = feed["feed"][:quota]
    today_counts = Counter(feed["deck_of"][question_id] for question_id in today_ids)
    rate = _daily_rate(db, today, quota)
    spans = {}

    for index, question_id in enumerate(feed["feed"]):
        key = feed["deck_of"][question_id]
        spans[key] = (spans[key][0], index) if key in spans else (index, index)

    decks = []
    position = 0

    for key in feed["listed"]:
        deck = feed["decks"][key]
        paused = feed["paused"].get(key, False)
        span = spans.get(key)

        if not paused:
            position += 1

        decks.append({
            "key": key,
            "group_id": deck["group_id"],
            "name": deck["name"],
            "type_group": deck["type_group"],
            "paused": paused,
            "section": (
                "paused" if paused
                else "focus" if key in feed["window"]
                else "next"
            ),
            "position": None if paused else position,
            "counts": {
                "unseen": len(deck["active"]),
                "suspended": len(deck["suspended"])
            },
            "today_count": today_counts.get(key, 0),
            "eta": {
                "starts": _eta_bucket(span[0], quota, rate) if span else None,
                "finishes": _eta_bucket(span[1], quota, rate) if span else None
            }
        })

    # Decks in the order today's first question from each arrives.
    by_deck = [
        {"key": key, "count": today_counts[key]}
        for key in dict.fromkeys(
            feed["deck_of"][question_id] for question_id in today_ids
        )
    ]

    return {
        "revision": plan["revision"],
        "settings": {
            "focus": plan["focus"],
            "new_decks": plan["new_decks"]
        },
        "counts": intake_pool_counts(feed),
        "today": {
            "quota": quota,
            "count": len(today_ids),
            "by_deck": by_deck,
            "breakdown": quota_info
        },
        "decks": decks
    }


def _display_texts(row):
    question = str(row.question or "").strip()
    answer = str(row.answer or "").strip()

    # A map zone's prompt is the map itself; its name is the answer.
    if row.type_q == "map":
        return answer or question or f"Question {row.id}", ""

    primary = question or answer or f"Question {row.id}"

    return primary, answer if answer and answer != primary else ""


def build_intake_deck_detail(db, key, today=None):
    feed = build_intake_feed(db, today)
    deck = feed["decks"].get(key)

    if deck is None:
        raise HTTPException(status_code=404, detail="Deck not found")

    positions = {
        question_id: index
        for index, question_id in enumerate(feed["feed"])
    }

    def item(question_id):
        row = feed["rows_by_id"][question_id]
        primary, secondary = _display_texts(row)

        return {
            "id": question_id,
            "type_q": row.type_q,
            "primary": primary,
            "secondary": secondary,
            "feed_position": positions.get(question_id)
        }

    return {
        "revision": feed["plan"]["revision"],
        "deck": {
            "key": key,
            "group_id": deck["group_id"],
            "name": deck["name"],
            "type_group": deck["type_group"],
            "paused": feed["paused"].get(key, False)
        },
        "questions": [item(question_id) for question_id in deck["active"]],
        "suspended": [item(question_id) for question_id in deck["suspended"]]
    }


def _require_deck_key(feed, key):
    if not isinstance(key, str) or key not in feed["decks"]:
        raise HTTPException(status_code=404, detail="Deck not found")

    return key


def _require_deck_keys(feed, keys):
    if not isinstance(keys, list) or not keys:
        raise HTTPException(status_code=400, detail="keys must not be empty")

    if len(keys) != len(set(keys)):
        raise HTTPException(
            status_code=400,
            detail="keys must not contain duplicates"
        )

    return [_require_deck_key(feed, key) for key in keys]


def _require_question_ids(action):
    question_ids = action.get("question_ids")

    if not isinstance(question_ids, list):
        raise HTTPException(status_code=400, detail="question_ids is required")

    question_ids = [int(question_id) for question_id in question_ids]

    if len(question_ids) != len(set(question_ids)):
        raise HTTPException(
            status_code=400,
            detail="question_ids must not contain duplicates"
        )

    return question_ids


def _replace_in_place(order, members, sequence):
    """Rewrite the slots `members` occupy in `order` with `sequence`, leaving
    every other entry (paused or currently empty decks) where it was."""
    replacements = iter(sequence)

    return [next(replacements) if key in members else key for key in order]


def _write_intake_order(db, question_ids):
    questions = {
        question.id: question
        for question in (
            db.query(Question)
            .filter(Question.id.in_(question_ids))
            .all()
        )
    }

    for index, question_id in enumerate(question_ids, start=1):
        questions[question_id].intake_order = index


def _reorder_deck(db, feed, action):
    key = _require_deck_key(feed, action.get("key"))
    question_ids = _require_question_ids(action)
    current = feed["decks"][key]["active"]

    if len(question_ids) != len(current) or set(question_ids) != set(current):
        raise IntakePlanConflict(
            "Les questions de ce paquet ont changé entre-temps."
        )

    _write_intake_order(db, question_ids)


def _shuffle_deck(db, feed, action, rng):
    key = _require_deck_key(feed, action.get("key"))
    question_ids = list(feed["decks"][key]["active"])
    rng.shuffle(question_ids)
    _write_intake_order(db, question_ids)


def _set_suspended(db, feed, action):
    question_ids = _require_question_ids(action)
    suspended = action.get("suspended")

    if not isinstance(suspended, bool):
        raise HTTPException(status_code=400, detail="suspended is required")

    # Unseen questions only: suspending started work belongs to the question
    # and group editors, which also rebalance the calendar.
    if set(question_ids) - set(feed["rows_by_id"]):
        raise HTTPException(
            status_code=400,
            detail="Only unseen reviewable questions can be updated"
        )

    for question in (
        db.query(Question)
        .filter(Question.id.in_(question_ids))
        .all()
    ):
        question.suspended = suspended


QUESTION_ACTIONS = {"reorder_questions", "shuffle", "set_suspended"}


def apply_intake_plan_actions(db, base_revision, actions, today=None, rng=None):
    """Apply manager actions atomically and return the fresh snapshot.

    Every write materializes the whole deck order, so from then on a deck the
    plan has not seen can only be one created after this write.
    """
    today = today or date.today()
    rng = rng or random.Random()
    feed = build_intake_feed(db, today)
    plan = feed["plan"]

    if base_revision != plan["revision"]:
        raise IntakePlanConflict("Le plan a changé ailleurs.")

    order = list(feed["order"])
    paused = dict(feed["paused"])
    focus = plan["focus"]
    new_decks = plan["new_decks"]

    for action in actions:
        kind = action.get("type")

        if kind == "move":
            key = _require_deck_key(feed, action.get("key"))
            to_index = action.get("to_index")

            if paused.get(key):
                raise HTTPException(
                    status_code=400,
                    detail="A paused deck must be resumed before it can move"
                )

            if not isinstance(to_index, int):
                raise HTTPException(status_code=400, detail="to_index is required")

            active = [
                entry for entry in order
                if entry in feed["decks"] and not paused.get(entry)
            ]
            members = set(active)
            active.remove(key)
            active.insert(max(0, min(to_index, len(active))), key)
            order = _replace_in_place(order, members, active)
        elif kind == "set_paused":
            keys = _require_deck_keys(feed, action.get("keys"))

            if not isinstance(action.get("paused"), bool):
                raise HTTPException(status_code=400, detail="paused is required")

            for key in keys:
                paused[key] = action["paused"]
        elif kind == "study_next":
            keys = _require_deck_keys(feed, action.get("keys"))
            order = keys + [entry for entry in order if entry not in keys]

            for key in keys:
                paused[key] = False
        elif kind == "set_focus":
            focus = action.get("focus")

            if focus not in INTAKE_PLAN_FOCUS_CHOICES or isinstance(focus, bool):
                raise HTTPException(status_code=400, detail="Invalid focus")
        elif kind == "set_new_decks":
            new_decks = action.get("policy")

            if new_decks not in INTAKE_PLAN_NEW_DECK_POLICIES:
                raise HTTPException(status_code=400, detail="Invalid policy")
        elif kind == "reorder_questions":
            _reorder_deck(db, feed, action)
        elif kind == "shuffle":
            _shuffle_deck(db, feed, action, rng)
        elif kind == "set_suspended":
            _set_suspended(db, feed, action)
        else:
            raise HTTPException(status_code=400, detail="Unknown action")

        if kind in QUESTION_ACTIONS:
            # Later actions in the same request validate against the rows
            # this one just changed.
            db.flush()
            feed = build_intake_feed(db, today)

    save_intake_plan(db, {
        "revision": plan["revision"] + 1,
        "decks": [
            {"key": key, "paused": bool(paused.get(key))}
            for key in order
        ],
        "focus": focus,
        "new_decks": new_decks
    })
    db.flush()

    return build_intake_plan_snapshot(db, today)
