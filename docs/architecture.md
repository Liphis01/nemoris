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
| `type_q` | `text`, `map`, `timeline`, `media`, or `sequence` |
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

A `media`/`answer_media`/`QuestionGroup.media` value is one of two things,
only the first of which is backend-owned data:

- `/static/<file>` (or a full local-host static URL): a real uploaded file
  under `STATIC_DIR`, backed by the `MediaFile` registry (0.5). Resolve via
  `static_file_path_from_media`/`static_relative_path_from_media`.
- an external `http(s)://` URL: hotlinked, never downloaded — used directly
  as an `<img>`/media `src`.

Anything that touches media generically (export, sync, cleanup) must handle
both; treating an external URL as "a missing local file" is a bug, not a
data problem — see `services/blueprints.py`'s `_resolve_media_ref`.

There used to be a third case: a bare filename (e.g. `"world.svg"`) meant a
**built-in map template shipped with the frontend**
(`frontend/public/maps/`), not user data at all, offered by an autocomplete
picker in the map editor. That ambiguity was eliminated (2026-07-21): map
SVGs are now ordinary uploaded media like everything else, uploaded via the
generic `/upload` endpoint (`frontend/src/features/map/components/
MapMediaInput.jsx`, replacing the old `MapFileInput.jsx`). Migration `0016`
(`_migration_localize_legacy_map_media`) one-time-localized every existing
bare reference into `STATIC_DIR` + the `MediaFile` registry, resolving the
source bytes from `FRONTEND_DIST_DIR/maps` or `frontend/public/maps` (in
that priority order — the app's own built UI is guaranteed to exist in any
real deployment, dev or packaged). Do not reintroduce a bundled-asset picker
for any media type; the media resolution code (frontend `resolveMediaUrl`,
backend `static_relative_path_from_media`) only ever has to reason about
the two cases above.

## Question Types

`text` is a normal prompt/answer card. Text questions may also belong to a
`QuestionGroup(type_group="text")` for runtime association review. The group
owns presentation metadata only; each question still owns its own progress.

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

`media` is an atomic card with media as cue or target. Related media cards may
belong to `QuestionGroup(type_group="media")` so review can present grouped
media modes while scheduling remains per question.

`sequence` is one ordered item per question in
`QuestionGroup(type_group="sequence")`. Positions are stored in
`Question.data.position`, or derived at save time from
`QuestionGroup.data.order` and per-item `data.order_value`. Review can present
rails, multiple choice, reorder, or recitation, but every scheduled result still
updates the item question's own `Progress`.

Runtime review responses include `presentation_kind` in addition to `type_q`.
Use it to distinguish screen shapes such as `single_card`, `map_group`,
`media_group`, `text_group`, `timeline_group`, and `sequence_group`; keep
`type_q` as the stored atomic family.

Answer matching policy is JSON metadata, not schema. Store group-level
overrides in `QuestionGroup.data.answer_policy` and future per-card overrides in
`Question.data.answer_policy`. The default preset is `relaxed` and preserves
existing behavior for map/media/text/sequence matching; `exact` is available in
Manage for orthography-sensitive groups. Effective policy resolution is
question override, group override, then type default.

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

## Review Log & Sync Rules

`review_log` is the append-only record of scheduling-moving reviews (one row
per legacy `Progress.history` entry; dual-written since migration 0011).

- **Rows are snapshots, not bare ratings.** `update_progress()` is not purely
  deterministic (interval fuzzing; historical parameter/behavior drift), so
  each row carries the full post-review state in `data`. Restoring state =
  taking the latest active row (`services/revlog.py`), never recomputing.
- **Rows are never updated or deleted.** A re-grade appends a replacement row
  and marks the old one via `superseded_by`. Readers filter superseded rows.
- **Forward-replay is a merge tool only** (future sync M3), aimed at memory
  state (stability/difficulty) with fuzzing off. Historical rows may not
  replay — three known classes: pre-FSRS-v6 entries, rows recorded before the
  repeat-lapse freeze existed, and rows recorded under older tuning mappings
  (parameters frozen since 2026-07-20). Snapshots stay authoritative.
- **ideal vs active schedule**: `ideal_interval`/`ideal_next_review` are the
  at-review-time schedule — they travel with the review (sync as data). The
  active `interval`/`next_review` are the local rebalancer's output — they are
  derived, re-runnable, and must never sync. Under sync, rebalancing runs
  after every pull and never before a push.
- **Manual rows**: schedule adjustments made outside a graded review append a
  no-grade snapshot row (`data["manual"]`, quality NULL) — "Acquis"
  graduation writes one, and migration 0012 reconciled historical ones. They
  restore like any snapshot and are skipped by replay and review counts. The
  rebalancer stays revlog-less by design (its output is derived, local).
- **Tombstones** (`tombstones` table, since migration 0013): every
  question/group/collection deletion records the guid via
  `services/tombstones.py` — `delete_question_dependents()` is the single
  choke point for questions. Sync uses these to distinguish "deleted here"
  from "not present here". Purge only after a completed full sync.
- `manage_data.py validate-revlog` is the repeatable gate that proved
  `review_log` and `Progress.history` are equivalent (918/918, 2026-07-20).
- **`Progress.history` is intentionally kept, not a migration in progress.**
  Dual-write guarantees permanent parity. Per-question mode-selection code
  (`mode_selection.py`, `map_modes.py`, `sequence_modes.py`, `text_modes.py`,
  `image_modes.py`) reads it directly on already-loaded ORM objects with no
  `db` session in scope — switching those hot paths to query `review_log`
  would mean threading a session through five files for no functional gain.
  `review_log` is what blueprints/sync consume; the JSON column is what
  request-time mode logic consumes. Do not "finish" this by ripping out
  `history` on the assumption it was left half-done — it was not.
- **Answer events are additive metadata.** Grouped, timeline, and sequence
  answer paths keep their legacy flat history keys and also write
  `data["answer_event"]` with the raw response, resolved id when available,
  expected value snapshot, presentation kind, mode, candidate ids, policy, and
  context. There is no schema migration for this.
- **Answer grading is backend-authoritative when answer data is present.**
  Grouped map/media/text submits continue accepting legacy quality maps, but
  raw typed strings or selected ids are re-checked by the backend before
  scheduling. Sequence typed answers are resolved by the backend against
  candidate labels/aliases. Legacy client-graded rows remain accepted and are
  marked in `answer_event.context`.

## Implementation Rules

- Prefer existing hooks, serializers, services, and feature folders.
- Add new persisted types or group types through
  `backend/app/services/type_contracts.py`; the registry is the checklist for
  validators, review, Training, retry behavior, Manage, calendar/filter labels,
  packs/sync, mobile support, default answer policy, and matching authority.
- Keep changes scoped and behavior-preserving.
- Use `joinedload`, outer joins, or bulk queries for richer backend payloads.
- Keep timeline date math consistent between backend
  `services/timeline.py` and frontend `features/timeline/timelineUtils.js`.
- Comments should explain non-obvious behavior, not restate the code.
