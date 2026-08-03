# Supabase steps — playlist packs (format v2)

Manual steps for the Supabase project configured in **Réglages → Catalogue**. The app only holds
the publishable key at runtime, so it cannot create or alter any of this itself.

Run everything in the **SQL Editor**. Note: psql meta-commands (`\d`, `\df`) do **not** work
there — every query below is plain SQL on purpose.

Stages 1–3 of the plan (pack format v2, rule-based playlists, the Manage builder) need **no
Supabase work at all**. Only step 3 below can block publishing a mixed-type playlist, so run
steps 0–2 whenever convenient and step 3 before Stage 4 lands.

---

## Step 0 — Confirm earlier migrations actually landed

Two earlier rollouts (pack comments/ratings, and profiles) were written but never confirmed
applied. Check before building on them:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('pack_installs', 'pack_ratings', 'pack_comments', 'profiles')
order by table_name;
```

**Expected:** 4 rows. If `pack_installs` / `pack_ratings` / `pack_comments` are missing, run
`docs/supabase-pack-catalog-schema.sql`. If `profiles` is missing, run
`docs/supabase-profiles-schema.sql`. Both are idempotent (`create table if not exists`,
`create or replace function`), so re-running a partially-applied file is safe.

---

## Step 1 — Dump the live function bodies

`upsert_my_pack_draft` and `publish_my_pack` predate the repo and exist **only** in the live
project. Before changing anything, capture what they actually do:

```sql
select p.proname, pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('upsert_my_pack_draft', 'publish_my_pack', 'unpublish_my_pack')
order by p.proname;
```

**Paste the output back to me.** I need `upsert_my_pack_draft`'s parameter list to know whether
adding `p_source_kind` / `p_group_count` is a signature change (which requires
`drop function` first, since Postgres cannot `create or replace` a function with a changed
signature). Save the output into `docs/` as a record either way — right now nothing in the repo
captures these two bodies, which is why every change here has to start with an inspection.

---

## Step 2 — `type_group` is unconstrained — RESOLVED, no change needed

**Verified against the live project on 2026-07-26.** `pack_catalog` has exactly one CHECK
constraint, and it is on `publication_status`:

```
CHECK ((publication_status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
```

`type_group` is plain `text NOT NULL DEFAULT 'text'::text` with **no CHECK constraint**, so
`'mixed'` is accepted as-is. Mixed-type playlists publish with zero Supabase changes.

The original investigation queries are kept below in case the schema is ever changed.

<details>
<summary>Verification queries</summary>


```sql
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'pack_catalog'
  and con.contype = 'c';
```

Also confirm the column's type:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'pack_catalog'
order by ordinal_position;
```

If a CHECK constraint on `type_group` is ever added, it must include `'mixed'`:

```sql
-- Replace <constraint_name> with conname from the query above.
alter table public.pack_catalog drop constraint <constraint_name>;
alter table public.pack_catalog add constraint <constraint_name>
  check (type_group in ('map', 'media', 'text', 'sequence', 'mixed'));
```

</details>

---

## Step 3 — No change needed to `search_pack_catalog`

Verified from the live body captured at `docs/supabase-pack-catalog-schema.sql:401-445`: the type
filter is plain equality —

```sql
and (params.type_text is null or b.type_group = params.type_text)
```

So a `'mixed'` pack simply doesn't match `map`/`media`/`text`/`sequence` and still appears under
"Tous types". That is the honest behaviour we want — no SQL change. The app side adds a **MIXTE**
chip and filter option so mixed packs are also directly selectable.

---

## Step 4 — `pack_guid` for playlist packs

Playlist-sourced packs use `collection.guid` as `pack_guid` instead of a group's guid. No schema
change: `pack_guid` is `text` with its own UNIQUE constraint
(`pack_catalog_pack_guid_key`, documented at `docs/supabase-pack-catalog-schema.sql:11-12`), and
guids are uuid4 from the same generator, so collisions are not a concern.

Storage paths are unaffected — `save_pack_publish_draft` writes to
`{user_id}/{pack_guid}/v{version}-{slug}.zip`, which stays valid for any guid.

---

## Summary

| Step | Action | Blocking? |
|---|---|---|
| 0 | Verify `pack_installs`/`pack_ratings`/`pack_comments`/`profiles` exist | Yes if missing |
| 1 | Dump `upsert_my_pack_draft` + `publish_my_pack` bodies | No — nice to have |
| 2 | `type_group` accepts `'mixed'` — **verified, no change needed** | No |
| 3 | `search_pack_catalog` — no change needed (verified) | No |
| 4 | `pack_guid` — no change needed (verified) | No |

**Net result: no Supabase migration is required for playlist packs.** Step 1 is now optional —
the publish payload deliberately sends no new RPC parameters, so `upsert_my_pack_draft`'s existing
signature is sufficient. Only step 0 is worth confirming, since two earlier rollouts were never
verified as applied.
