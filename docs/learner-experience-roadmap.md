# Roadmap - Learner Experience

Status: product roadmap, 2026-08-14. This document is intentionally written
from the learner's point of view. It is not an implementation plan for a single
branch.

Target platform: packaged desktop app. Browser/dev-only issues, such as missing
Tauri APIs outside the desktop shell, are not part of this roadmap unless they
also affect the packaged app.

## Goal

Make Nemoris feel like a learning companion, not only a powerful review engine
and content editor.

The app already has strong foundations:

- spaced review with independent progress per atomic fact;
- maps, media recognition, timelines, sequences, text groups, cloze, grids,
  sets, numeric cards, and enumeration/quota cards;
- free training modes with records;
- a calendar/load view;
- direct pack publishing and account-free pack installation;
- assisted SVG map import for authors.

The missing product layer is guidance: when a learner opens a group, tag, or
pack, the app should make it obvious what they are learning, where they are
weak, and what to do next.

## Product Principle

Keep the existing learning-data contract:

- one persisted `Question` is one atomic schedulable fact;
- progress belongs to `Question`, never to a group, pack, tag, runtime review
  object, or learning path;
- `QuestionGroup` remains presentation/source metadata only;
- grouped review screens are runtime presentations over atomic cards;
- Learn and Train modes can record practice evidence, but must not create hidden
  group-level scheduling;
- Review remains the only mode that moves scheduled review progress, except for
  existing explicitly scheduled answer endpoints.

New learner-facing features should mostly be derived views over questions,
groups, tags, packs, progress, training records, and review history. Persist new
state only for explicit user choices such as pinned goals, study preferences,
or saved paths.

## Current User Feedback

These are the product issues this roadmap is meant to address.

### Trust breakers

- A grouped/media review can be ended with `Terminer` before a choice is made,
  producing a full failure result. A learner can accidentally punish their
  schedule.
- Some grouped/relearning counters can read as `Question 0 / 0` while the screen
  clearly contains active items.
- Media-choice options are visually understandable but not meaningfully named
  for keyboard and accessibility workflows.

### Learning guidance gaps

- The app has Review and Training, but no first-class Learn mode for first
  exposure and guided discovery.
- Manage is excellent for editing, but it is not the right place to study a
  group without editing it.
- Profile and Calendar show useful data, but they do not yet tell a learning
  story: what improved, what is weak, what is decaying, or what is close to
  mastery.
- Packs feel like downloadable content. They should also feel like curricula:
  objective, difficulty, expected time, preview, progress, and recommended
  order.

### Polish and metadata

- French/Unicode metadata must remain intact end to end. Pack names, pack
  descriptions, tags, and themes should not lose accents. Only ZIP filenames
  should be slug-normalized.
- Theme facets should merge equivalent labels such as `Geographie` and
  `Géographie` instead of showing duplicate categories.
- The packaged desktop window should either enforce a usable minimum size or
  provide compact layouts for learner-critical screens.

## Target Experience

When a learner opens a group, tag, or installed pack, they should see:

- what it contains;
- how much is unseen, learning, fragile, stable, mastered, and suspended;
- what is due now and what is coming soon;
- recent mistakes and recurring confusions;
- the best next action;
- clear entry points for Learn, Train, Review, and Weak Items.

The primary new surface is a learner-facing Study screen:

```text
Study Group

Overview | Learn | Train | Weak Items | History

Mastered: 188
Stable:    31
Fragile:   18
Learning:  15
Unseen:     0

Recommended: Work on 7 recent confusions before today's review.

[Learn new] [Train weak items] [Review due] [Browse all]
```

This screen is separate from Manage. Manage remains the authoring/editing
workspace.

## Vocabulary

Use these words consistently in the UI and code comments:

- **Learn**: first exposure and guided discovery. Hints allowed. No scheduling
  penalty.
- **Train**: free practice and records. No review schedule mutation.
- **Review**: scheduled recall. Moves `Progress`.
- **Weak item**: an atomic question with recent misses, lapses, low success,
  low stability, or frequent confusion.
- **Confusion**: evidence that the learner picked or typed one item when another
  was expected.
- **Learning path**: an optional learner-facing collection/sequence of scopes.
  It does not own progress.
- **Study scope**: the thing being studied: group, tag subtree, collection,
  installed pack, or later a saved learning path.

