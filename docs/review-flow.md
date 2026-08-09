# Review Flow

## Responsibilities

The review backend selects due/new atomic questions, builds frontend-ready
runtime review objects, and updates independent progress for every answered
question. Review filtering is not a main `/review` responsibility anymore.

## Loading A Session

`GET /review` loads questions that have no progress, no `next_review`, or
`next_review <= today`. It uses joined progress/group data, then returns a mixed
queue. Every runtime object keeps its legacy `type_q` and also carries an
additive `presentation_kind` discriminator:

- `single_card`: one text/media question item.
- `map_group`: one runtime group per due map group, with only due zone questions in
  `items`.
- `media_group`: one runtime group per due media group.
- `text_group`: one runtime group per due text association group.
- `timeline_group`: one runtime timeline screen containing due timeline items.
- `sequence_group`: one runtime group per due sequence group.

Runtime grouped objects are response shapes only. They are never stored as
questions and never own progress.

## Runtime Shapes

Text items use `question_id`, prompt, answer, media, tags, and progress.

Map groups use:

```json
{
  "type_q": "map",
  "presentation_kind": "map_group",
  "group_id": 5,
  "name": "Europe",
  "media": "europe.svg",
  "items": [
    {
      "question_id": 12,
      "code": "fr",
      "label": "France",
      "aliases": ["republique francaise"],
      "progress": {}
    }
  ]
}
```

Media, text and sequence groups follow the same runtime-group convention:
`type_q` identifies the stored atomic question family, `presentation_kind`
identifies the screen shape, and `items` holds independently scheduled cards.
Sequence groups additionally include their served `rail` or `recitation`
presentation context.

Timeline groups use:

```json
{
  "type_q": "timeline",
  "presentation_kind": "timeline_group",
  "name": "Timeline",
  "items": [
    {
      "question_id": 40,
      "timeline": {
        "kind": "point",
        "start": { "year": 1789, "precision": "year" }
      },
      "start_value": 652933,
      "progress": {}
    }
  ],
  "range": {}
}
```

## Answer Endpoints

Text review posts one grade:

```json
POST /answer
{ "question_id": 42, "quality": 2 }
```

Map review posts one grade per atomic zone:

```json
POST /answer_map
{
  "items": { "12": 2, "13": 0 },
  "mode": "multiple_choice",
  "answers": { "12": "France", "13": "Belgique" },
  "candidates": { "12": [12, 13, 14, 15], "13": [12, 13, 14, 15] }
}
```

Grouped media and grouped text answers use the same additive `answers` and
`candidates` shape. Sequences post their server-validated `rail` or recitation
fields; the answer path records that context in history.

Timeline review posts one guess per atomic timeline question:

```json
POST /answer_timeline
{
  "items": {
    "40": {
      "start": { "year": 1789, "precision": "year" }
    }
  }
}
```

Qualities are `0 = Again/Faux`, `1 = Hard/Dur`, `2 = Good/Bon`, and
`3 = Easy/Facile`. Missing progress rows are created lazily before scheduling
is applied.

Every scheduling-moving grouped/timeline/sequence answer writes legacy flat
history keys plus a nested `answer_event` snapshot with raw response, resolved
id when available, expected value, type, `presentation_kind`, mode, direction,
candidate ids, answer policy, grader/presentation version, and useful context.

## Frontend Session Behavior

The frontend renders the returned queue and sends answer payloads. It should not
rebuild backend grouping rules.

Failures are requeued inside the current session:

- failed text cards are appended as the same item,
- failed map zones are wrapped back into the same map runtime shape,
- failed timeline items are wrapped back into the same timeline runtime shape.
- failed media, text-group, and sequence items are likewise requeued in their
  served runtime presentation.

Global review shortcuts must not leak into map, timeline, input, textarea,
select, or contenteditable targets.

## Scheduling

Scheduling is centralized in `backend/app/scheduler.py` and
`backend/app/services/progress.py`.

Important behavior:

- Scheduling uses FSRS v6 through `py-fsrs` 6.3.1, with date-level due dates in
  the app database.
- New progress starts due today with default stability and difficulty.
- Every answer appends a history snapshot.
- `apply_scheduling_batch` computes raw FSRS intervals with fuzzing enabled,
  then smooths the batch against existing daily loads.
- Longer intervals get scheduling slots first.
- Daily type loads are considered so review days mix question types.
- `catchup_daily_target` is an approximate catch-up objective for calendar
  rebalancing. The scheduler allows a 25% proportional tolerance before moving
  overflow later.
- Startup runs a one-time FSRS v6 migration. Existing history is replayed when
  possible; otherwise the current scalar progress and due date are preserved.

Settings and rebalancing endpoints:

- `GET /review/settings`
- `PUT /review/settings`
- `POST /review/rebalance`
- `GET /review/startup_notice`

## Backend Rules

- Keep runtime grouping explicit in backend services/serializers.
- Add new types only through the type contract registry in
  `backend/app/services/type_contracts.py`, with exhaustive tests for required
  consumers.
- Use joined or bulk queries to avoid N+1 work.
- Keep progress atomic even when multiple items are answered from one screen.
- Keep timeline grading and date normalization on the backend authoritative.
