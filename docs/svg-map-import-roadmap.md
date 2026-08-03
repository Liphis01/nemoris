# Roadmap — Robust SVG Map Import

Status: active implementation roadmap, 2026-07-30. M0–M2 code is implemented;
the strengthened real-world audit currently meets 9 of 33 intended
workflow/count targets with no known false automatic result, so broad
automatic-import compatibility is still not a release claim. See
[the measured corpus report](svg-corpus-audit.md). The
non-redistributed official JetPunk catalogue gate still awaits a local
snapshot.

## Goal

Let a user turn an uploaded SVG into a safe, playable Nemoris map without
opening the file in Inkscape or editing XML.

The product promise is deliberately structural:

- the stored map is safe and self-contained;
- visible answers can be removed or hidden;
- every included logical zone is clickable, including multipart zones and
  tiny islands;
- one atomic `Question(type_q="map")` is created per logical zone;
- labels and aliases may remain blank for the user to complete later;
- ambiguous files enter an assisted workflow rather than being silently
  imported incorrectly;
- files with no usable vector zones can still become maps through in-app
  overlays.

This is a multi-milestone project, not one parser change. A useful automatic
importer can ship before the full manual geometry editor.

## Product decision

Do not adopt the current Nemoris `data-code` convention or JetPunk's
`id`/`class` convention as the new storage contract.

Instead:

1. Treat every uploaded SVG as an untrusted **source document**.
2. Convert it into a versioned **Nemoris map package**: a canonical sanitized
   SVG plus a separate zone manifest.
3. Keep the existing atomic question model. The manifest describes
   presentation and geometry; each question owns its label, aliases, progress,
   and stable logical zone code.
4. Accept different source conventions through import adapters and evidence
   detectors. `data-code` is the legacy Nemoris adapter. JetPunk is the first
   mandatory external compatibility suite, not the design center.
5. Render only the canonical package. Never make the runtime map component
   interpret arbitrary third-party IDs, classes, CSS, or scripts.

This preserves what was good in the original idea—the simple link between a
zone and an atomic question—without making authors encode that link manually
inside SVG source.

## Why full automatic interpretation is impossible

SVG describes how to draw an image, not what the image means. A path can be a
country, a border, a label converted to outlines, a lake, a duplicate inset,
or half of a multipart territory. Conversely, one intended answer can be many
paths, or several intended answers can be merged into one path.

The sample corpus discussed for this feature illustrates the range:

| Map | Intended ontology | Observed structural problem | Expected route |
| --- | --- | --- | --- |
| Brazil | 26 states + Federal District | 27 obvious coded objects | Automatic |
| France | 101 départements | 104 département-like paths because of inset duplicates; multipart Mayotte; labels and malformed metadata | Automatic with a known ontology, otherwise assisted |
| United States | 50 states, or 50 + DC | State fills mixed with more than 100 border paths | Automatic after an ontology choice |
| Germany | 16 states | 46 filled paths, arbitrary grouping, reused style colors, weak semantic IDs | Assisted |
| Japan | 47 prefectures | Some files contain merged landmasses and separately drawn borders or number labels | Assisted or manual overlay |
| World | 196 countries, or a larger territories set | Thousands of primitives, disputed ontology, multipart countries, inset/microstate circles | Automatic only with a declared ontology; otherwise assisted |

Therefore “almost any SVG” cannot honestly mean “always infer every answer
with zero confirmation.” It can mean:

- no source editing;
- automatic success for structurally clear files;
- a comprehensible assisted repair path for ambiguous files;
- an in-app manual fallback for every visually usable map.

## User-facing automation levels

### 1. Automatic import

Use when one high-confidence interpretation passes all gates:

- a safe canonical render can be produced;
- the candidate zones are closed/clickable geometries;
- no source object is assigned incompatibly to multiple zones;
- multipart grouping is unambiguous;
- visible labels are removed or hidden without removing geography;
- an expected count, when supplied, matches;
- the importer has no unresolved high-severity warning.

The result opens directly in the map editor. The user still sees a short
report and can undo the import.

### 2. Assisted import

Use when several interpretations are plausible. The user edits the inferred
zone model, not XML:

- choose the geographic layer;
- include or exclude candidate shapes;
- classify borders, water, labels, legends, and inset frames as decoration;
- merge several shapes into one logical zone;
- split a proposed grouping back into its component shapes;
- resolve duplicate insets;
- choose an expected zone count or ontology;
- review inferred labels and aliases;
- add or resize hit areas for tiny zones.

Every decision should be previewed on the map and be reversible.

### 3. Manual in-app zone creation

Use when the source has no useful zone structure:

- draw polygon, rectangle, circle, or ellipse overlays;
- combine several overlays into a multipart zone;
- select an existing visible vector object when one is usable;
- create transparent hit areas for islands or point locations;
- use the SVG or an embedded raster image only as a visual background.

Geometry snapping and a flood-fill/magic-wand tool are later improvements, not
requirements for the first manual editor.

## Canonical Nemoris map package

The package has three related parts with distinct responsibilities.

### 1. Canonical SVG asset

`QuestionGroup.media` continues to point to one backend-owned `/static/` SVG.
That SVG is generated by Nemoris and is:

- parsed and serialized by the backend rather than stored verbatim;
- stripped of scripts, events, external resources, unsafe URL schemes,
  `foreignObject`, metadata, and unsupported active content;
- assigned a valid `viewBox` and deterministic dimensions;
- normalized enough that browser behavior does not depend on editor-specific
  namespaces;
- made self-contained;
- annotated only with opaque Nemoris shape IDs;
- free of answer text by default;
- allowed to contain non-interactive decoration, with pointer events disabled;
- allowed to contain generated transparent hit-area geometry.

The original upload is staging input. It is not the asset used in review and
does not need to be retained after commit.

### 2. Versioned zone manifest

The semantic mapping belongs under a namespaced key in
`QuestionGroup.data`, alongside—not replacing—existing group data such as
training records. The implemented v2 shape is:

```json
{
  "map": {
    "schema_version": 2,
    "canonicalizer_version": 1,
    "asset_sha256": "<canonical SVG hash>",
    "zones": [
      {
        "code": "z_01",
        "shape_ids": ["s000001", "s000002"],
        "hit_shape_ids": ["s000003"],
        "source_keys": ["data-code:z_01"]
      }
    ],
    "source": {
      "sha256": "<original SVG hash>",
      "adapter": "nemoris-data-code-v1",
      "expected_zone_count": 101,
      "warning_codes": []
    }
  }
}
```

The authoritative schema and validator are recorded in
`docs/adr-map-package-v2.md`:

- the manifest is versioned independently of the database;
- logical zone codes map to one or more visual shapes;
- hit areas are explicit;
- source metadata is diagnostic, not runtime behavior;
- authoring readiness is derived per atomic question: blank answers are
  disabled while named zones remain playable;
- geometry remains presentation metadata, so no progress moves to the group.

Large transient analysis results should live in an import draft, not
permanently in `QuestionGroup.data`.

### 3. Atomic questions

Each included logical zone creates exactly one `Question`:

```json
{
  "type_q": "map",
  "answer": "",
  "group_id": 123,
  "data": {
    "code": "z_01",
    "aliases": []
  }
}
```

Rules:

- `Question.data.code` is a stable logical identifier, not necessarily a label
  or a source SVG ID.
- One code can reference several shapes through the group manifest.
- One shape normally belongs to one zone. Any exceptional overlap must be
  explicit and validated.
- A re-import that matches an existing logical zone preserves the question
  GUID, database ID, and `Progress`.
- Blank answers are allowed during authoring, but a draft group is excluded
  from review until the user resolves or excludes all required zones and marks
  it ready.
- There is still no group-level progress and no persisted `map_group`
  question type.

## Import pipeline

The backend owns the pipeline so desktop, packaged builds, packs, sync, and
future clients receive the same result.

### Stage A — Ingest into a draft

- Accept an SVG file upload.
- Later, accept “import from URL” by downloading server-side through the
  existing SSRF-safe media fetch rules.
- Enforce compressed and expanded size, XML depth, element count, path-data,
  and processing-time budgets.
- Compute a source hash and create a temporary import draft.
- Do not create a group or questions yet.

