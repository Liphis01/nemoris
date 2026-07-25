-- Supabase setup for the pack catalog: unpublishing, install tracking,
-- ratings, and comments.
--
-- Run this once in the Supabase SQL editor for the project configured in
-- Settings -> Catalogue. The app uses only the publishable key at
-- runtime, so it cannot create these objects itself.
--
-- BEFORE RUNNING: this repo has no schema file for the pre-existing
-- `pack_catalog` table or its `search_pack_catalog` / `publish_my_pack`
-- RPCs (they predate this file and were created by hand). Confirm the
-- assumptions below against the live project first:
--   \d public.pack_catalog                          -- confirm pack_guid is
--                                                        the unique key and
--                                                        the owner_id column
--                                                        name/type (assumed
--                                                        uuid here)
--   select pg_get_functiondef('public.search_pack_catalog'::regprocedure);
--   select pg_get_functiondef('public.publish_my_pack'::regprocedure);
-- In particular, confirm whether search_pack_catalog already filters on
-- is_public = true (if so, unpublishing via is_public=false works for free
-- and section 4's note can be skipped) or filters on something else.

begin;

-- =========================================================
-- 1. New tables
-- =========================================================

create table if not exists public.pack_installs (
  pack_guid text not null references public.pack_catalog(pack_guid) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  installed_version integer not null default 1,
  first_installed_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (pack_guid, user_id)
);

create table if not exists public.pack_ratings (
  pack_guid text not null references public.pack_catalog(pack_guid) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (pack_guid, user_id)
);

do $$
begin
  alter table public.pack_ratings
    add constraint pack_ratings_range check (rating between 1 and 5);
exception
  when duplicate_object then null;
end $$;

create table if not exists public.pack_comments (
  id bigint generated always as identity primary key,
  pack_guid text not null references public.pack_catalog(pack_guid) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_label text not null,
  body text not null,
  created_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  alter table public.pack_comments
    add constraint pack_comments_body_length check (char_length(body) between 1 and 2000);
exception
  when duplicate_object then null;
end $$;

create index if not exists pack_comments_pack_guid_created_at_idx
  on public.pack_comments (pack_guid, created_at desc);

-- =========================================================
-- 2. Denormalized aggregates on pack_catalog
-- =========================================================
-- Avoids a join on every search page and makes "top rated" sort a plain
-- indexed ORDER BY. Kept in sync by triggers below -- application code
-- never writes these columns directly.

alter table public.pack_catalog
  add column if not exists avg_rating numeric(3,2) not null default 0,
  add column if not exists rating_count integer not null default 0,
  add column if not exists comment_count integer not null default 0;

create index if not exists pack_catalog_avg_rating_idx
  on public.pack_catalog (avg_rating desc, rating_count desc);

create or replace function public.pack_catalog_refresh_rating_stats()
returns trigger language plpgsql as $$
declare
  target_guid text := coalesce(new.pack_guid, old.pack_guid);
begin
  update public.pack_catalog pc
  set avg_rating = coalesce(
        (select round(avg(rating)::numeric, 2) from public.pack_ratings where pack_guid = target_guid),
        0
      ),
      rating_count = (select count(*) from public.pack_ratings where pack_guid = target_guid),
      updated_at = timezone('utc', now())
  where pc.pack_guid = target_guid;
  return coalesce(new, old);
end;
$$;

drop trigger if exists pack_ratings_refresh_stats on public.pack_ratings;
create trigger pack_ratings_refresh_stats
  after insert or update or delete on public.pack_ratings
  for each row execute function public.pack_catalog_refresh_rating_stats();

create or replace function public.pack_catalog_refresh_comment_stats()
returns trigger language plpgsql as $$
declare
  target_guid text := coalesce(new.pack_guid, old.pack_guid);
begin
  update public.pack_catalog pc
  set comment_count = (select count(*) from public.pack_comments where pack_guid = target_guid)
  where pc.pack_guid = target_guid;
  return coalesce(new, old);
end;
$$;

drop trigger if exists pack_comments_refresh_stats on public.pack_comments;
create trigger pack_comments_refresh_stats
  after insert or delete on public.pack_comments
  for each row execute function public.pack_catalog_refresh_comment_stats();

-- =========================================================
-- 3. Row level security -- the real enforcement layer
-- =========================================================
-- "Signed in AND installed" is enforced here, not just hidden client-side:
-- a rating/comment insert is only allowed if a matching pack_installs row
-- already exists for that (pack_guid, user_id).

alter table public.pack_installs enable row level security;
alter table public.pack_ratings enable row level security;
alter table public.pack_comments enable row level security;

grant select, insert, update on public.pack_installs to authenticated;
grant select, insert, update on public.pack_ratings to authenticated;
grant select, insert on public.pack_comments to authenticated;
grant select on public.pack_comments to anon;

drop policy if exists pack_installs_select_own on public.pack_installs;
drop policy if exists pack_installs_insert_own on public.pack_installs;
drop policy if exists pack_installs_update_own on public.pack_installs;

create policy pack_installs_select_own
  on public.pack_installs
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy pack_installs_insert_own
  on public.pack_installs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy pack_installs_update_own
  on public.pack_installs
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists pack_ratings_select_own on public.pack_ratings;
drop policy if exists pack_ratings_insert_own_if_installed on public.pack_ratings;
drop policy if exists pack_ratings_update_own_if_installed on public.pack_ratings;

create policy pack_ratings_select_own
  on public.pack_ratings
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy pack_ratings_insert_own_if_installed
  on public.pack_ratings
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.pack_installs pi
      where pi.pack_guid = pack_ratings.pack_guid and pi.user_id = auth.uid()
    )
  );

create policy pack_ratings_update_own_if_installed
  on public.pack_ratings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.pack_installs pi
      where pi.pack_guid = pack_ratings.pack_guid and pi.user_id = auth.uid()
    )
  );