## Milestones

### M0 - Review Trust And Safety

Purpose: make the existing review experience safe enough to build learning
features on top of it.

Work:

- Disable `Terminer` until the current grouped/media interaction has enough
  input, or rename it to an explicit abandon/correction action with
  confirmation.
- Fix grouped/relearning counters so they never show impossible states such as
  `Question 0 / 0`.
- Make media/map choice options expose useful accessible names and keyboard
  selection state.
- Ensure the recap distinguishes "not attempted", "wrong", "close/hard", and
  "correct" when the backend has enough evidence.
- Keep backend grading authoritative for grouped map/media/text/sequence
  submissions.

Acceptance:

- A learner cannot accidentally fail a whole grouped item by pressing a generic
  completion button before interacting.
- Counters match the current queue and served runtime presentation.
- Keyboard-only media choice review is usable.
- Scheduling history still records atomic question outcomes and answer-event
  context.

Relevant areas:

- `frontend/src/features/review/components/ReviewSession.jsx`
- `frontend/src/features/review/components/ReviewQuestionRenderer.jsx`
- `frontend/src/features/review/components/MediaReview.jsx`
- grouped answer endpoints in `backend/app/routers/review.py`
- `docs/review-flow.md`

### M1 - Group Mastery Summary

Purpose: expose a reliable learning status for each group/tag/pack without
inventing new progress.

Work:

- Add a backend summary service for a study scope:
  - total atomic questions;
  - due now;
  - unseen;
  - learning/fragile/stable/mastered buckets;
  - suspended;
  - recent misses;
  - lapses;
  - upcoming load;
  - available modes;
  - training records and stale records where applicable.
- Use existing `Progress`, review history, answer events, group metadata, tags,
  collections, pack subscriptions, and training records.
- Keep bucket thresholds conservative and documented. They can start simple:
  unseen, due, recent miss, low reps, mastered.
- Add pure tests for bucket classification and scope aggregation.

Acceptance:

- For a map/media/text/sequence group, the app can explain what is mastered,
  weak, unseen, and due.
- Group summaries do not create or update progress.
- Typo/content edits preserve earned records; membership changes, map
  replacement, and sequence reordering show stale records as old achievements,
  not current completion.

Relevant areas:

- `backend/app/services/progress.py`
- `backend/app/services/review.py`
- `backend/app/serializers.py`
- `frontend/src/features/training/hooks/useTrainingSession.js`
- `frontend/src/features/training/trainingRecordUtils.js`

### M2 - Study Group Screen

Purpose: give learners a home for studying content without entering Manage.

Work:

- Add a new top-level or nested route/mode for study scopes.
- Allow opening Study from:
  - Menu/Training group cards;
  - Manage selected group;
  - Calendar group recaps;
  - Pack detail panels for installed packs;
  - Profile weak-area cards when they exist.
- Build tabs:
  - Overview: mastery summary and recommended next action;
  - Learn: first-exposure/guided browsing entry;
  - Train: existing training modes filtered to this scope;
  - Weak Items: recent misses, lapses, and confusions;
  - History: records, recent sessions, and old/stale achievements.
- Keep edit actions out of the primary learner flow. Link to Manage only when
  the learner explicitly wants to edit source content.

Acceptance:

- A learner can open `Départements français`, understand progress, and choose a
  next learning action without visiting Manage.
- Study can represent groups, tags, collections/playlists, installed packs, and
  later learning paths through one scope model.
- No schedule changes happen from viewing Study.

Relevant areas:

- `frontend/src/App.jsx`
- `frontend/src/features/training/components/TrainingSession.jsx`
- `frontend/src/features/manage/components/ManageInspector.jsx`
- `frontend/src/features/calendar/components/CalendarGroupRecap.jsx`
- `frontend/src/features/packs/components/BrowsePacks.jsx`

### M3 - Learn Mode

Purpose: support first exposure and guided discovery before scheduled review.

Work:

- Implement Learn for one or two high-value content families first, preferably
  maps and media.
- Provide safe hints:
  - reveal first letter;
  - reveal region/tag/category;
  - narrow choices;
  - show neighboring/related items for maps;
  - show date neighborhood for timelines;
  - show answer after a deliberate action.
- Do not move scheduled review progress from Learn.
- Record optional practice evidence separately from review history if useful,
  or keep the first milestone read-only/training-record-only.