For maps, the current free-form URL field must become a staged URL import.
Hotlinking arbitrary SVG markup and injecting it at runtime is not compatible
with the safety promise.

### Stage B — Parse and canonicalize

- Use a real XML parser with external entity and network access disabled.
- Reject DTDs/entities and active content.
- Resolve safe `<use>` references and the subset of styles/transforms that the
  canonical format supports.
- Convert or flatten editor-specific constructs when deterministic.
- Preserve safe clipping/masks only if the renderer and sanitizer can validate
  them; otherwise report a degradation requiring confirmation.
- Assign every retained visual primitive an opaque shape ID.
- Produce a renderable preview before semantic detection.

Sanitization and canonicalization are different operations. Passing the
current `is_safe_svg` deny-list is not enough to make an SVG canonical.

### Stage C — Inventory and evidence graph

Build an inventory of:

- paths and basic geometry elements;
- groups and ancestry;
- IDs, classes, `data-*`, titles, descriptions, and accessibility labels;
- fills, strokes, opacity, visibility, and pointer behavior;
- text and text-like objects;
- bounding boxes, area, containment, adjacency, duplication, and overlap;
- external/embedded raster content;
- repeated inset or microstate symbols.

Candidate zones are formed from weighted evidence, not one attribute:

| Evidence | Typical strength |
| --- | --- |
| Existing Nemoris `data-code` | Very strong |
| Unique meaningful path ID | Strong |
| Repeated semantic class joining multipart shapes | Strong after style classes are excluded |
| `<title>`, accessible name, or nearby label | Medium to strong |
| Repeated sibling/group structure | Medium |
| Closed filled geometry with similar style | Medium |
| Geometry, adjacency, area, or color alone | Weak |

The report must explain why a candidate was included. A confidence number
without reasons is not sufficient for assisted editing.

### Stage D — Candidate interpretations

Generate one or more complete interpretations:

- zone set;
- shape-to-zone mapping;
- decoration set;
- proposed labels/aliases;
- suspected duplicate insets;
- missing/unassigned shapes;
- count and ontology compatibility;
- warnings and required user decisions.

Expected count is a first-class constraint, but not proof. “101 shapes” can
still include a border and omit a département.

### Stage E — Route by confidence

- Commit-ready interpretation: automatic.
- Several plausible interpretations or recoverable warnings: assisted.
- No usable vector segmentation: manual overlay.
- Unsafe or unrenderable source: reject with a precise explanation; if a safe
  raster preview can be produced later, offer it as a background for manual
  overlays.

### Stage F — Compile and commit transactionally

On confirmation:

1. serialize and store the canonical SVG through the media registry;
2. create/update the map group and versioned manifest;
3. create/reconcile one atomic question per logical zone;
4. preserve existing question identities and progress where matched;
5. remove the temporary draft/source;
6. commit all database changes together, or roll everything back;
7. garbage-collect superseded canonical media only when unreferenced.

## Source adapters and compatibility

Adapters do not bypass the generic pipeline. They contribute evidence,
reserved styling vocabulary, label dictionaries, and validation rules.

### Legacy Nemoris

- Interpret `data-code` as a strong zone signal.
- Preserve duplicate `data-code` elements as multipart geometry.
- Interpret `data-hit-area="1"` as a hit-area hint.
- Generate the v2 manifest without changing question identities.

This is the migration bridge, not the future authoring requirement.

### Generic SVG

- Consider meaningful IDs on shapes and groups.
- Separate CSS/style classes from semantic grouping classes.
- Consider `title`, text proximity, tree structure, and geometry.
- Never assume every path or every class is a zone.
- Surface identifier-bearing shapes in assisted mode even when automatic
  grouping fails.

### JetPunk compatibility

JetPunk's official guide says its interactive mapping uses IDs and classes on
paths; IDs select one path and a shared class can select several paths. Its
standard maps use predictable conventions such as lowercase ISO country codes,
uppercase US state codes, and suffixes/classes for capitals and small markers.

References:

- [JetPunk SVG guide](https://www.jetpunk.com/svg-guide/advanced-inkscape?device=desktop)
- [JetPunk standard SVG catalogue](https://www.jetpunk.com/img/jetpunk-svgs/)
- [JetPunk terms of service](https://www.jetpunk.com/terms-of-service)

Compatibility is defined in tiers:

1. **Official standard catalogue:** every safe catalogue SVG in a frozen audit
   must be structurally importable without source editing. Unambiguous declared
   map layers must import automatically with their expected count; maps that
   intentionally combine several quiz layers may ask the user to choose one.
2. **Custom JetPunk-compatible SVG:** every safe identifier-bearing path must
   be available in automatic or assisted import; shared semantic classes must
   support multipart zones; the user never edits XML. Automatic labels are not
   promised without the quiz's answer table.
3. **Malformed or unsafe SVG:** safety wins. The file is rejected or reduced to
   a safe manual background; compatibility never means executing active
   content.

Implementation should use the same adapter/profile interface for JetPunk,
legacy Nemoris, editor exports, and future dialects. There should be no
JetPunk branch in `SvgMap`.

Do not make direct JetPunk URL scraping a release requirement. Third-party
servers can block automated downloads. Uploading a file the user has downloaded
is the reliable baseline. Also do not bundle or redistribute JetPunk's map
catalogue until its external-use license is clear; compatibility testing can
use an audit tool, permitted fixtures, and small synthetic structural fixtures.

## Labels and hidden answers

Visible answer removal needs several strategies:

- remove ordinary `<text>`/`<tspan>` labels classified as answers;
- remove linked label backgrounds/leaders when confidently identified;
- recognize number labels used only as answer keys;
- preserve non-answer titles, scale bars, or legends when the user chooses;
- hide label-shaped paths only with strong evidence or user confirmation;
- always show a before/after preview in assisted mode.

Label inference is optional. Candidate sources include IDs, titles, adjacent
text, standard code dictionaries, and user-provided answer data. If confidence
is low, leave `answer` and `aliases` blank. Never leak a guessed answer by
leaving visible text in the playable SVG.

## Assisted editor UX

The importer should feel like an extension of the current embedded Map editor,
not a separate vector-design application.

Recommended layout:

```text
Import steps / diagnostics | Large map preview | Zone/selection inspector
```

Required interactions:

- hover links the map, candidate list, and source evidence;
- click selects one shape or proposed logical zone;
- Shift-click adds/removes shapes from a selection;
- merge, ungroup, include, exclude, mark decoration, mark label;
- show unassigned and multiply assigned shapes;
- change interpretation/layer without losing manual edits;
- expected-count display with included/excluded/unnamed totals;
- filter to warnings, tiny zones, duplicates, and unnamed zones;
- undo/redo for structural edits;
- keyboard navigation and autosave for a staged draft;
- explicit local scrolling for long lists, preserving the fixed Manage layout.

Do not create the real group before confirmation. Cancelling an import should
leave no orphan group, questions, or media.

## Re-import and structural editing

Replacing the SVG must be a reconciliation workflow, not “delete and recreate.”

Matching evidence, in order:

1. existing manifest/source key;
2. unchanged logical code;
3. source ID/class signature;
4. geometry fingerprint and relative position;
5. label/ontology identity;
6. user confirmation.

The preview categorizes zones as unchanged, moved, added, missing, split,
merged, or ambiguous.

- Unchanged/moved zones retain the existing question and progress.
- Added zones create new questions.
- Missing zones are not silently deleted.
- Splitting or merging reviewed zones requires explicit confirmation because
  there is no honest automatic way to divide or combine progress.
- Re-import creates a new canonical asset revision only after reconciliation
  succeeds.

## Security boundary

The current system validates uploaded SVGs with a small deny-list, permits a
raw external map URL, fetches it in the browser, and inserts its text with
`innerHTML`. That is a prototype boundary, not the target architecture.

Release gates for the new importer:

- canonical map assets are same-origin backend-owned files;
- the runtime never loads a third-party SVG directly;
- external references, fonts, stylesheets, images, and network-capable
  constructs are removed or materialized under explicit rules;
- parser/entity expansion, deeply nested XML, extreme element counts, and huge
  path strings have resource limits;
- all attributes and CSS values are allow-listed or normalized;
- non-zone elements cannot intercept clicks;
- no unsanitized preview is placed in the DOM;
- malicious SVG regression fixtures cover script/event variants, namespace
  tricks, CSS URLs, `<use>` chains, data URLs, and denial-of-service inputs.

The runtime may still display canonical SVG markup, but it should consume a
trusted serialized format and bind interactions from the manifest rather than
discovering source semantics.

## Persistence, packs, backup, sync, and consumers

The proposed package fits the current model well:

- canonical SVG stays normal content-addressed media;
- the versioned manifest stays in `QuestionGroup.data["map"]`;
- questions keep their existing GUIDs, codes, aliases, and progress;
- packs already export group media and group data;
- backup already includes the database and registered media;
- full sync already transfers the database and media by hash.

Work is still required to prove the round trip:

- include the map manifest in Manage, review, training, and calendar payloads
  that render `SvgMap`;
- update every renderer to bind manifest shape IDs to zone codes;
- keep a schema-1 renderer during migration;
- add pack export/import/update tests for a multipart v2 map;
- ensure pack content hashes change when the manifest or canonical SVG changes;
- add backup/restore and sync tests for the same fixture;
- update any mobile review fixture/consumer before a v2-only map can reach it;
- reject packs requiring a newer unsupported map schema with a useful message.

No new group progress, collection duplication, or persisted runtime group type
is needed.

## Migration strategy

Avoid a destructive all-at-once rewrite of user maps.

1. Add dual-read support: schema-1 `data-code` maps continue to work exactly as
   they do now.
2. New imports produce schema 2 only.
3. Offer “Upgrade this map” for a deterministic legacy conversion:
   parse the local SVG, map existing `Question.data.code` values to shapes,
   generate the manifest/canonical SVG, and preserve every question and
   progress row.
4. Keep legacy external-URL maps readable temporarily, but require a staged
   download/canonicalization before structural editing or publication.
5. After the converter and backup/restore gates are proven on real data, add a
   batch upgrade with the normal pre-migration backup.
6. Remove schema-1 runtime support only in a later release with a measured
   compatibility report and no remaining legacy groups.

## Milestones

### M0 — Contract, corpus, and compatibility matrix

- [x] Write an ADR for the v2 package and authoritative fields.
- [x] Define import-draft and diagnostic JSON schemas.
- [x] Freeze a representative test corpus: clean coded maps, noisy layers,
  multipart territories, duplicate insets, label paths, `<use>`, CSS classes,
  raster-in-SVG, merged maps, and malicious inputs.
- [x] Record ontology and expected counts separately from the SVG.
- [x] Build a JetPunk catalogue audit command/report without vendoring
  unlicensed assets.
- [x] Record automatic/assisted/manual expected outcomes per fixture.
- [x] Prototype canonical render equivalence on the hardest safe constructs.

Exit gate: the schema can represent every corpus case, including manual
overlays, without changing the atomic question model.

### M1 — Safe canonicalization and legacy bridge

- [x] Add staged map upload and import-draft lifecycle.
- [x] Build the strict parser, resource budgets, sanitizer, canonical serializer,
  and diagnostics.
- [x] Replace the map URL hotlink path with staged server-side import.
- [x] Add manifest-aware `SvgMap` binding while retaining schema-1 support.
- [x] Convert clean legacy `data-code`/`data-hit-area` maps.
- [x] Add security and render regression tests.

Exit gate: an existing Nemoris map can be upgraded with identical zone
behavior and preserved progress, and no untrusted source markup reaches the
runtime DOM.

### M2 — Deterministic automatic import and JetPunk compatibility

- [x] Implement inventory/evidence extraction.
- [x] Add generic ID, class, title, group, text, and geometry detectors.
- [x] Add expected-count and ontology inputs.
- [x] Implement label stripping and code-dictionary label proposals.
- [x] Add the declarative JetPunk compatibility profile.
- [x] Generate an explainable import report and confidence route.
- [x] Commit group, manifest, media, and atomic questions transactionally
  (landed in M1 so later adapters reuse it).

Exit gate:

- clean obvious SVGs complete without source editing;
- the frozen official JetPunk catalogue passes its compatibility matrix with
  no source-editing exceptions;
- arbitrary safe JetPunk-style custom files expose all identifier-bearing
  candidate zones and never require XML editing.

The first and third gates are covered by tracked synthetic and local fixtures.
The catalogue URL currently returns a Cloudflare HTTP 403 to the offline audit
client. `audit_svg_corpus.py --jetpunk-dir <downloaded-directory>` is the
release gate once an untracked browser-downloaded snapshot is supplied; the
third-party SVG assets themselves remain outside the repository.

### M3 — Assisted import

M3A landed as a focused, full-width Manage workspace. It keeps all work in
device-local, resumable drafts and compiles every accepted edit through the
same safe canonicalizer as automatic imports.

- [x] Extend the M2 interpretation chooser into the full assisted editor.
- [x] Add include/exclude/decoration/label classification.
- [x] Add zone creation, assignment, merge, explode, and duplicate-point
  resolution.
- [ ] Add tiny-zone hit-area creation and editing (M3B).
- [x] Add warnings, count reconciliation, revision-checked undo/redo, and
  draft autosave.
- [x] Support blank labels and a clear draft-to-ready checklist.
- [x] Preserve independent repair branches when switching interpretations.
- [x] Add safe inspection SVGs with opaque authoring references that never
  enter committed assets.

Exit gate: the France, US, Germany, and complex world fixtures can be made
correct entirely in Nemoris, with an action count low enough to be practical.

The two user-reported uploads are frozen by hash without redistributing their
bytes. The 52-zone Spain upload needs no structural action after interpretation
selection (only the low-risk decoration acknowledgement); the 34-zone Colombia
upload needs one bulk action on its `points` layer. Both preserve their full
source frame and commit one atomic question per zone. Synthetic CC0 fixtures
exercise both structures in CI.

### M4 — Manual overlays and re-import

- [ ] Add polygon, rectangle, ellipse/circle, and multipart overlay tools.
- [ ] Allow safe raster/vector backgrounds with overlay-only zones.
- [ ] Add snapping and optional vector-object selection.
- [ ] Implement structural re-import diff and identity reconciliation.
- [ ] Require explicit decisions for reviewed zone splits/merges/removals.

Exit gate: merged Japan and raster-in-SVG fixtures can become playable without
external software, and replacing a map does not reset unchanged progress.

### M5 — Ecosystem and hardening

- [ ] Add an openly licensed template/ontology library rather than relying on
  third-party proprietary catalogues.
- [ ] Add optional answer-table import adapters where a source platform exports
  them.
- [ ] Add performance budgets and large-world-map benchmarks.
- [ ] Add accessibility for keyboard zone selection and diagnostics.
- [ ] Prove packs, pack updates, backup/restore, sync, training, review,
  calendar recap, and supported mobile surfaces.
- [ ] Add telemetry-free local diagnostics export for bug reports.
- [ ] Consider flood fill/magic wand only after overlay basics are stable.

Exit gate: v2 is the default and schema-1 removal can be planned from measured
usage rather than assumption.

## Acceptance criteria for the feature as a whole

- Users never need to open or hand-edit SVG/XML.
- Unsafe input cannot become active runtime markup.
- Every committed logical zone has exactly one atomic question.
- Multipart zones and hit areas work in edit, review, recap, and training.
- Answers are not visibly leaked by the playable asset.
- A stated expected count is checked and discrepancies are explained.
- Automatic import does not silently choose between materially different
  ontologies.
- Assisted and manual edits are reversible and survive reopening the draft.
- Re-import preserves unchanged question GUIDs and progress.
- Pack, backup, restore, and sync round trips preserve the canonical asset,
  manifest, questions, and identities.
- Existing Nemoris maps remain usable throughout migration.
- The JetPunk compatibility tiers above pass an auditable fixture/report gate.

## Recommended first implementation slice

Start with M0, then implement the narrow vertical slice of M1:

1. upload a local SVG into a temporary draft;
2. canonicalize it safely;
3. recognize only legacy `data-code` zones;
4. produce the v2 manifest and preview;
5. commit while preserving existing atomic question behavior;
6. round-trip that map through a pack and backup.

This establishes the permanent security and data boundaries before adding
heuristics. The next slice can add generic IDs/classes and the JetPunk audit
without rewriting storage or rendering again.
