# Architecture Notes

## Product Direction

Quiz App is a personal knowledge and review tool. It should feel closer to a
fast knowledge workspace than a CRUD admin panel: quick review, quick editing,
visual inspection, and grouped learning for maps and timelines.

## Repository Shape

- Frontend: React + Vite under `frontend/src`.
- Frontend features: `manage`, `map`, `review`, `timeline`, `calendar`, `menu`.
- Shared frontend helpers live in `frontend/src/shared`.
- Backend: FastAPI + SQLAlchemy under `backend/app`.
- Backend routers live in `backend/app/routers`; business logic lives in
  `backend/app/services`; `main.py` should stay thin.

## Data Model

`Question` is always the atomic review item. It has independent `Progress`,
even when the UI reviews it together with other questions.

Core fields:

| Field | Notes |
| --- | --- |
| `question` | Prompt/title shown in Manage and review |
| `answer` | Expected answer or display label |
| `type_q` | `text`, `map`, or `timeline` |
| `media` | Image, SVG, audio, or video path |
| `tags` | Lightweight filters |
| `group_id` | Optional presentation group membership |
| `data` | Type-specific JSON metadata |

Related structures:

- `Progress` is one-to-one with `Question`.
- `QuestionGroup` stores presentation metadata: `type_group`, `name`, `media`,
  and `data`. It is not a review item and has no progress.
- `Collection` is many-to-many user organization. It does not define grouped
  review behavior.

Do not reintroduce old names such as `fichier`, and do not create persisted
question types such as `map_group` or `timeline_group`.

## Question Types

`text` is a normal prompt/answer card.

`map` is one SVG zone per question. The group is a `QuestionGroup` with
`type_group="map"` and shared media. Zone metadata lives on each question:

```json
{
  "code": "fr",
  "aliases": ["france", "republique francaise"]
}
```

`timeline` is one dated item per question. Timeline questions do not belong to a
group. Their date metadata lives in `data.timeline`:

```json
{
  "timeline": {
    "kind": "interval",
    "start": { "year": 1789, "precision": "year" },
    "end": { "year": 1799, "precision": "year" }
  }
}
```

Supported precisions are `year`, `month`, and `day`. Year 0 is invalid; BC
years are negative.

## Manage UI

Manage is both a spreadsheet and a knowledge browser. Keep the current
three-panel direction:

```text
Sidebar filters/sort | List/cards | ManageInspector embedded editor
```

Stable expectations:

- Prefer inline and embedded edits over form-heavy modal workflows.
- Keep filters and sorting in dedicated utilities, not duplicated in components.
- Preserve autosave of pending existing-item edits before selection or mode
  changes.
- Deleting a group deletes its questions and frontend caches should reflect
  that immediately.
- Preserve existing French UI copy unless intentionally changing text.

## Implementation Rules

- Prefer existing hooks, serializers, services, and feature folders.
- Keep changes scoped and behavior-preserving.
- Use `joinedload`, outer joins, or bulk queries for richer backend payloads.
- Keep timeline date math consistent between backend
  `services/timeline.py` and frontend `features/timeline/timelineUtils.js`.
- Comments should explain non-obvious behavior, not restate the code.
