"""Two-axis grid source, generated cards, and authoritative grading."""

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Question, QuestionGroup
from ..serializers import serialize_progress
from .answer_policy import effective_answer_policy, matches_answer_value, merge_answer_policy
from .questions import delete_question_dependents
from .tag_hierarchy import ensure_tag_ids


GRID_NAMESPACE = uuid.UUID("d4e6d1e4-a1d7-5f25-a9f7-63e1c46751cb")


def _bad(detail):
    raise HTTPException(status_code=422, detail=detail)


def _uuid_key(value, label):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        _bad(f"{label} doit avoir une clé UUID valide.")


def normalize_grid_source(grid):
    """Validate the authored matrix and preserve only its stable source fields."""
    if not isinstance(grid, dict):
        _bad("data.grid est requis.")
    rows, columns, cells = grid.get("rows"), grid.get("columns"), grid.get("cells")
    if not isinstance(rows, list) or not rows or not isinstance(columns, list) or not columns:
        _bad("La grille doit contenir au moins une ligne et une colonne.")
    if not isinstance(cells, list) or not cells:
        _bad("La grille doit contenir au moins une cellule.")

    def axes(values, label):
        result, keys = [], set()
        for entry in values:
            if not isinstance(entry, dict):
                _bad(f"Une {label} est mal formée.")
            key = _uuid_key(entry.get("key"), label.capitalize())
            text = str(entry.get("label") or "").strip()
            if not text:
                _bad(f"Le libellé de chaque {label} est requis.")
            if key in keys:
                _bad(f"Les clés de {label}s doivent être uniques.")
            keys.add(key)
            result.append({"key": key, "label": text})
        return result, keys

    normalized_rows, row_keys = axes(rows, "ligne")
    normalized_columns, column_keys = axes(columns, "colonne")
    normalized_cells, cell_keys, coordinates = [], set(), set()
    for entry in cells:
        if not isinstance(entry, dict):
            _bad("Une cellule est mal formée.")
        key = _uuid_key(entry.get("key"), "Cellule")
        row_key = _uuid_key(entry.get("row_key"), "La ligne de la cellule")
        column_key = _uuid_key(entry.get("column_key"), "La colonne de la cellule")
        value = str(entry.get("value") or "")
        if row_key not in row_keys or column_key not in column_keys:
            _bad("Une cellule référence un axe inexistant.")
        if not value.strip():
            _bad("Une cellule significative ne peut pas être vide.")
        coordinate = (row_key, column_key)
        if key in cell_keys or coordinate in coordinates:
            _bad("Chaque cellule et chaque coordonnée doivent être uniques.")
        cell_keys.add(key)
        coordinates.add(coordinate)
        normalized_cells.append({
            "key": key,
            "row_key": row_key,
            "column_key": column_key,
            "value": value,
        })
    return {"format": 1, "rows": normalized_rows, "columns": normalized_columns, "cells": normalized_cells}


def grid_question_guid(group_guid, key):
    return str(uuid.uuid5(GRID_NAMESPACE, f"{group_guid}:{key}"))


def grid_question_data(cell):
    return {"grid": {"key": cell["key"], "row_key": cell["row_key"], "column_key": cell["column_key"]}}


def _axis_labels(source):
    return (
        {item["key"]: item["label"] for item in source["rows"]},
        {item["key"]: item["label"] for item in source["columns"]},
    )


def _question_prompt(group, cell, source):
    rows, columns = _axis_labels(source)
    return f"{group.name} — {rows[cell['row_key']]} × {columns[cell['column_key']]}"