- Add a clear transition from Learn to Train or Review.

Acceptance:

- A new learner can learn a map/media group without being graded immediately.
- Hints are visible as learning aids, not hidden scheduling quality changes.
- The same atomic questions remain the units later reviewed by the scheduler.

Design note:

Learn should not become Manage-lite. It is for consuming and understanding
content, not editing labels, aliases, media, or source SVGs.

### M4 - Weak Items And Confusion Practice

Purpose: turn review mistakes into targeted practice.

Work:

- Derive confusion evidence from existing answer events:
  - expected question id;
  - selected candidate id;
  - raw response;
  - mode/direction;
  - candidate ids;
  - answer policy;
  - presentation kind.
- Build weak-item selectors:
  - recent misses;
  - high lapses;
  - low success in group;
  - due soon and fragile;
  - commonly confused pairs.
- Add training entry points:
  - `Travailler les erreurs récentes`;
  - `Travailler les confusions`;
  - `Nouveaux uniquement`;
  - `Presque maîtrisés`;
  - `À revoir avant demain`.
- Keep this deterministic before adding AI.

Acceptance:

- If the learner repeatedly confuses two countries, shapes, flags, dates, or
  sequence items, the app can surface that pair and offer practice.
- Confusion practice does not alter scheduled progress unless run through an
  explicit Review endpoint.
- Existing distractor selection can reuse confusion evidence without making
  choices overly punishing or circular.

Relevant areas:

- `frontend/src/features/review/distractorSelection.js`
- answer-event history written by grouped endpoints
- stats/profile services
- Training scope selection

### M5 - Session Debriefs

Purpose: make the end of a session pedagogical.

Work:

- Replace generic result pages with a learner summary:
  - completed count;
  - success by type/group;
  - new misses;
  - recurring misses;
  - notable confusions;
  - intervals changed;
  - what comes back tomorrow;
  - one recommended follow-up action.
- Keep detailed per-item rows available, but do not make them the only result.
- For grouped failures, communicate whether the learner failed one item, several
  items, or abandoned the group.

Acceptance:

- After review, the learner knows what to do next.
- The summary does not hide scheduling consequences.
- All numbers can be traced back to atomic answers and progress rows.

### M6 - Profile And Calendar As Guidance

Purpose: make global progress explainable.

Work:

- Add learner-facing cards:
  - weakest groups;
  - improving groups;
  - groups close to mastery;
  - fragile groups with upcoming load;
  - new material runway;
  - retention by type/tag.
- Add links from these cards into Study scopes.
- Add calendar tooltips or inline explanations for stacked day numbers and type
  bars.
- Preserve the dense calendar for experienced use, but make the first read less
  cryptic.

Acceptance:

- Profile answers "what am I good at, what is weak, what should I do today?"
- Calendar answers "why is this day heavy, and what is in it?"

### M7 - Packs As Curricula

Purpose: make packs feel like learning units, not only ZIP-backed content.

Work:

- Expand pack detail pages with:
  - objective;
  - difficulty;
  - estimated time;
  - item types;
  - preview samples;
  - included tags/themes;
  - installed progress summary;
  - recommended first action.
- Preserve direct-edit publishing. Do not reintroduce visible version management.
- Keep install account-free. Publishing/comments/ratings/authored management
  remain authenticated.
- Preserve Unicode metadata in catalog display and round trips. Normalize
  duplicate facets using canonical tag/theme keys plus localized labels.

Acceptance:

- A learner can decide whether to install a pack and how to start learning it.
- Installed pack pages link to the same Study scope model as local groups.
- Accent-sensitive metadata remains correct in local DB, pack ZIP, catalog, and
  UI.

## Learning Paths

Learning paths are useful, but they should come after Study scopes exist.

A learning path is a saved sequence of scopes, for example:

```text
Géographie mondiale
1. Continents and oceans
2. Countries of the world
3. Capitals of the world
4. Flags
5. Bordering countries
```

Rules:

- A path owns ordering, goals, and display metadata.
- A path does not own progress.
- Progress is aggregated from its scopes' atomic questions.
- A path can include groups, tag subtrees, collections/playlists, and installed
  packs.
- A path can recommend what to open next, but it should not hide the underlying
  scope.

Potential persisted shape:

