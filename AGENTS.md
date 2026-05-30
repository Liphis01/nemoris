# Quiz App Agent Notes

## Purpose

Personal knowledge/review app combining spaced repetition, spreadsheet-like
editing, and visual exploration. Prioritize fast review, fast browsing, embedded
editors, and quick grouped-content inspection.

## Current Shape

- Frontend: React + Vite in `frontend/src/features/{manage,map,review,timeline,calendar,menu}` plus `shared`.
- Backend: FastAPI + SQLAlchemy in `backend/app/{routers,services}`; keep `main.py` thin.
- Run dev with `./start.sh`. Packaging notes live in `docs/build.md`.
- Backend tests are in `backend/tests`; `pytest` may need to be installed separately.

## Core Data Rules

- `Question` is always one atomic review item with independent `Progress`.
- Core question fields: `question`, `answer`, `type_q`, `media`, `tags`, `group_id`, `data`.
- Collections are many-to-many; do not duplicate them in `data`.
- Use `media`, `group_id`, and `data`; never reintroduce old `fichier` naming.
- `QuestionGroup` stores presentation metadata only: `type_group`, `name`, `media`, `data`.
- No group-level progress. Do not create database question types like `map_group` or `timeline_group`.
- Prefer `Question.data` or `QuestionGroup.data` for type-specific metadata before adding SQL columns.

## Question Types

- `text`: normal prompt/answer review.
- `map`: one SVG zone per `Question`; map group metadata is `QuestionGroup(type_group="map")`. Zone `code` and `aliases` live in `question.data`.
- `timeline`: one date item per `Question`; it must not belong to a group. `data.timeline` has `kind` (`point` or `interval`), `start`, optional `end`, and precision `year`/`month`/`day`. Year 0 is invalid; BC years are negative.

Runtime grouped objects may exist for review UI payloads, but they are never
persisted as questions.

## Review And Scheduling

- `/review` selects due/new atomic questions and builds frontend-ready runtime groups. Review filtering is no longer a main `/review` concern.
- Backend owns grouping and serializers; frontend should render returned shapes instead of rebuilding grouping rules.
- Text failures, failed map zones, and failed timeline items are requeued within the frontend session.
- Scheduling lives in `scheduler.py` and `services/progress.py`: keep FSRS-inspired intervals, history, load smoothing, type mixing, and `catchup_daily_target` rebalancing behavior intact.

## Manage UX

- Manage is a spreadsheet plus knowledge browser, not an admin CRUD screen.
- Keep the left filters/sort sidebar, center list/cards, and right `ManageInspector` embedded editor direction.
- Preserve inline/embedded edits, keyboard-friendly navigation, and autosave of pending existing-item edits before selection or mode changes.
- Keep question/group filtering and sorting in dedicated utils; avoid duplicating that logic in components.
- Deleting a group deletes its questions too; keep frontend caches consistent after mutations.

## Map And Timeline UX

- Map answer matching ignores case, accents, and hyphen/space differences.
- Map review sends one quality per zone; recap appears after all zones are found and keeps per-zone progress independent.
- Keep map input focus stable around buttons, and prevent global review shortcuts from leaking into map/timeline/input fields.
- Timeline date math must stay consistent between `backend/app/services/timeline.py` and `frontend/src/features/timeline/timelineUtils.js`.

## Code Style

- Make minimal, explicit, behavior-preserving changes.
- Prefer existing feature folders, hooks, serializers, and services over new abstractions.
- Avoid giant components, deep prop chains, N+1 queries, hidden review logic, and unrelated refactors.
- Use `joinedload`/bulk queries for backend payloads.
- Preserve existing French UI copy unless asked otherwise.
- Comments should explain non-obvious behavior only.

## Before Refactoring

1. Explain the plan first.
2. Keep behavior stable and changes scoped.
3. Avoid introducing new concepts unless requested.

## Recent Context Since Last AGENTS.md Update

Last AGENTS.md commit: `c3884af` on 2026-05-19.

Since then: timeline review/editing was added; scheduling smoothing and catch-up
rebalancing were added; Manage gained sorting/type filters/autosave/richer hover
previews; map review gained recap/focus/hover polish; packaging docs/scripts
were added.
