# ADR: SVG map package v2 and safe legacy import

Status: accepted and implemented for the `nemoris-data-code-v1`,
`jetpunk-id-class-v1`, and `generic-svg-v1` adapters.

## Decision

Nemoris stores a canonical SVG asset plus an authoritative, versioned manifest
in `QuestionGroup.data["map"]`. The renderer binds only this manifest for v2
maps. Source IDs, classes, labels, `data-code`, and other author semantics are
not runtime interfaces.

```json
{
  "schema_version": 2,
  "canonicalizer_version": 1,
  "asset_sha256": "<64 lowercase hexadecimal characters>",
  "zones": [
    {
      "code": "FR",
      "shape_ids": ["s000001", "s000002"],
      "hit_shape_ids": ["s000003"],
      "source_keys": ["data-code:FR"]
    }
  ],
  "source": {
    "sha256": "<original SVG SHA-256>",
    "adapter": "nemoris-data-code-v1",
    "expected_zone_count": 101,
    "warning_codes": []
  }
}
```

Executable Pydantic validation rejects unknown schema/canonicalizer versions,
invalid hashes or shape IDs, empty geometry, duplicate codes, duplicate shapes,
and shape reuse across zones. Zone order is first rendered interactive
geometry order and therefore keyboard order. Canonical IDs are deterministic
`s000001` values and reveal no answer.

Each logical code owns one atomic `Question(type_q="map")`. Multipart geometry
does not create more questions. `Question.data.code` is identity and
`Question.data.aliases` is answer metadata. Existing unrelated group and
question JSON is preserved during import, editor saves, and upgrades.

## Readiness and migration

Readiness is derived per atomic question. A blank or whitespace-only map answer
is visible in Manage but excluded from review and training. Named zones remain
playable and independently scheduled while other zones are blank. The known
194-question/252-code map therefore upgrades to 252 questions with 58 blank,
disabled zones and keeps its 194 existing questions and progress.

Schema-1 local maps remain readable. Viewing never upgrades a map. An explicit
upgrade draft matches exact trimmed codes, blocks missing/duplicate/orphan
existing codes, preserves question IDs, GUIDs, progress, labels, aliases, tags,
favorites, collections and other data, and adds questions only for new codes.
There is no bulk migration.

Migration `0018_map_package_v2` is a capability gate with a pre-migration
backup and no content rewrite. Pack and sync minimum-schema checks make older
clients reject v2 data. Canonical media and manifest JSON use the existing
content-addressed pack, backup, restore and sync paths.

## Safe SVG subset

The importer parses with `defusedxml` and uses `tinycss2` plus `cssselect2` for
the CSS cascade. It retains SVG geometry, groups, definitions, gradients,
patterns, clipping/masking, local `<use>`, validated transforms, paint order
and allow-listed presentation properties. CSS is inlined before styles,
classes, and source IDs are removed. Local fragment references are rewritten
and validated.

It removes scripts, event attributes, animation, links, metadata, fonts,
`foreignObject`, external resources, unsupported URL schemes, `<text>` and
`<tspan>`. Embedded raster images route to the future manual workflow.
Unassigned paintable decoration receives `pointer-events="none"`. Interactive
leaves receive only `data-nemoris-shape`; `data-code`, `data-hit-area`, source
IDs, classes, and answers never enter canonical output.

Limits are 10 MiB input, 50,000 elements, depth 128, 8 MiB path data, 1 MiB
CSS, 12 MiB output, and a five-second soft deadline. URL imports allow only
public HTTP(S), revalidate DNS after each of at most three redirects, use a
bounded response and timeout, and never hotlink the result.

## Deterministic source interpretation

Canonicalization remains the only output boundary. Before source identifiers
are removed, M2 records an immutable local inventory of rendered shapes,
groups, IDs, classes, CSS usage, titles, accessibility names, text evidence,
closed/filled state, ancestry, transforms, and conservative bounding boxes.
Adapters consume those plain records and produce complete interpretations;
they never serialize source markup themselves.

`nemoris-data-code-v1` remains the strongest signal. The generic adapter
recognizes meaningful leaf/group IDs, semantic multipart classes, and
explicitly confirmed geometry-only sibling layers while ignoring generated
editor IDs and CSS-only classes. Geometry evidence alone is always assisted.

