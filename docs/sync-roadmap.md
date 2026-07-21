# Roadmap — Accounts, Blueprints & Sync

Goal: let users work from multiple devices (Anki model: full sync + fallback
on conflict), and publish content "blueprints" (e.g. countries of the world)
that anyone can add to their own database.

Guiding principle: **the local database stays single-user forever.** Only the
server is multi-tenant. Existing queries are never touched.

Overall order and why:

1. **M0 — Schema foundations** first: every day with users makes these
   migrations more expensive. Zero visible change, everything else depends on it.
2. **M1 — Blueprints** before accounts: user value with no server at all, it
   forces the identifier/media machinery that sync needs anyway, and it makes
   the sync payload small (blueprint content re-downloads from the catalog,
   it does not sync).
3. **M2 — Accounts + full sync**: Anki's fallback mechanism (one side wins
   wholesale) is the one that handles the hard cases. We build it first.
4. **M3 — Incremental sync**: an optimization, only if M2 hurts in practice.
   Explicit decision gate, not a commitment.

---

## M0 — Schema foundations (~1 to 1.5 weeks)

No user-visible change. Each step = a versioned migration in `migrations.py`
(auto-backup before migrating: already in place) + tests.

### 0.1 GUIDs on content

- [x] `guid` column (UUID4, unique, indexed) on `Question`, `QuestionGroup`,
      `Collection`. Backfill in migration `0010`. Integer PKs stay — the GUID
      is the stable identity that survives export/import (the role of Anki's
      note GUID).
- [x] Generate the GUID at creation everywhere — done via a column-level
      `default=` callable on the models: every creation path is ORM-based
      (verified: no raw/Core inserts anywhere), so no per-service changes
      were needed.
- [x] Test: export → import → re-import does not duplicate (prepares M1).
      `import_blueprint()`'s two pre-write guards (`already_subscribed`,
      `guid_collision`) both run before any row is written, so a rejected
      re-import is atomic by construction. `test_reimporting_same_blueprint_is_rejected`
      and `test_local_guid_collision_is_rejected` (`test_blueprints.py`)
      strengthened with explicit before/after row-count assertions
      (QuestionGroup/Question/BlueprintSubscription) to prove zero
      duplicate/partial writes, not just that a `ValueError` is raised.

### 0.2 Revlog: move history out of `Progress`

The heart of the work. **Design: snapshot-carrying rows, not bare ratings.**
`update_progress()` is NOT purely deterministic (interval fuzzing is on by
default, and mode-difficulty/tuning parameters evolve over time), so a bare
(rating, date) log could never reproduce stored state. The existing history
entries already solve this correctly: each records the post-review snapshot
(stability, difficulty, reps, lapses, interval, ideal_*, fsrs_rating/state/
version, mode factors, repeat_lapse) — see `record_answer_history()` — and
`restore_progress_from_history()` already rebuilds Progress from entries
alone. The revlog keeps exactly that shape, one row per entry.

- [x] `review_log` table mirroring the current entry shape (migration `0011`):
      promoted columns (`question_id`, `question_guid`, `seq`, `reviewed_on`,
      `reviewed_at`, `quality`, stability/difficulty/reps/lapses/intervals,
      `superseded_by`) + full entry snapshot in `data` JSON — zero loss.
- [x] Re-grading modeled as corrections: `replace_latest_scheduling()`
      appends the replacement row and sets `superseded_by` on the old one.
      Never deletes; readers filter superseded rows.
- [x] Frozen relearning retries leave no revlog row (parity with history via
      the existing `skip_history` guard — structural, no extra code).
- [x] Migration backfill verified on the real DB: 5085/5085 entries migrated,
      exact JSON parity, contiguous seq, zero NULL guids. The `history`
      column stays readable this version; drop it in a later one once
      readers have switched.
- [x] Dual-write live: `record_answer_history()` (single choke point) mirrors
      every entry into `review_log`; `db` + guid threaded through
      `apply_scheduling_batch` → `write_scheduling`.