def get_grid_group_or_404(db, group_id):
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions).joinedload(Question.progress))
        .filter(QuestionGroup.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if group.type_group != "grid":
        raise HTTPException(status_code=400, detail="Group is not a grid group")
    return group


def serialize_grid_card(question):
    return {
        "id": question.id, "guid": question.guid, "type_q": "grid",
        "question": question.question, "answer": question.answer,
        "tags": question.tags or [], "data": question.data or {},
        "group_id": question.group_id, "progress": serialize_progress(question.progress),
        "suspended": bool(question.suspended),
    }


def serialize_grid_group(group):
    source = ((group.data or {}).get("grid") or {})
    cards = sorted((item for item in (group.questions or []) if item.type_q == "grid"), key=lambda item: item.id)
    return {
        "group": {
            "id": group.id, "guid": group.guid, "type_group": "grid", "name": group.name,
            "data": group.data or {}, "grid": source,
            "tags": (cards[0].tags or []) if cards else [],
            "answer_policy": (group.data or {}).get("answer_policy"),
            "question_count": len(cards),
        },
        "cards": [serialize_grid_card(card) for card in cards],
    }


def get_grid_group(db, group_id):
    return serialize_grid_group(get_grid_group_or_404(db, group_id))


def save_grid_group(db, group_id, payload):
    group = get_grid_group_or_404(db, group_id)
    incoming = normalize_grid_source(payload.grid)
    previous = normalize_grid_source(((group.data or {}).get("grid") or incoming)) if (group.data or {}).get("grid") else None
    existing = {
        ((item.data or {}).get("grid") or {}).get("key"): item
        for item in group.questions or [] if item.type_q == "grid"
    }
    previous_cells = {item["key"]: item for item in (previous or {}).get("cells", [])}

    # Replacing the fact at a stable source key must retire the old memory. The
    # server mints the replacement key, so a visual editor never needs hidden
    # identity rules of its own.
    normalized_cells = []
    replaced_keys = set()
    for cell in incoming["cells"]:
        old = previous_cells.get(cell["key"])
        if old and (old["value"] != cell["value"] or old["row_key"] != cell["row_key"] or old["column_key"] != cell["column_key"]):
            replaced_keys.add(cell["key"])
            cell = {**cell, "key": str(uuid.uuid4())}
        normalized_cells.append(cell)
    source = {**incoming, "cells": normalized_cells}

    if payload.name is not None:
        group.name = payload.name
    tags = ensure_tag_ids(db, payload.tags or [])
    group_data = dict(group.data or {})
    group_data["grid"] = source
    if payload.answer_policy is not None:
        group_data = merge_answer_policy(group_data, payload.answer_policy, type_q="grid")
    group.data = group_data

    active_keys = {cell["key"] for cell in source["cells"]}
    removed = [item for key, item in existing.items() if key not in active_keys]
    removed_ids, created_ids = [item.id for item in removed], []
    cells_by_key = {cell["key"]: cell for cell in source["cells"]}
    try:
        if removed:
            delete_question_dependents(db, removed_ids)
            for item in removed:
                db.delete(item)
        for key, cell in cells_by_key.items():
            item = existing.get(key)
            if item is None:
                item = Question(guid=grid_question_guid(group.guid, key), type_q="grid", question=_question_prompt(group, cell, source), answer=cell["value"], tags=tags, data=grid_question_data(cell), group_id=group.id)
                db.add(item)
                db.flush()
                created_ids.append(item.id)
            else:
                item.guid = grid_question_guid(group.guid, key)
                item.question = _question_prompt(group, cell, source)
                item.answer = cell["value"]
                item.tags = tags
                item.data = grid_question_data(cell)
        db.commit()
    except Exception:
        db.rollback()
        raise
    result = get_grid_group(db, group_id)
    result["items"] = result["cards"]
    result["deletedQuestionIds"] = removed_ids
    result["createdQuestionIds"] = created_ids
    result["replacedCellKeys"] = list(replaced_keys)
    return result


def validate_grid_pack_entries(group_entries, question_entries):
    for group in group_entries or []:
        if group.get("type_group") != "grid":
            continue
        source = normalize_grid_source(((group.get("data") or {}).get("grid")))
        cards = [entry for entry in question_entries or [] if entry.get("group_guid") == group.get("guid") and entry.get("type_q") == "grid"]
        by_key = {((entry.get("data") or {}).get("grid") or {}).get("key"): entry for entry in cards}
        cells = {cell["key"]: cell for cell in source["cells"]}
        if set(by_key) != set(cells):
            raise ValueError("Invalid grid pack: generated cards do not match source")
        for key, cell in cells.items():
            entry = by_key[key]
            expected_data = grid_question_data(cell)
            if entry.get("guid") != grid_question_guid(group.get("guid"), key) or entry.get("answer") != cell["value"] or entry.get("data") != expected_data:
                raise ValueError("Invalid grid pack: card identity does not match source")


def grid_presentation(group, questions, mode):
    source = normalize_grid_source(((group.data or {}).get("grid")))
    target_by_coordinate = {
        (((item.data or {}).get("grid") or {}).get("row_key"), ((item.data or {}).get("grid") or {}).get("column_key")): item
        for item in questions
    }
    cells = []
    for cell in source["cells"]:
        item = target_by_coordinate.get((cell["row_key"], cell["column_key"]))
        cells.append({**cell, "value": None if item else cell["value"]})
    return {
        "group_id": group.id, "type_q": "grid",
        "presentation_kind": "grid_row" if mode == "fill_row" else "grid_cell",
        "name": group.name, "grid": {**source, "cells": cells},
        "mode": mode, "answer_policy": effective_answer_policy(group=group, type_q="grid"),
        "items": [{
            "question_id": item.id,
            "row_key": ((item.data or {}).get("grid") or {}).get("row_key"),
            "column_key": ((item.data or {}).get("grid") or {}).get("column_key"),
            "progress": serialize_progress(item.progress),
        } for item in questions],
    }


def grade_grid_answers(db, payload):
    question_ids = list(payload.items)
    questions = (
        db.query(Question).options(joinedload(Question.group), joinedload(Question.progress))
        .filter(Question.id.in_(question_ids), Question.type_q == "grid")
        .all()
    )
    if len(questions) != len(question_ids) or any(item.group_id != payload.group_id for item in questions):
        raise HTTPException(status_code=404, detail="Grid cards not found")
    group = questions[0].group if questions else get_grid_group_or_404(db, payload.group_id)
    source = normalize_grid_source(((group.data or {}).get("grid")))
    valid_keys = {cell["key"] for cell in source["cells"]}
    results = []
    for item in questions:
        data = ((item.data or {}).get("grid") or {})
        if data.get("key") not in valid_keys:
            raise HTTPException(status_code=422, detail="Grid source and card are inconsistent")
        raw = str(payload.items[item.id].answer or "")
        policy = effective_answer_policy(question=item, group=group, type_q="grid")
        results.append({"question": item, "question_id": item.id, "answer": raw, "expected": item.answer, "correct": matches_answer_value(item, raw, policy), "answer_policy": policy})
    return {"group": group, "items": results}