drop policy if exists pack_comments_select_all on public.pack_comments;
drop policy if exists pack_comments_insert_own_if_installed on public.pack_comments;

-- Anyone can read the thread, signed in or not.
create policy pack_comments_select_all
  on public.pack_comments
  for select
  to anon, authenticated
  using (true);

-- Posting requires the same "signed in AND installed" gate as ratings.
-- No update/delete policy: editing/removing a posted comment is out of
-- scope (no moderation tooling yet).
create policy pack_comments_insert_own_if_installed
  on public.pack_comments
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.pack_installs pi
      where pi.pack_guid = pack_comments.pack_guid and pi.user_id = auth.uid()
    )
  );

-- =========================================================
-- 4. New RPCs
-- =========================================================

-- Owner-only soft delete. Mirrors publish_my_pack's owner-scoped update
-- shape. Row + storage zip are kept; the pack drops out of public search
-- via is_public=false (confirm search_pack_catalog actually filters on
-- this column -- see header note).
create or replace function public.unpublish_my_pack(p_pack_guid text)
returns public.pack_catalog
language sql
as $$
  update public.pack_catalog
  set is_public = false,
      publication_status = 'unpublished',
      updated_at = timezone('utc', now())
  where pack_guid = p_pack_guid and owner_id = auth.uid()
  returning *;
$$;

create or replace function public.record_pack_install(
  p_pack_guid text,
  p_installed_version integer
)
returns public.pack_installs
language sql
as $$
  insert into public.pack_installs (pack_guid, user_id, installed_version)
  values (p_pack_guid, auth.uid(), coalesce(p_installed_version, 1))
  on conflict (pack_guid, user_id) do update
    set installed_version = greatest(pack_installs.installed_version, excluded.installed_version),
        updated_at = timezone('utc', now())
  returning *;
$$;

-- Backfill for the sign-in flow: registers every pack a user already has
-- installed locally (possibly installed anonymously, before they ever
-- signed in) as this account's installs in one round trip. Skips any
-- guid not present in pack_catalog instead of failing the whole batch.
create or replace function public.record_pack_installs_bulk(p_installs jsonb)
returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  insert into public.pack_installs (pack_guid, user_id, installed_version)
  select i.pack_guid, auth.uid(), i.installed_version
  from jsonb_to_recordset(p_installs) as i(pack_guid text, installed_version integer)
  where exists (select 1 from public.pack_catalog pc where pc.pack_guid = i.pack_guid)
  on conflict (pack_guid, user_id) do update
    set installed_version = greatest(pack_installs.installed_version, excluded.installed_version),
        updated_at = timezone('utc', now());

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.get_my_pack_status(p_pack_guid text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'is_installed', exists (
      select 1 from public.pack_installs
      where pack_guid = p_pack_guid and user_id = auth.uid()
    ),
    'my_rating', (
      select rating from public.pack_ratings
      where pack_guid = p_pack_guid and user_id = auth.uid()
    )
  );
$$;

-- RLS above already blocks a non-installer from inserting/updating; this
-- RPC just upserts and returns the fresh aggregate in one round trip.
create or replace function public.rate_pack(p_pack_guid text, p_rating smallint)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
begin
  insert into public.pack_ratings (pack_guid, user_id, rating)
  values (p_pack_guid, auth.uid(), p_rating)
  on conflict (pack_guid, user_id) do update
    set rating = excluded.rating, updated_at = timezone('utc', now());

  select jsonb_build_object(
    'my_rating', p_rating,
    'avg_rating', pc.avg_rating,
    'rating_count', pc.rating_count
  )
  into result
  from public.pack_catalog pc
  where pc.pack_guid = p_pack_guid;

  return result;
end;
$$;

create or replace function public.add_pack_comment(p_pack_guid text, p_body text)
returns public.pack_comments
language sql
as $$
  insert into public.pack_comments (pack_guid, user_id, author_label, body)
  values (
    p_pack_guid,
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', 'Utilisateur'),
    p_body
  )
  returning *;
$$;

grant execute on function public.unpublish_my_pack(text) to authenticated;
grant execute on function public.record_pack_install(text, integer) to authenticated;
grant execute on function public.record_pack_installs_bulk(jsonb) to authenticated;
grant execute on function public.get_my_pack_status(text) to authenticated;
grant execute on function public.rate_pack(text, smallint) to authenticated;
grant execute on function public.add_pack_comment(text, text) to authenticated;

-- =========================================================
-- 5. Changes needed to the EXISTING search_pack_catalog RPC
-- =========================================================
-- search_pack_catalog predates this file and its current body is not
-- known here -- it must be edited in place against its real definition
-- (pg_get_functiondef, per the header note), not blindly replaced. Apply
-- these as a diff:
--
--   1. Add avg_rating, rating_count, comment_count to the per-row JSON it
--      returns -- trivial now that they're plain columns on pack_catalog.
--   2. Add a 'note' branch to whatever CASE p_sort / ORDER BY construct it
--      uses today, e.g.:
--        when 'note' then order by pc.avg_rating desc nulls last,
--                                   pc.rating_count desc,
--                                   pc.updated_at desc
--   3. Exclusion of unpublished packs from public results is very likely
--      already free if the WHERE clause filters on is_public = true (see
--      header note) -- only add an explicit
--        and publication_status = 'published'
--      filter if the live function turns out to filter on something else.
--
-- Known, deliberate limitation: this is a plain average, so one 5-star
-- rating can outrank a pack with hundreds of 4.9-average ratings. A
-- Bayesian/Wilson-score smoothed sort would fix this but is a separate,
-- later concern -- not implemented here.

select pg_notify('pgrst', 'reload schema');

commit;
