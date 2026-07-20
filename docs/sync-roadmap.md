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
- [ ] Test: export → import → re-import does not duplicate (prepares M1).

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
- [ ] Purge tombstones older than the last full sync (M2).

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
- **D2 — Catalog hosting**: start with GitHub Releases or Pages (free,
  versioned). Move to R2/S3+CDN if volume justifies it.
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
      - **Real-data finding, fixed before it shipped**: a media field is one
        of three unrelated things — `/static/...` (real uploaded file, bundle
        it), an external `http(s)://` URL (hotlinked, pass through), or a
        bare filename like `"world.svg"` (a built-in map template shipped
        with the *frontend*, `frontend/public/maps/`, never in `static/` at
        all — pass through). Initial implementation treated the last two as
        "missing local file" and broke on the very first real group tested
        (`Territoires du monde`, id 1). Documented in `docs/architecture.md`.
      - Verified against real data (scratch copies, never the live DB): a
        252-question map group (built-in SVG, zero bundled media, 11.7 KB
        zip) and a 12-question media group (13 real files bundled,
        byte-identical sha256 on the far side) both round-tripped correctly
        — zero progress rows, subscription recorded, re-import correctly
        rejected. 315 backend tests pass (16 new).
- [ ] 1.3 **Updates**: diff by GUID between installed and new version:
      - new item → added;
      - item untouched locally (`content_hash` identical) → updated in place;
      - item edited locally → left alone, it has forked;
      - item removed from the blueprint → offer deletion (progress archived);
      - progress → never touched (keyed by the local row).
- [ ] 1.4 **Unsubscribe**: user choice — keep the content as a personal copy,
      or delete (with confirmation, progress archived in an auto-backup).
- [ ] 1.5 **Catalog + UI**: remote JSON index (list, versions, sizes), a
      "Browse blueprints" screen: preview, add, "update available" badge.
- [ ] 1.6 **First real blueprint: countries of the world.** Full dogfooding
      of the cycle publish → install → fix a border → publish v2 → update
      without touching progress.
- [ ] 1.7 **Map licensing**: settle the data source (Natural Earth = public
      domain, recommended), policy on disputed territories, mandatory
      `license` field in the manifest.

**Definition of done M1**: the countries-of-the-world blueprint installs from
the catalog onto a fresh database, a v2 propagates cleanly onto a database
with progress and local edits, Playwright e2e tests cover the full cycle.

---

## M2 — Accounts + full sync (~1.5 to 2 weeks)

The Anki model: push/pull the whole thing, and on divergence a
"Upload / Download" dialog where one side wins wholesale. No fine-grained
merging here.

### Decisions to make

- **D4 — Auth**: recommendation **magic link / e-mail code** via Supabase
  (auth + blob storage + RLS in a single managed service, zero ops). Avoid
  web OAuth in Tauri at first: the `nemoris://` deep link is doable but
  painful; a 6-digit code typed into the app is plenty.
- **D5 — Server**: start with no custom application backend if possible
  (Supabase Storage + RLS policy + a version counter in a table). Only write
  a small FastAPI service if version logic demands it.

### Steps

- [ ] 2.1 **Sync payload**: personal content + `review_log` + tombstones +
      `sync.*` settings + blueprint subscription list. Unmodified blueprint
      content is **excluded** (re-downloaded from the catalog when installing
      on the new device). Result: a few hundred KB instead of ~34 MB.
- [ ] 2.2 **Personal media**: upload blobs by hash ("do you have abc123?" is
      the entire protocol), idempotent, resumable after a dropped connection.
- [ ] 2.3 **Version protocol**: monotonic per-user counter on the server.
      Push with a stale base version → refusal + Anki-style dialog (Upload
      mine / Take remote). Keep the last 3 server versions (safety net).
- [ ] 2.4 **After every pull**: `init_database()` (migrations on an older
      database) + local rebalancing + regenerate derived collections — the
      path already exists in `routers/backup.py`, reuse it as-is.
- [ ] 2.5 **Clocks**: clamp client timestamps to server time at sync (a
      device with a wrong date otherwise creates un-overwritable items "from
      the future" — a bug Anki has, let's avoid it). Note: some answer routes
      accept a client-supplied review date (grouped answers), so backdated
      rows are legitimate — ordering must use (reviewed_at, seq), never
      claimed dates alone.
- [ ] 2.6 **Version gating**: the server stores the schema version of the
      last push; an older client must update before syncing.
- [ ] 2.7 **UI**: sync button (auto push/pull in the simple case), status,
      conflict dialog, optional sync on app open/close.
- [ ] 2.8 **Account lifecycle**: account deletion (wipes server blobs), data
      export (already exists: `/backup/export`), minimal privacy page.
      Offline mode stays complete — sync is additive, local backups are
      untouched.

**Definition of done M2**: two real machines alternate review sessions on the
same collection for a week without loss; the divergence scenario shows the
dialog and corrupts nothing; a deleted account leaves nothing server-side.

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
