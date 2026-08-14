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

- `single_card`: one standalone card, including text, media, numeric, and
  enumeration.
- `map_group`: one runtime group per due map group, with only due zone questions in
  `items`.
- `media_group`: one runtime group per due media group.
- `text_group`: one runtime group per due text association group.
- `timeline_group`: one runtime timeline screen containing due timeline items.
- `sequence_group`: one runtime group per due sequence group.
- `cloze_blank`: one generated cloze card in its authored note context.
- `grid_cell` / `grid_row`: one generated grid cell or row-constrained subset.
- `set_group`: one due-only membership-set collector.

Runtime grouped objects are response shapes only. They are never stored as
questions and never own progress.

Review objects that perform typed or selected-answer matching carry an
additive `answer_policy` object. Existing content defaults to relaxed matching:
ignore case and diacritics, collapse hyphen/whitespace differences, and use no
fuzzy typo tolerance. Authors can set `QuestionGroup.data.answer_policy` (or,
for future single-card overrides, `Question.data.answer_policy`) to the `exact`
preset. Effective policy resolution is question override, then group override,
then type default.

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
      "answer_policy": { "preset": "relaxed" },
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

Cloze, grid and set groups are authored as groups but reviewed through generated
atomic cards. The frontend renders the group context returned by the backend and
submits raw answers for server grading; progress still belongs to the generated
question rows.

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
  "answers": { "12": 12, "13": 13 },
  "candidates": { "12": [12, 13, 14, 15], "13": [12, 13, 14, 15] }
}
```

Grouped media and grouped text answers use the same additive `answers` and
`candidates` shape. Typed modes send raw strings; click, choice, and match
modes send selected question ids when available. Sequences post their
server-validated `rail` or recitation fields; typed sequence items may send
`text` without a resolved position, and the backend resolves it against
candidate labels and aliases.

Media's reverse QCM is `multiple_choice_media`: the displayed label is the
prompt and the learner selects one of four media options, including audio
players. `multiple_choice_image` is accepted only as a legacy request value and
is normalized before scheduling metadata is written.

An opted-in text group may receive `type_reverse`. It displays each stored
answer as the cue and grades the typed original `question`; its answer event
therefore records `direction: "answer_to_prompt"` and that original question as
the expected value. The group must have complete pairs and unique normalized
answer cues.

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

Server-graded types preview correction before scheduling. A backend hit accepts
only `1`, `2`, or `3`; a backend miss accepts `0` or, where supported, `1` as a
close/hard miss. A close miss is never upgraded to full success. History
metadata records `backend_matched`, `user_marked_close`, `raw_quality`, and
`effective_quality`.

Set review hides the due count before submission. After preview it reports due
hits, valid non-due hits, unmatched answers, and missed due items. Enumeration
deduplicates answers with the backend relaxed normalization and reports matched,
duplicate, unmatched, and missing-count feedback.

Every scheduling-moving grouped/timeline/sequence answer writes legacy flat
history keys plus a nested `answer_event` snapshot with raw response, resolved
id when available, expected value, type, `presentation_kind`, mode, direction,
candidate ids, answer policy, grader/presentation version, and useful context.
When raw or resolved answer data is present, grouped map/media/text and
sequence grading is backend-authoritative: a backend miss schedules quality
`0`, while a backend hit keeps the learner's valid quality choice or defaults
to `2`. Older clients that omit answer data still use the legacy client-graded
quality path and are marked as such in `answer_event.context`.

## Frontend Session Behavior

The frontend renders the returned queue and sends answer payloads. It should not
rebuild backend grouping rules.

Failures are requeued inside the current session:

- failed text cards are appended as the same item,
- failed map zones are wrapped back into the same map runtime shape,
- failed timeline items are wrapped back into the same timeline runtime shape.
- failed media, text-group, sequence, cloze, set and enumeration items are
  likewise requeued in their served runtime presentation.
- if separate chunks from the same group fail, relearning retries coalesce by
  presentation kind, group and mode where safe. Grid retries preserve their
  row/cell presentation constraints.

Android sync receives numeric, cloze, grid, set, and enumeration cards, but
mobile review currently selects only supported text/media-style cards. Mobile
status should show the count of synced desktop-only cards so they do not look
lost.

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
  consumers, default answer policy, and matching authority.
- Use joined or bulk queries to avoid N+1 work.
- Keep progress atomic even when multiple items are answered from one screen.
- Keep timeline grading and date normalization on the backend authoritative.