- [x] **Decision (2026-07-20): do not switch the remaining readers, do not
      drop `Progress.history`.** Scoped the full read surface: 14 call sites
      across `serializers.py`, `stats.py`, `routers/review.py`,
      `services/review.py`, `fsrs_migration.py`, `scheduler_tuning.py`, and —
      the blocker — `mode_selection.py`, `text_modes.py`, `map_modes.py`,
      `sequence_modes.py`, `image_modes.py`. That last group reads
      `progress.history` deep inside per-question mode-selection, called on
      already-loaded ORM objects with **no `db` session in scope**. Switching
      them means threading a session through five hot-path files for zero
      functional gain: the JSON column and `review_log` are proven identical
      (0.3's 918/918 gate) and dual-write keeps them in permanent lockstep.
      Nothing in M1 or M2 reads through these functions — blueprints and sync
      consume `services/revlog.py` directly. Revisit only if the column's
      storage cost ever matters (it doesn't: JSON history is a few KB/card).
- Note: no history-reset or Progress-deletion paths exist in the app today
  (verified); revlog rows for a deleted question would simply orphan —
  deletion semantics arrive with tombstones (0.4).

### 0.3 Restore-from-revlog + formalizing ideal/active

The schema already anticipates the right split (`ideal_*` vs active,
models.py L133-142) — with one correction to the original plan:

- **`ideal_interval` / `ideal_next_review`** = written at review time by the
  device that performed the review. Because of interval fuzzing they are NOT
  recomputable identically → they sync **as data** (carried in the revlog
  snapshot), not implicitly.
- **`interval` / `next_review`** = output of `rebalance_review_calendar()`,
  a *global* local operation, re-runnable → **never syncs**.
- **Memory state** (stability/difficulty) IS deterministic forward-replayable
  from recorded inputs: fuzz only touches due dates, and each row records the
  mode factors that were applied. This is what makes an M3 merge possible;
  scheduled dates after a merge are recomputed and expected to differ.
- Update 2026-07-20: mode-difficulty and scheduler-tuning parameters are now
  **frozen** (the tuning phase to find good values is over). This further
  strengthens forward-replay — recorded per-row factors remain the safety
  net, but parameter drift is no longer expected.

- [x] `restore_progress_from_revlog()` in `services/revlog.py` — feeds active
      revlog rows into the existing `restore_progress_from_history()`. First
      real reader of the table. `manage_data.py validate-revlog` runs the
      property check repeatably (the gate before dropping `history`).
- [x] Property validation on the real DB (2026-07-20): **917/918 strict
      match** on memory state + ideal_*. The single mismatch is
      `graduate_relearning` ("Acquis"), which moved `ideal_*` without a
      history entry — resolved: graduation now appends a no-grade manual row,
      and migration 0012 reconciled historical divergence (gate now
      **918/918**). Re-grades supersede trailing manual rows too.
      33 questions show interval/next_review drift from rebalancing —
      expected, that is the ideal/active split working.
- [x] Forward-replay harness (`replay_memory_state`, fuzz off, recorded mode
      factors): modern rows replay to float precision; historical divergence
      confirmed in three explained classes — (1) pre-FSRS-v6 entries
      (296 questions), (2) same-day fail chains recorded before the
      repeat-lapse freeze existed, (3) rows under older tuning mappings
      (params frozen 2026-07-20). ~20% of all rows replay; going forward
      it is deterministic. Snapshots stay authoritative; M3 refinement:
      apply recorded penalty/reward factors directly instead of recomputing.
- [x] Rules documented in `docs/architecture.md` ("Review Log & Sync Rules").

### 0.4 Tombstones

Deleting a question on the laptop then syncing must not resurrect it from the
desktop. Deletions have to be recorded, not just absences. Trivial now,
painful to retrofit.

- [x] `tombstones` table (migration 0013): `entity_type`, `guid`,
      `deleted_at`. Written by every deletion path —
      `delete_question_dependents()` is the single question choke point,
      plus the group/collection delete endpoints and empty-group cleanup.
      Generated collections cannot be deleted (guarded). 0013 also backfills
      tombstones from orphaned revlog guids (none existed on the real DB).
      Media tombstones deferred to 0.5 content-addressing.
- [x] **Purge — N/A for now, not forgotten.** Tombstones have no functional
      role in M2 (full-DB-replace sync self-enforces deletions — a deleted
      row's absence from the pulled snapshot is already authoritative;
      confirmed zero references to "tombstone" anywhere in `sync_client.py`,
      `supabase_sync_client.py`, `sync_server/*.py`); their only purpose is
      enabling correct M3 delta-sync merges. Purging now would destroy
      history a future M3 needs, for zero present benefit (the table —
      `entity_type`, `guid`, `deleted_at` — is tiny at this app's scale).
      Automatic purging keyed to per-device `last_server_version` (the
      original literal wording) would also be actively unsafe — that field
      is per-device only (`sync_state.py`) with no cross-device consensus,
      so device A purging after its own sync could delete history device B
      still needs. Revisit only if/when M3 is triggered, or if table size
      ever becomes an observed problem — a manual opt-in
      `manage_data.py purge-tombstones` CLI (following the `validate-revlog`
      precedent) is the concrete next step then, not automatic purging.

### 0.5 Content-addressed media

Needed for M1 (blueprint dedup) and M2 (idempotent sync).

- [x] **Design deviation (better than planned):** a `media_files` registry
      table (path → sha256 → size, migration `0014`) instead of hash columns
      on content rows, and **no file moves** — files keep their uuid names,
      the registry adds identity. Normalized (one row per file, shared map
      SVGs stay one entry), zero frontend impact, zero migration risk on
      31 MB of media. Real DB: 689 files hashed, 9 duplicates detected.
- [x] Serve by hash: `GET /media/blob/{sha256}` next to the existing
      filename-based `/static/` mount.
- [x] Upload: hash on receipt in `store_media_bytes()` (single choke point,
      covers uploads, URL imports, media-group uploads), dedup when the
      content already exists; deletion unregisters + writes a media
      tombstone (guid = sha256) when the last copy goes.
- [x] `backups.py` needs **no change**: the registry travels inside the DB
      and the static layout is unchanged — manifest stays `format: 1`.

### 0.6 Settings namespacing

`AppSetting` mixes collection-level settings (FSRS params, daily limits →
must sync) with device-level ones (window state, volume → must never).

- [x] **Design deviation:** a classification map in code
      (`SYNC_SETTING_KEYS` / `DEVICE_SETTING_KEYS` in `services/settings.py`
      + `sync_settings_payload(db)`) instead of renaming keys with prefixes —
      same guarantee, zero migration, zero call-site churn. Classified:
      `review`, `scheduler_tuning`, `tag_hierarchy` → sync;
      `startup_rebalance_notice`, `fsrs_v6_migration` → device. Unknown keys
      default to device-local (never sync what is not understood).

### 0.7 Exposed schema version

- [x] `GET /meta/schema-version` (routers/meta.py) reports
      `code_version` / `database_version` / `pending` from the migration
      registry. The sync server (M2) will refuse a client that is too old
      rather than corrupt a collection.

**Definition of done M0 — reached 2026-07-20.** All migrations (0010-0014)
pass on the real database; `validate-revlog` gate is 918/918; backup
export/import unchanged; guids on all content; tombstones on every deletion
path; media content-addressed with dedup; settings classified for sync;
`/meta/schema-version` live. `Progress.history` intentionally kept (see 0.2
decision above) — it is a proven-redundant cache, not a liability.
`graphify update .` current. 297 backend tests pass.

---

## M1 — Blueprints (~2 weeks)

Versioned, installable, updatable content packages. No account required, no
application server: static files + a JSON index.

### Decisions to make (before coding)

- **D1 — Package format**: zip containing `manifest.json` (blueprint guid,
  integer version, name, description, license, minimum schema version),
  `content.json` (questions/groups/collections with their GUIDs, **no
  progress**), and `media/<sha256>.<ext>`.
  → Recommendation: JSON rather than an embedded SQLite (diffable,
  inspectable, no schema-drift risk). Keep the zip+manifest shape from
  `backups.py`, reusable code.
- **D2 — Catalog hosting: decided (2026-07-21) — Supabase Storage**, not
  GitHub Releases/Pages as originally sketched. A public `blueprints` bucket
  in the same Supabase project used for M2 sync (deliberately separate from
  the private `sync-collections` bucket). Zero extra infra to stand up since
  the project already exists for accounts; revisit only if free-tier
  bandwidth/storage limits ever bite.
- **D3 — Copy vs reference**: **decided — copy with bookkeeping.** Every
  copied row records `blueprint_guid`, `blueprint_version`, `content_hash`.
  This is the accounting Anki lacks, and what makes updates possible.

### Steps

- [x] 1.1/1.2 **Export + import/subscribe — done (2026-07-20).** Backend only
      (`services/blueprints.py`, `routers/blueprints.py`, migration `0015`).
      Export unit is `QuestionGroup` (not `Collection` — type-homogeneous,
      owns the shared media; Collection export is a future flatten-to-groups
      extension, not built). Progress always excluded (Anki's "include
      scheduling information", permanently unchecked — verified: content.json
      never contains progress fields even when a question has reps/history).
      Generated collections (`sync_generated_hard_collection`) never enter
      this path since export starts from a group, not a collection.
      - **Imported rows reuse the source `guid` verbatim**, not fresh ones —
        required for 1.3's diff-by-guid to work with no extra column, and
        costs nothing since guid uniqueness is per-local-file, consistent
        with M2 excluding blueprint content from the personal sync payload.
      - Bookkeeping (`blueprint_guid`, `blueprint_version`, `content_hash`)
        is plain nullable columns on `Question`/`QuestionGroup`, not a side
        table — mirrors how `guid` itself was added.
      - `content_hash` = sha256 of a canonical field-subset dict (excludes
        id/guid/group_id/progress; media is a content-addressed ref, never a
        local path), independently recomputed by both sides, never trusted
        as an exporter-supplied value.
      - `blueprint_subscriptions` table (guid, installed_version, source,
        subscribed_at) — no `group_id` FK, the owning group is found via
        `QuestionGroup.guid == blueprint_guid` (guid reuse again), staying
        forward-compatible with a future multi-entity blueprint.
      - **Real-data finding, patched then eliminated at the root**: a media
        field was one of three unrelated things — `/static/...` (real
        uploaded file, bundle it), an external `http(s)://` URL (hotlinked,
        pass through), or a bare filename like `"world.svg"` (a built-in map
        template shipped with the *frontend*, `frontend/public/maps/`, never
        in `static/` at all). Initial `_resolve_media_ref` implementation
        treated the last two as "missing local file" and broke on the first
        real group tested (`Territoires du monde`, id 1); patched to pass
        both through. **Follow-up (2026-07-21, user-requested): eliminated
        the third case entirely** rather than leave it as a permanent
        special case — migration `0016` one-time-localized every existing
        bare map reference into real `/static/` files (3 files, 4 groups on
        the live DB, verified byte-identical), and the map editor
        (`MapMediaInput.jsx`, replacing `MapFileInput.jsx`) now uploads SVGs
        through the same `/upload` endpoint as any other media, so the
        bundled-asset picker can never produce a new bare filename.
        `_resolve_media_ref`/`materialize` simplified back down to two cases;
        `frontend/public/maps/` deleted. Verified live: both the map editor
        and a real training/review session render the migrated map correctly
        (Playwright against the real backend, not the mocked e2e driver).
        Documented in `docs/architecture.md`.
      - Verified against real data (scratch copies, never the live DB): a
        252-question map group (built-in SVG, zero bundled media, 11.7 KB
        zip) and a 12-question media group (13 real files bundled,
        byte-identical sha256 on the far side) both round-tripped correctly
        — zero progress rows, subscription recorded, re-import correctly
        rejected. 315 backend tests pass (16 new).
- [x] 1.3 **Updates — done (2026-07-21).** `update_blueprint()` in
      `services/blueprints.py`, `POST /blueprints/update?delete_removed=bool`.
      - **Correction to the spec's literal reading**: "item untouched locally
        → content_hash identical" compares against the *new zip's* content —
        but fork detection must be a property of local state alone,
        independent of what the incoming version contains. `_is_row_forked`
        recomputes the row's current canonical hash (re-deriving media as a
        content-addressed ref via `_resolve_media_ref`, so comparison is
        apples-to-apples) and compares to the row's own stored
        `content_hash` — never to the new entry.
      - new guid in zip, absent locally → added (fresh row, guid reused,
        no Progress — mirrors `create_question()`'s lazy creation).
      - present both sides, unforked, content differs → updated in place,
        `blueprint_version`/`content_hash` advance.
      - present both sides, content identical either way → left alone
        entirely, not even bookkeeping touched (so "updated" only ever
        reports real changes — an early version reported every unforked row
        as "updated" regardless of whether anything actually changed;
        caught by a same-version-idempotency test).
      - forked → always left alone, bookkeeping frozen at last clean sync.
      - absent from zip, present locally → reported in `removed`, deleted
        only when `delete_removed=True` (via the existing
        `delete_question_dependents` pipeline — tombstoned like any other
        deletion, no separate "archive" concept invented). Progress is
        deleted alongside its question exactly as any normal deletion does;
        never touched otherwise.
      - No separate preview/apply split: `update_blueprint` is safe to call
        repeatedly with the same zip (Terraform-apply style) — call once
        with `delete_removed=False` to apply every safe change and see what
        *would* be removed, call again with `True` once confirmed.
      - **Real-data bug caught by testing against the actual "Capitales du
        monde" group** (not just synthetic fixtures): a row locally edited
        in a version where upstream happened not to touch that same item was
        correctly protected from being overwritten, but silently missing
        from the `forked` report — an efficiency shortcut checked "did
        upstream change this" before checking fork status, when it must be
        the other way around. Fixed; a regression test locks in the exact
        scenario. 327 backend tests pass (11 new for 1.3).
- [x] 1.4 **Unsubscribe — done (2026-07-21).** `unsubscribe_blueprint()` in
      `services/blueprints.py`, `POST /blueprints/{blueprint_guid}/unsubscribe
      ?delete_content=bool`.
      - **Keep as personal copy** (default): drops the `BlueprintSubscription`
        row only; clears `blueprint_guid`/`blueprint_version`/`content_hash`
        on the group and its questions so a locally-owned row never claims a
        stale blueprint origin once nothing tracks updates for it anymore.
        Content and progress untouched.
      - **Delete**: reuses the exact deletion pipeline `delete_group` already
        uses (`delete_question_dependents` + tombstones + media cleanup via
        `delete_unreferenced_media_file`) — scoped by **group membership**,
        not `blueprint_guid`, matching how group deletion already works
        everywhere else in this app (no partial-group-deletion concept
        exists, so a question the user manually added into a blueprint-
        derived group is deleted along with it too). "Progress archived"
        from the spec text = an unconditional `create_backup()` call first
        (reusing the same primitive as `/backup/export` and pre-migration
        snapshots), since unsubscribing can delete far more review history
        in one action than a single question delete risks — not a new
        archive concept.
      - Verified against real data (scratch copies): both modes round-
        tripped correctly on the real "Signes astrologiques" group (12
        questions) — keep preserved everything with bookkeeping cleared,
        delete produced a real, opened-and-confirmed backup file and left
        zero rows behind. 333 backend tests pass (6 new).
- [x] 1.5 **Catalog + UI — done (2026-07-21).** New catalog JSON format
      (`{format, blueprints: [{blueprint_guid, name, description, license,
      version, type_group, question_count, size_bytes, download_url}]}`) —
      `type_group`/`question_count` duplicate what's inside each zip's own
      `content.json` on purpose, so cards render richly without downloading
      every zip up front.
      - **No backend "fetch a URL" capability was needed.** A catalog entry
        is just a public static zip; the frontend fetches it into a blob and
        POSTs that blob to the *already-existing* `/blueprints/import` /
        `/blueprints/update` — identical to what a manual file picker
        already did, just sourced from a URL. Zero changes to
        `import_blueprint`/`update_blueprint`.
      - Backend additions, precisely scoped: `GET /blueprints` (list
        `BlueprintSubscription` rows — did not exist before, the one real
        gap) and `GET`/`PUT /blueprints/catalog-settings` (new `AppSetting`
        key `blueprint_catalog`, classified `DEVICE_SETTING_KEYS` — a
        per-device preference, not sync data).
      - New `frontend/src/features/blueprints/` — `useBrowseBlueprints`
        (correlates catalog entries against installed subscriptions by guid
        → not_installed / up_to_date / update_available), `BlueprintCard`,
        `BrowseBlueprints`. `update()`'s two-phase confirm (call once,
        preview `removed`, call again with `deleteRemoved: true`) surfaces
        inline, no modal. New Menu destination (`teal` accent, previously
        unclaimed at the destination level) + Settings "Catalogue" section
        for the URL, matching the app's existing single-purpose-screen and
        settings-panel conventions exactly — no toast library, no spinners,
        no router, no new visual system introduced.
      - Unsubscribe reuses the exact swipe-reveal rail pattern from
        `QuestionCard`/`GroupCardItem`, exposing "Garder" (tap commits,
        matching this app's existing non-modal confirmation convention) and
        "Supprimer" (gated by `window.confirm()`, matching how this app
        already reserves that specifically for its most destructive
        actions).
      - **Verified against the real running app**, not just unit tests:
        exported a real group via the live API, served it plus a hand-built
        catalog from a throwaway local HTTP server (had to add CORS headers
        manually — Python's plain `http.server` doesn't send
        `Access-Control-Allow-Origin`, and the frontend/backend/catalog-
        server are three different origins), and drove the actual app with
        Playwright: install, a genuine guid-collision error surfaced
        inline, install landing correctly in Manage, keep-unsubscribe
        (content preserved, re-import correctly re-guarded since a kept
        row's own guid is permanent identity — confirms `unsubscribe`'s
        "keep" design is exactly right, not just untested), and
        delete-unsubscribe (real confirm dialog, real backup file, content
        actually gone from Manage). One false alarm along the way: a
        card appeared not to refresh after a delete — turned out to be the
        test script's fixed 2s wait being shorter than the real
        backup-before-delete round trip, not an app bug; polling confirmed
        the live re-render (no page reload) catches up in ~2s on its own.
        335 backend + 347 frontend tests pass (2 + 7 new).
- [x] 1.6 **First real blueprint: countries of the world — done (2026-07-21).**
      Full dogfooding of publish → install, against the real public catalog:
      - Exported the live "Territoires du monde" group via the app's own
        `/blueprints/{id}/export` (blueprint_guid `2639a60d-4dd2-4531-9fcd-
        433fdd159cd2`, v1, 252 questions, 72420 bytes) and authored a matching
        `catalog.json`, staged in a gitignored `publish/` folder.
      - User created a **public** Supabase Storage bucket named `blueprints`
        (deliberately separate from the private `sync-collections` bucket used
        for sync payloads) and uploaded both files.
      - Verified both public URLs resolve with the exact expected byte sizes
        (`catalog.json` 556 bytes, the zip 72420 bytes) — real HTTP GETs
        against `https://<project>.supabase.co/storage/v1/object/public/
        blueprints/...`, no auth needed since Storage RLS is bucket-public.
      - Pointed the app's own catalog-URL setting (`PUT /blueprints/catalog-
        settings`) at the real published `catalog.json`.
      - **Fresh-database install proof**: built a brand-new SQLite DB from
        `Base.metadata.create_all` (empty — asserted zero groups/questions/
        subscriptions beforehand) in a scratch dir, downloaded the real
        catalog.json + zip exactly as the browser would, and called the real
        `import_blueprint()` service function against it. Result: 252
        questions imported, the map SVG materialized correctly on disk, the
        `BlueprintSubscription` recorded with the catalog URL as `source`.
        This is the same code path the UI's "Installer" button drives
        (`fetchCatalog` → `installBlueprintFromCatalog` → `POST /blueprints/
        import`), just invoked directly against a scratch DB instead of the
        user's own (which would correctly hit the guid-collision guard, since
        they already own this content locally).
      - The "fix a border → publish v2 → update without touching progress"
        half of the cycle was already E2E-verified in 1.5 (synthetic data,
        Playwright against the real backend) — the update/version-propagation
        *code path* doesn't change based on which catalog serves the zip, so
        it wasn't re-proven against the live bucket. Re-run it live if a real
        v2 of this pack is ever published.
- [x] 1.7 **Map licensing — settled by investigation (2026-07-21).** The
      roadmap assumed we'd need to source a public-domain map (Natural Earth).
      Turns out the map already in the app is *already* permissively licensed,
      so no source swap is needed:
      - **world.svg** and **world-capitals.svg** (behind "Territoires du
        monde" / "Capitales du monde") are **Simplemaps.com, MIT License**
        (`Copyright (c) 2020 Pareto Software, LLC DBA Simplemaps.com`). MIT
        explicitly permits redistribution *provided the copyright + permission
        notice travels with the work*. That notice is a comment block at the
        top of the SVG, and blueprint export bundles media **byte-for-byte**
        (`zip_file.write(file_path, ...)` in `services/blueprints.py`), so the
        attribution is preserved automatically inside any exported pack — no
        extra plumbing required. Verified the localized static copies
        (migration 0016) still carry the comment intact.
      - **france-region-departement.svg** has no embedded attribution / origin
        is unclear — but it is NOT part of a countries-of-the-world pack, so
        it does not gate 1.6. Flag before ever publishing a France-departments
        pack.
      - The manifest already carries a `license` field (implemented in 1.1).
        For the countries pack that value describes the *authored question
        set* (country names + ISO codes = uncopyrightable facts, so CC0 is
        the honest choice); the map's MIT terms ride along inside the SVG
        itself. Disputed-territories policy is a content/editorial decision
        deferred to whoever authors the published pack, not a code concern.
**M1 — done (2026-07-21).** Definition of done: the countries-of-the-world
blueprint installs from the catalog onto a fresh database (proven live above,
1.6), a v2 propagates cleanly onto a database with progress and local edits
(proven with Playwright in 1.5), Playwright e2e tests cover the full cycle
(1.5). All three hold. Real public host: Supabase Storage, `blueprints`
bucket, project `apauxfgsthjmowjimcwn` — the same project used for M2 sync.

---

## M2 — Accounts + full sync (~1.5 to 2 weeks)

The Anki model: push/pull the whole thing, and on divergence a
"Upload / Download" dialog where one side wins wholesale. No fine-grained
merging here.

### Decisions to make

- **D4 — Auth: decided (2026-07-21) — Supabase email OTP.** Accepts either
  the 6-digit code or a pasted magic-link URL (see Slice 2 follow-up below —
  Supabase's fixed built-in email templates forced this shape). No web OAuth,
  no Tauri deep link.
- **D5 — Server: decided (2026-07-21) — no custom application backend.**
  Supabase Storage (private `sync-collections` bucket) + a `collections`
  table (version counter) + RLS policies scoped to `auth.uid()`, driven
  entirely through the PostgREST Data API. `sync_server/` (the stdlib
  reference implementation) still exists and is fully tested, but is not
  what's deployed — it's the fallback if Supabase is ever dropped, and the
  thing a self-hosted user would run instead.

**Decision (2026-07-21): build the client-side engine first, against a local
fake server**, deferring the real cloud-backend commitment (Supabase vs
self-hosted). ~80% of M2 is client-side and backend-agnostic, so this makes
fully-verifiable progress with no cloud accounts and de-risks the design.

### Slice 1 — done (2026-07-21): whole-collection push/pull, verified locally

The "Anki fallback" (one side wins wholesale) is built end-to-end against a
real, minimal reference server:

- **`sync_server/`** — a standalone stdlib FastAPI service (the reference
  protocol impl; a self-hosted deployment is literally this, a managed
  backend is an adapter to the same protocol). Per account: one collection
  zip + a monotonic `version`. Push accepted iff `base_version ==
  server.version` (that check is the *entire* conflict mechanism, so clock
  skew can't corrupt anything — 2.5's clamp concern is moot for whole-
  collection sync, an M3 issue). 9 store tests.
- **Per-device client** (`backend/app/services/sync.py` + `sync_client.py`
  [urllib, raw-binary zip bodies — no multipart, no new dep] + `sync_state.py`
  + `routers/sync.py`). Push = `create_backup` → upload; pull = download →
  the exact `routers/backup.py` restore+`init_database`+rebalance path. The
  one global-engine step is behind an injectable `finalize` so two simulated
  devices run against explicit paths in tests.
- **Token storage — the real gap, solved**: `SYNC_STATE_FILE =
  APP_DATA_DIR/sync_state.json`, a *sibling* of questions.db, so the auth
  token never rides inside a synced/backed-up collection (`create_backup`
  only bundles the db + static/). Plaintext/user-scoped for now; OS-keychain
  hardening deferred to when a real backend is wired.
- **Frontend**: `api/sync.js` + a "Compte / Synchronisation" Settings panel
  (email→code→connect, Envoyer/Télécharger/Se déconnecter, inline conflict
  resolution — no modal, matching app conventions).
- **Verified three ways**: 11 backend tests incl. two-device convergence +
  conflict + force + schema-gate; a real-HTTP-wire two-device convergence
  (exercises urllib, which the unit tests skip); and a live Playwright UI
  spot-check — signed in through the real app, pushed the real ~34 MB
  collection to the running server, status showed "v1 — cloud : v1". 355
  backend/sync_server + 351 frontend tests pass.

Step status against the original 2.x list: 2.3 (version protocol) ✓, 2.4
(post-pull migrate+rebalance) ✓ (reused as-is), 2.6 (schema gating) ✓, 2.7
(UI + conflict) ✓. **2.1/2.2 deferred** — this slice ships the whole DB
(incl. blueprint content + all media) rather than a slimmed payload; that
optimization is a later slice and matters little here (most of static/ is the
user's own media, not blueprints). **2.5** N/A for version-based conflict.
**2.8** (account deletion / privacy) deferred. **The real cloud backend**
(Supabase adapter or deploying `sync_server/`) is the next decision when
ready.

### Slice 2 — done (2026-07-21): Supabase adapter (D4+D5 decided)

**User chose Supabase** (free tier, zero server maintenance) and created the
project; only the Project URL + *publishable* key were shared (never the
service_role secret). Setup on the Supabase side: a private `sync-collections`
bucket, a `collections` table (user_id PK → version counter + schema_version
+ updated_at + last_device_id), RLS policies locking both the table and the
storage folder to `auth.uid()`.

`services/supabase_sync_client.py` implements the same interface as
`HttpSyncClient`, so the engine is untouched. The differences all live in the
adapter:

- **Auth = Supabase email OTP** (their `/auth/v1/otp` + `/verify` with
  `type: "email"`) — real magic-code e-mails replace the fake server's
  returned-in-response code. The engine's opaque "token" is now a dict
  `{access_token, refresh_token, user_id}`.
- **Access tokens expire (~1h) and refresh tokens ROTATE on use** — every
  authed op retries once through a refresh that persists the rotated pair via
  an `on_tokens_updated` callback (wired to sync_state by the router). This
  exposed a real engine bug, fixed + regression-tested: push/pull must
  RE-LOAD sync_state before saving `last_server_version`, or the stale
  in-memory copy clobbers a token rotated mid-operation (which, with
  rotation, would lock the device out of its session).
- **Conflict safety without a custom server**: the zip uploads to a
  VERSIONED object name first (`{uid}/v{n}.zip` — a lost race leaves only an
  orphan), then the version is claimed atomically via a guarded PostgREST
  PATCH (`?version=eq.{current}`, empty result = lost). Previous version's
  zip kept as a safety net (the roadmap's "last versions" idea), older
  pruned best-effort.
- Client selection: a publishable key set (or a `.supabase.co` URL) →
  Supabase adapter; otherwise the reference protocol. `server_key` added to
  sync_state + the Settings UI ("Clé publique (Supabase)" field). Still all
  stdlib urllib, no new dependency.

Verified: 13 adapter unit tests (fake transport: verify/refresh-rotation/
guarded-claim/race-cleanup/prune/first-push-insert) + the rotation-persistence
engine regression + full suites (369 backend + 351 frontend). Live probes
against the real project (read-only, no e-mails): auth healthy, `collections`
reachable via Data API with RLS correctly hiding rows from anon. Dev app
pre-configured with the project URL + key. **Remaining for full E2E: the
user's mailbox** — sign-in codes arrive by real e-mail, so the final
two-device verification is a guided run.

**Follow-up (same day): Supabase locks e-mail template editing behind custom
SMTP** (their built-in sender ships fixed templates), so `{{ .Token }}` can't
be added without an SMTP setup. Solved without SMTP: `verify()` now accepts
**either the 6-digit code or the full pasted login link** — a pasted link's
query carries the token hash + type, verified via `token_hash` (with an
`email`-type fallback), so the flow works regardless of what the fixed
template contains. UI hint added under the code field ("copie l'adresse du
lien sans cliquer dessus"). Custom SMTP stays an optional polish (editable
branded templates, higher send limits), not a requirement. +2 adapter tests
(371 backend total).

### Steps — current status (originally speced as one list; done out of order
via slices 1-2 above, kept here as the authoritative per-item checklist)

- [x] 2.1 + 2.2 **Sync payload slimming + hash-based idempotent media —
      done (2026-07-21), together (Slice 3).** Deliberate deviation from the
      original 2.1 text: excluding blueprint-derived rows from the DB payload
      was checked against the real schema and doesn't hold up —
      `Progress.question_id` / `ReviewLog.question_id` are **integer** FKs
      into `questions.id`, and reinstalling a blueprint mints new integer PKs
      (only `guid` is reused), so excluding those rows would orphan review
      history or need a whole guid-relinking step for content users clearly
      want synced anyway. Instead: **the DB always syncs whole** (all rows,
      unchanged — cheap, mostly text) and **only `static/` media is slimmed,
      by content hash** via the `media_files` registry (M0 0.5). Push uploads
      only blobs the server doesn't have yet; pull downloads only files
      missing locally, driven by the just-restored DB's own media_files rows
      — not a server-side manifest. `create_backup(include_media=False)` /
      `restore_backup(replace_media=False)` (new kwargs, default True, zero
      behavior change for the manual Settings → Sauvegarde path) produce a
      DB-only zip and a non-destructive DB-only restore; orchestration
      (hashing, diffing, reading/writing static/) lives entirely in
      `services/sync.py`, both adapters (`sync_client.py`'s `HttpSyncClient`
      and `supabase_sync_client.py`) just move bytes via new
      `upload_media_blob`/`download_media_blob` methods. Supabase stores the
      server's known hash set in a new `collections.media_hashes` jsonb
      column, updated in the SAME atomic guarded PATCH as the version claim
      (no separate manifest call, no window where they could disagree); the
      stdlib `sync_server/` reference impl uses a small separate
      `PUT /collection/media-manifest` call instead (self-healing if it's
      ever skipped by a crash — the next push recomputes the diff). Media
      blobs live at `{uid}/media/{sha256}` in the *existing* `sync-collections`
      bucket, no new bucket.
      **Live-verified against the real project**, not just unit tests: first
      push after deploying this (692 physical files, 683 unique content
      hashes — 9 pairs are duplicate content, matching the "9 duplicates"
      already known from M0 0.5) uploaded all 683 blobs and produced an
      **855,834-byte (836 KB) DB-only zip** — down from the old whole-collection
      zip (25.4 MB observed for the prior `v1.zip` still on the account) —
      taking 2m48s end-to-end. **A second push with zero changes uploaded
      zero new blobs and completed in 1.15s** (confirmed via the Storage
      list-objects API: blob count stayed at 683, only the tiny DB zip
      re-uploaded). A full fresh-device pull (new scratch `sync_state`, same
      account, `last_server_version` reset to 0) restored the DB-only zip
      then reconciled all 692 media file paths with **zero missing after
      reconcile** — row counts and total static bytes came back **byte-
      identical** to the pre-change verification (1441 questions, 924
      progress, 5160 review_log, 9 tombstones, 692 media files, 30,586,584
      bytes), proving the new split-payload architecture preserves full
      fidelity, not just smaller size. Supabase-side SQL the user ran:
      `ALTER TABLE collections ADD COLUMN media_hashes jsonb NOT NULL DEFAULT
      '[]'::jsonb;` — the existing storage RLS policy already covered the new
      `media/` subpath (still under the user's own `auth.uid()` prefix), no
      policy change needed. Orphaned media blobs (a hash that drops out of
      the canonical set after a push) are deliberately NOT pruned this round
      — cheap to leave, zero correctness risk, same "don't fail sync over
      cleanup" posture as the existing zip-version pruning. Tests: 6 new in
      `test_sync.py` (upload-only-missing, pull reconciliation is additive-
      only and doesn't touch local-only files, delete-account-data), 5 new in
      `test_supabase_sync.py`, 6 new in `sync_server/test_store.py`.
- [x] 2.3 **Version protocol — done** in Slice 1/2. Monotonic per-account
      version counter; push accepted iff `base_version == server.version`;
      stale push → conflict (`{status:"conflict", server_version}` — note:
      returned as HTTP 200 with a flat body, not a 409, because the frontend's
      `requestJson` collapses non-2xx bodies to a string — documented
      workaround, not a bug). Supabase adapter additionally keeps the
      previous version's zip as a safety net and prunes anything older
      (N-2); the stdlib `sync_server/` reference impl keeps only current.
- [x] 2.4 **Post-pull pipeline — done** in Slice 1, reusing
      `routers/backup.py`'s exact restore → `init_database()` → rebalance →
      regenerate-derived-collections sequence unchanged.
- [ ] 2.5 **Clock clamping — N/A for now, not forgotten.** Whole-collection
      version-based conflict detection has no timestamp merge step at all, so
      client clock skew cannot corrupt sync (this was the explicit design
      win noted in Slice 1). Only becomes relevant if/when M3 incremental
      sync is ever built — re-read this item then, not before.
- [x] 2.6 **Schema version gating — done** in Slice 1 (`/meta/schema-version`
      from M0 0.7, refuses pulling a zip newer than the local code version).
- [x] 2.7 **UI — done** in Slice 1: Settings "Compte / Synchronisation"
      panel, email→code-or-link→connect, Envoyer/Télécharger/Se déconnecter,
      inline (non-modal) conflict resolution. No auto-sync-on-open/close yet
      — manual button only; revisit if that friction is ever reported.
- [x] 2.8 **Account data deletion — done (2026-07-21), scoped deliberately.**
      Hard constraint, not a preference: this app only ever holds the
      Supabase *publishable* key (the user was repeatedly told never to share
      `service_role`), and deleting the underlying Supabase Auth *identity*
      needs either the Admin API (`service_role`) or a server-side Edge
      Function (new infra, against the already-made D5 "no custom
      application backend" decision). So this deletes DATA only — the
      collection row, both known zip versions, and every blob in the
      account's own `media_hashes` set (all already known from our own meta,
      no Storage list-objects call needed) — then signs out locally. The
      login identity survives; the user could sign back in to an empty cloud
      collection. Settings UI states this plainly rather than glossing over
      it ("Supprimer mes données cloud", with a `window.confirm` mentioning
      the existing backup-export path first). `SyncStore.delete_account_data`
      mirrors this for the reference server (`shutil.rmtree` the account
      dir). Not live-tested against the user's real account/data on purpose
      (only via unit tests, both adapters + reference server) — no reason to
      risk destroying their actual synced collection to prove a well-tested
      code path. Data export needed no new work (`/backup/export` already
      existed). No dedicated privacy *page* — a short static blurb sits next
      to the delete button instead, matching the app's single-screen-per-
      destination convention (no new route for one paragraph of text).

**Definition of done M2**: two real machines alternate review sessions on the
same collection for a week without loss; the divergence scenario shows the
dialog and corrupts nothing; a deleted account leaves nothing server-side.
The full sync mechanism (push/pull/conflict/auth/payload-slimming/media
dedup/account deletion) now has real, live, byte-identical end-to-end proof
against the actual Supabase project (see Slice 1-3 sections above). **M2 is
functionally complete** — every coded item (2.1-2.4, 2.6-2.8) is done and
verified; only 2.5 (N/A until M3) is intentionally skipped. What remains is
purely observational, not code: letting it run for real across devices over
time to confirm the "a week without loss" bar in practice.

---

## M3 — Incremental sync (later, if needed)

**Decision gate — build only if, in real M2 usage:** payloads exceed a few
MB, or sync takes more than ~10 s, or the conflict dialog appears more than
once a week in normal use. Otherwise M2 is enough — possibly forever (Anki
needed incremental sync because of 50,000-card collections on mobile).

If the gate passes:

- [ ] USN-style counters per object (server hands them out, local `usn = -1`
      = pending), push the dirty ones, pull everything above the last seen USN.
- [ ] `review_log` merge = union + sort by (reviewed_at, seq) + forward-replay
      of memory state with fuzz off (0.3 groundwork); scheduled dates are
      recomputed after merge, superseded rows (re-grades) resolved last-wins.
- [ ] Full-sync fallback (M2) on unresolvable divergence — exactly Anki's
      behavior.
- [ ] Read the sync module in `rslib` (official Anki server, Rust,
      self-hostable) before writing the protocol.

---

## Cross-cutting (every milestone)

- Backend unit tests + Playwright e2e on the new flows.
- Never a migration without the prior auto-backup (already wired in
  `migrations.py`).
- Existing backup export/import keeps working at every step.
- `graphify update .` after each modification session.
- Update `docs/architecture.md` whenever a D1-D5 decision is settled.

## Out of scope (explicitly)

- Multi-tenant rewrite of the local database (`user_id` everywhere): never.
- Real-time / simultaneous collaboration: no (the backlog's "competition"
  mode is a separate topic, not sync).
- Hosted web app: no — offline-first desktop remains the product.

## Indicative schedule

| Week | Content |
|---|---|
| W1 | 0.1 GUIDs → 0.2 revlog (migration + dual write) |
| W2 | 0.3 replay + property test, 0.4 tombstones, 0.6 settings, 0.7 version — M0 done; start 0.5 media |
| W3 | Finish 0.5; D1-D3 settled; 1.1 export + 1.2 import |
| W4 | 1.3 updates, 1.4 unsubscribe, 1.5 catalog+UI |
| W5 | 1.6 countries-of-the-world blueprint + 1.7 licensing — M1 done; D4-D5 settled |
| W6 | 2.1-2.4 payload, blobs, version protocol |
| W7 | 2.5-2.8 clocks, gating, UI, account — M2 done |
| W8+ | Observe real usage; M3 gate |

**Actual order differed from this table:** 2.3/2.4/2.6/2.7 landed first via
Slices 1-2 (the sync *mechanism*), then 2.1+2.2 (payload slimming + hash-based
media) and 2.8 (account data deletion) via Slice 3 (2026-07-21) — all real and
E2E-verified against a live Supabase project. **M2 is functionally complete**;
2.5 stays N/A unless/until M3. See the "Steps — current status" list under M2
for the authoritative per-item state; this table is historical planning only.