`jetpunk-id-class-v1` implements selector-key union semantics: a logical key
owns both the element with that ID and paintable elements carrying the same
class. Country, capital, grouped-capital, auxiliary dot/water, and US-state
layers remain separate interpretations. JetPunk presentation vocabulary is
never treated as zone identity.

Draft analysis is version 1. Multiple complete interpretations require an
explicit selection. `route` continues to record whether the source was
automatic, assisted, or manual; an assisted draft can become committable after
its complete interpretation is selected. The compiled package remains schema
2 with canonicalizer version 1.

Verified offline ontologies cover ISO alpha-2 entities and capitals, 50 US
states plus DC, and the 101 French departments. Verified matches seed new
question answers and aliases. Source-title proposals remain blank on commit
unless they validate against the selected ontology. Upgrades never replace
existing question content or progress.

The country snapshot is pinned through `countryinfo==1.0.1` (MIT), with French
territory labels from `Babel==2.18.0`/CLDR (BSD-3-Clause). The state codes are
reviewed against the U.S. Census national FIPS list, and the département codes
against the current INSEE COG. Small reviewed overrides cover JetPunk's `XK`
selector and capital-name/multi-capital cases. These resources are local at
runtime; the packaged sidecar explicitly collects CountryInfo's data files.

## Draft and transaction boundary

Drafts live under
`APP_DATA_DIR/map-import-drafts/<uuid>/{draft.json,analysis.json,source.svg,preview.svg}`.
Only `preview.svg` is served. Draft JSON uses atomic replacement. Drafts are
deleted on commit/cancel and expire after seven days. This directory is outside
database sync, packs, backups, and static media.

Creating, reading, patching, previewing, expiring, or deleting a draft makes no
database, media-registry, or sync mutation. Commit writes canonical media and
creates/updates the group, manifest, and atomic questions in one database
transaction. A new file is removed after rollback. Replaced media is collected
only after commit and only if unreferenced. The commit endpoint alone marks
sync dirty.

## Diagnostics

Diagnostics have stable `code`, `severity`, `stage`, parameter and shape lists,
and an acknowledgement flag. Current catalogue:

- `svg.invalid_xml`, `svg.invalid_root`
- `svg.input_limit`, `svg.element_limit`, `svg.depth_limit`,
  `svg.path_data_limit`, `svg.css_limit`, `svg.output_limit`,
  `svg.processing_deadline`
- `svg.unsafe_css_removed`, `svg.css_at_rule_removed`,
  `svg.css_selector_unsupported`, `svg.unsafe_css_value_removed`
- `svg.unsupported_elements_removed`, `svg.labels_removed`
- `svg.local_reference_missing`
- `svg.use_cycle`, `svg.unsupported_filter_removed`
- `svg.embedded_raster_requires_manual`, `svg.no_usable_data_code`
- `svg.invalid_zone_code`, `svg.nested_conflicting_codes`,
  `svg.unrendered_coded_definition`, `svg.missing_zone_geometry`
- `svg.expected_zone_count_mismatch`
- `svg.duplicate_source_ids`, `svg.generated_ids_ignored`
- `svg.multiple_interpretations`, `svg.interpretation_not_found`
- `svg.ontology_mismatch`, `svg.semantic_label_layer_removed`
- `svg.probable_path_labels`
- `map.upgrade_identity_conflict`

Warnings that can change appearance require explicit acknowledgement. A
supplied expected-count mismatch is an error and cannot be acknowledged; the
count must be corrected or cleared.

## Re-import identity

Source hashes support audit and change detection but do not define zone
identity. Exact trimmed logical codes define upgrade identity in this slice.
Changing a code is therefore a remove/add operation and is blocked by the
upgrade validator rather than silently moving progress. Generic ID/class and
JetPunk profiles produce the same manifest and obey the same rules.

## Deferred work

Shape-level include/exclude, arbitrary path-label classification, merging and
ungrouping, duplicate-inset repair, generated hit areas, manual drawing,
raster backgrounds, and structural re-import remain M3–M4.

The official JetPunk catalogue is intentionally not redistributed. The audit
command accepts an untracked local catalogue directory and commits only its
deterministic hashes/results. The current frozen report records Cloudflare's
HTTP 403 for the catalogue URL; completing the full-catalogue matrix therefore
requires a user-downloaded local snapshot, while synthetic convention fixtures
remain part of the normal test suite.
