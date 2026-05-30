# Review Flow

## Responsibilities

The review backend selects due/new atomic questions, builds frontend-ready
runtime review objects, and updates independent progress for every answered
question. Review filtering is not a main `/review` responsibility anymore.

## Loading A Session

`GET /review` loads questions that have no progress, no `next_review`, or
`next_review <= today`. It uses joined progress/group data, then returns a mixed
queue:

- `text`: one question item.
- `map`: one runtime group per due map group, with only due zone questions in
  `items`.
- `timeline`: one runtime timeline screen containing due timeline items.

Runtime grouped objects are response shapes only. They are never stored as
questions and never own progress.

## Runtime Shapes

Text items use `question_id`, prompt, answer, media, tags, and progress.

Map groups use:

```json
{
  "type_q": "map",
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

Timeline groups use:

```json
{
  "type_q": "timeline",
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
{ "items": { "12": 2, "13": 0 } }
```

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

Qualities are `0 = failed`, `1 = hard`, and `2 = easy`. Missing progress rows
are created lazily before scheduling is applied.

## Frontend Session Behavior

The frontend renders the returned queue and sends answer payloads. It should not
rebuild backend grouping rules.

Failures are requeued inside the current session:

- failed text cards are appended as the same item,
- failed map zones are wrapped back into the same map runtime shape,
- failed timeline items are wrapped back into the same timeline runtime shape.

Global review shortcuts must not leak into map, timeline, input, textarea,
select, or contenteditable targets.

## Scheduling

Scheduling is centralized in `backend/app/scheduler.py` and
`backend/app/services/progress.py`.

Important behavior:

- New progress starts due today with default stability and difficulty.
- Every answer appends a history snapshot.
- `apply_scheduling_batch` computes raw intervals, then smooths the batch
  against existing daily loads.
- Longer intervals get scheduling slots first.
- Daily type loads are considered so review days mix question types.
- `catchup_daily_target` is an approximate catch-up objective for calendar
  rebalancing. The scheduler allows a 25% proportional tolerance before moving
  overflow later.

Settings and rebalancing endpoints:

- `GET /review/settings`
- `PUT /review/settings`
- `POST /review/rebalance`
- `GET /review/startup_notice`

## Backend Rules

- Keep runtime grouping explicit in backend services/serializers.
- Use joined or bulk queries to avoid N+1 work.
- Keep progress atomic even when multiple items are answered from one screen.
- Keep timeline grading and date normalization on the backend authoritative.
