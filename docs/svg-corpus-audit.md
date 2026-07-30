# SVG map compatibility corpus

This corpus exists to measure whether Nemoris understands a map, not merely
whether it can parse and display one.

The tracked real-world manifest contains 33 hash-pinned SVG maps from
[Wikimedia Commons](https://commons.wikimedia.org/). It covers a world map,
30 national subdivision maps, two deliberately unsegmented country outlines,
weak and strong IDs, semantic and presentation classes, labels, generated
editor metadata, internal XML entities, large path data, and single- and
multi-layer documents. Licenses and canonical source pages are recorded per
case in `backend/tests/fixtures/map_import/real-world-corpus.json`.

Third-party SVG bytes are not committed. Downloads live only in the ignored
`backend/svg-corpus-cache/` directory. The committed manifest pins their
SHA-256 hashes so a changed upstream file cannot silently alter the result.

The synthetic CC0 corpus remains the fast security and regression suite. It
now also contains:

- a dimensions-only SVG without a `viewBox`, reproducing the clipped-preview
  failure;
- a SimpleMaps-style SVG with feature IDs, numeric coordinate points, and
  duplicate label anchors, reproducing the Colombia detection failure;
- malicious XML/CSS, raster wrappers, local references, transforms,
  multipart zones, hit areas, semantic classes, path labels, and geometry-only
  layers.

## Compatibility definition

A real-world case passes its target only when all applicable conditions hold:

1. its workflow is no less automated than the declared target;
2. an interpretation has the exact intended zone count;
3. a declared ontology is selected correctly;
4. its compiled preview is parseable, scalable, answer-free, and contains no
   active content, external references, or leaked source IDs.

This is intentionally stricter than “the preview appeared.” A safely
sanitized map with the wrong 53 zones instead of 13 is a compatibility
failure.

## Baseline on 2026-07-30

| Measure | Result |
| --- | ---: |
| Real-world assets available and hash-matched | 33 / 33 |
| Exact intended workflow/count/ontology | 9 / 33 (27.3%) |
| Safe canonical previews | 30 / 33 |
| Canonical previews with a scalable `viewBox` | 30 / 33 |
| Parser/limit failures | 3 / 33 |

The current target passes are Austria (9 states), Canada (13 provinces and
territories), Finland (19 regions), Norway (15 counties), Russia (83 federal
subjects in this historical map), South Africa (9 provinces), Sweden
(21 counties), Turkey (81 provinces), and the United States (50 states plus
D.C.). The U.S. map imports automatically; the other eight expose an exact
assisted interpretation.

The baseline caught and now prevents four dangerous false automatic imports.
Canada’s 53 land-part IDs are grouped through its 13 parent/class selectors;
Finland’s two misleading Inkscape IDs no longer hide its 19-shape layer;
five Russian codes that coincide with U.S. postal codes no longer beat its
83-zone nested layer; and lowercase U.S. state classes are no longer mistaken
for 26 ISO country selectors. No incorrect real-world candidate in the frozen
corpus currently routes automatically.

Most other failures are over- or under-detection of decorative objects,
borders, label paths, or nested layers. France exceeds the current path-data
budget. Two otherwise legitimate Commons files use internal XML entities,
which the secure parser rejects. The two outline-only maps intentionally
expect the future manual workflow and currently demonstrate false positive
segmentation.

The full stable per-case result—source and canonical hashes, route,
diagnostics, interpretation fingerprint, counts, safety checks, and target
reasons—is stored in
`backend/tests/fixtures/map_import/real-world-audit-baseline.json`.

The M3A projection also records whether assisted repair is available for every
interpretation, its initial required/optional unresolved counts, multipart
count, readiness blockers, and a deterministic bulk-action estimate. Exact
user uploads remain untracked; their hashes, initial repair summaries, scripted
bulk actions, action counts, and canonical frames are frozen in
`backend/tests/fixtures/map_import/m3a-local-audit-baseline.json`.

## Running the audit

Refresh the untracked local cache and write a human-readable report:

```bash
PYTHONPATH=backend backend/venv/bin/python \
  backend/tools/audit_svg_corpus.py \
  --manifest backend/tests/fixtures/map_import/real-world-corpus.json \
  --cache-dir backend/svg-corpus-cache \
  --baseline backend/tests/fixtures/map_import/real-world-audit-baseline.json \
  --markdown-out /tmp/svg-corpus-audit.md \
  --check
```

Run reproducibly without network access:

```bash
PYTHONPATH=backend backend/venv/bin/python \
  backend/tools/audit_svg_corpus.py \
  --manifest backend/tests/fixtures/map_import/real-world-corpus.json \
  --cache-dir backend/svg-corpus-cache \
  --offline \
  --baseline backend/tests/fixtures/map_import/real-world-audit-baseline.json \
  --check
```

Add `--require-targets` only when the milestone is expected to satisfy every
declared compatibility target. Until then, `--check` still fails on download
errors, source hash changes, internal audit errors, or semantic baseline
drift.

The audit also continues to accept ordinary files/directories, catalogue
URLs, and an untracked local JetPunk catalogue directory. Network failures
are reported separately from importer failures.