```json
{
  "guid": "uuid",
  "name": "Géographie mondiale",
  "description": "",
  "items": [
    { "kind": "group", "id": 1 },
    { "kind": "tag", "id": "core:geography" },
    { "kind": "pack", "pack_guid": "..." }
  ],
  "settings": {
    "target_retention": 0.9,
    "new_item_policy": "balanced"
  }
}
```

Store only if the user explicitly creates paths. Do not make every group into a
hidden path.

## Data And Analytics Notes

### Mastery buckets

Initial bucket definitions can be simple and refined later:

- unseen: no progress or zero reps;
- learning: low reps or very short interval;
- fragile: due soon, recent miss, lapse, or low stability;
- stable: not due soon and non-trivial reps;
- mastered: high interval/stability and no recent lapse.

Avoid false precision. If the model cannot confidently distinguish stable from
mastered, show fewer buckets first.

### Confusions

Use `answer_event` before adding new tables. Valuable fields already exist or
should exist in review history:

- `expected_card_id`;
- `candidate_ids`;
- selected/resolved answer id;
- raw response;
- mode;
- direction;
- presentation kind;
- answer policy;
- backend matched/missed.

Confusion evidence is especially useful for:

- map zones;
- media choices;
- sequence ordering;
- timeline near misses;
- reverse text modes;
- enumeration omissions and duplicates.

### Training records

Do not erase earned records for cosmetic edits. Existing behavior should be
preserved:

- content typo edits can preserve records;
- membership changes, map replacement, and sequence reordering retire current
  records into stale display-only records;
- stale records are displayed as old achievements, not included in current
  completion or active best-time comparisons.

### Tags

Study scopes should use the existing tag hierarchy:

- stored tags are canonical ids/slugs;
- display labels are localized;
- hierarchy is a multi-parent DAG;
- filtering and rollups are descendant-aware.

This is important for future paths and weak-area summaries. Do not regress to
flat string tags in learner-facing summaries.

## UI Notes

- The first screen should continue to prioritize today's Review, but should add
  one learner recommendation when enough evidence exists.
- Manage remains an editing workspace. Avoid putting learner-study guidance in
  Manage as the primary surface.
- Use Study for consumption, Manage for editing, Training for free practice,
  Review for scheduled recall, and Calendar/Profile for global orientation.
- Keep French UI copy consistent. Avoid mixed `Review`/`Training` labels unless
  deliberately using product names.
- Avoid accidental destructive language. Buttons that affect scheduling should
  say so clearly.
- For narrow packaged windows, either enforce a minimum size or provide compact
  fallbacks for Menu, Review, Study, and Manage. A desktop-only product can still
  be resized into unusable dimensions.

## Non-Goals For The First Pass

- No AI-generated study advice in M0-M5. Deterministic evidence is enough.
- No social learning, leaderboards, challenges, or friends in this roadmap.
- No group-level progress.
- No automatic path generation before manual Study scopes work.
- No mobile parity for advanced desktop-only types unless explicitly scoped.
- No visible pack version UI.

## Suggested Implementation Order

1. Fix review trust breakers.
2. Add read-only group mastery summaries.
3. Add the Study Group screen for groups.
4. Connect Study from Training, Manage, Calendar, and installed Pack details.
5. Add Learn mode for maps/media.
6. Add weak-item and confusion selectors.
7. Add post-session debriefs.
8. Expand Profile and Calendar guidance.
9. Upgrade pack pages into curriculum pages.
10. Add saved learning paths.

## Verification Gates

Each milestone should include focused tests and a packaged-desktop smoke pass.

Minimum checks:

- backend tests for aggregation, bucket classification, and no progress mutation
  in Learn/Study;
- frontend tests for counters, disabled/renamed destructive review actions, and
  Study navigation;
- Playwright desktop screenshots for Menu, Review, Study, Training, Calendar,
  Packs, Profile, and Manage;
- keyboard-only smoke for media/map choices;
- pack metadata round trip with accents;
- no full-suite success claims without completed backend and frontend runs.

## Open Questions

- Should Study be a new top-level Menu destination, or should it be reached
  through Training/Packs/Profile until it proves itself?
- What exact thresholds define fragile/stable/mastered?
- Should Learn evidence be persisted separately, or should M3 start without
  persistence?
- Should paths be user-authored only, or can packs ship suggested paths?
- Should target retention be global only, or eventually per path/tag/group?
