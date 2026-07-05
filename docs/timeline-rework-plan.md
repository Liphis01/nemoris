# Timeline review rework

Goal: make placing dates on a timeline build durable spatial memory. Today the
canvas is a featureless, free-floating coordinate space — no landmarks, a frame
that never holds still, and a huge nominal range — so you lose track of *where
you are* and the "connect dates visually" idea breaks down.

Direction (chosen): **both, phased** — build an anchored landscape first
(Phase 1), then layer a reworked answering interaction on top (Phase 2).

**Status:** Phase 1 fully implemented (steps 1–9). Phase 2 (insertion/relative
placement) not started.

## Phase 1 — Anchored landscape

Keep absolute placement; add a stable shared frame, named era bands, curated +
mastered-card anchors, and a persistent breadcrumb. No grading changes.

Governing principle: **one stable, shared frame for the whole group.** The full
group range always fits on screen and stays the same picture across every
question in the session; zoom/pan become a *transient magnifier* that returns to
the shared frame. Same landscape every question → spatial memory can form.

### Data model

**Era table** (`frontend/src/features/timeline/anchors.js`), low-saturation tints:

| id            | span          | label                  |
|---------------|---------------|------------------------|
| prehistoire   | …→ -3000      | Préhistoire            |
| antiquite     | -3000→ 476    | Antiquité              |
| moyen-age     | 476→ 1492     | Moyen Âge              |
| moderne       | 1492→ 1789    | Époque moderne         |
| contemporaine | 1789→ …       | Époque contemporaine   |

**Curated anchor shape** (same file):

```js
{ id, label, start: { year, month?, day?, precision }, end?: {…}, tier: 0|1, eraId }
```

`tier 0` always shown; `tier 1` only when there's horizontal room. Seed set
(FR flavor): 476 Chute de Rome, 800 Charlemagne, 1492 Amérique, 1789 Révolution,
1914–1918 / 1939–1945 (span anchors), + **Aujourd'hui** (computed). Small tier-1
set (e.g. -52 Alésia, 1066, 1969) for when zoomed in.

**Mastered-card anchors** (backend) — new `build_mastered_timeline_anchors(db, exclude_ids)`
in `services/timeline.py`:

- Query `Question` where `type_q == "timeline"`, `id NOT IN exclude_ids`
  (current session items), join `progress`.
- Mastery filter (tunable): `interval >= 60 days AND reps >= 3`.
- Serialize → `{ source:"mastered", question_id, label: question.question,
  timeline: validate_timeline_data(data), center_value }`. Cap count (~40),
  prefer those near the group range.
- Attach as `anchors` on the timeline group: thread an optional
  `timeline_anchors` arg through `_serialize_review_items` (it lacks `db`), built
  by the caller that has the session + `db`. `exclude_ids` = due timeline ids.

### Frontend changes

**New** `anchors.js` (pure, unit-tested): era table, curated anchors, helpers —
`eraForYear(year)`, `centuryLabel(year)` (FR ordinals + BC), `decadeLabel(year)`,
`selectVisibleAnchors(allAnchors, viewport, widthPx)` (LOD + collision, reusing
spacing math from `buildTimelineScale`).

**`TimelineCanvas`** (`TimelineReview.jsx`):

- Replace grey `scale.bands` with **named era bands**; labels pinned to the
  *visible* portion of each band (map-label behavior).
- New **anchor layer**: tier-0 always, tier-1 + mastered via
  `selectVisibleAnchors`; off-screen anchors → edge arrows (`← 1492`). Styled
  quieter than answer chips.
- New **breadcrumb** replacing the `canvasDateContext` hint:
  `Époque contemporaine › XXe siècle › années 1940` +
  `Vue 1700–1820 · plage 400–2026`, from viewport center.

**Stable shared frame** (core behavior change):

- Resting `viewport` = full group range, computed from the group's **finest
  precision** (not the active question's), identical for every question.
- Reset to this frame on question switch (add `activeId` to the reset effect).
  Zoom/pan stay transient; keep Reset prominent. Optional: animation + idle
  auto-return.

**Minimap upgrade**: colored+named era zones and labeled anchor ticks instead of
bare dots.

### Anti-leak safeguards

- Mastered anchors exclude the session's own question ids.
- Resting frame is the full range — never centered on an unanswered answer.
- Client already receives each item's `timeline` (used only for precision/kind
  today), so filter out any anchor whose date coincides with the active
  question's expected date — no landmark sitting on the answer.

### Tests

- `anchors.test.js`: `eraForYear`, `centuryLabel` (BC + ordinals),
  `selectVisibleAnchors` density/collision, breadcrumb formatting.
- Backend: `build_mastered_timeline_anchors` — threshold inclusion/exclusion,
  session exclusion, cap.
- Extend `TimelineReview.test.jsx`: anchors render, breadcrumb shows, frame
  resets on question switch.

### Task order (each step independently shippable)

1. `anchors.js` + helpers + unit tests *(pure, no UI)*
2. Era bands + pinned labels
3. Breadcrumb
4. Anchor layer (curated only) + density + edge arrows
5. Stable shared frame + reset-on-switch
6. Minimap upgrade
7. **Backend** mastered-anchor query + payload wiring + tests
8. Merge mastered anchors into the layer + anti-leak filter
9. Polish: frame animation, density/mastery tuning

Steps 1–6 deliver the full orientation cure with curated anchors (frontend
only). 7–8 add the personal scaffold. 9 is polish.

### Tunables to settle during build

Mastery thresholds (interval/reps), anchor count caps, era tints, tier-1 anchor
set, density spacing px.

## Phase 2 — Rework the answering (on the same landscape)

Insertion instead of scrubbing: grab the current card and drop it relative to the
anchors and already-placed cards; the UI shows "after Waterloo · before WWI". A
drop position is still an absolute date, so `grade_timeline_answer` works
unchanged — Phase 2 is purely an input-affordance change on the Phase 1 canvas,
no backend work. A stricter before/after-only mode would need new ordinal
grading (later, optional fork).
