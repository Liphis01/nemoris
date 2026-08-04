-- Supabase setup for the pack catalog: unpublishing, permanent deletion,
-- install tracking, ratings, and comments.
--
-- Run this once in the Supabase SQL editor for the project configured in
-- Settings -> Catalogue. The app uses only the publishable key at
-- runtime, so it cannot create these objects itself.
--
-- Verified against the live project on 2026-07-26 (pack_catalog predates
-- this file and was created by hand, so nothing here could be assumed
-- blind):
--   - pack_guid has its own UNIQUE constraint (pack_catalog_pack_guid_key),
--     independent of the id bigint primary key -- safe as an FK target.
--   - owner_id is uuid, FK to auth.users(id) -- matches what's used below.
--   - publication_status has a CHECK constraint limiting it to
--     draft/published/archived. There is NO 'unpublished' value -- this
--     file uses 'archived' for that state instead (section 4).
--   - search_pack_catalog's WHERE clause filters only on is_public = true,
--     nothing on publication_status -- so unpublish_my_pack clearing
--     is_public is sufficient on its own, no extra filter needed here.
-- Section 5 has the exact CREATE OR REPLACE diff for search_pack_catalog
-- based on its real body as pulled from the live project.

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

-- Posting requires "signed in AND (installed OR the pack's own creator)".
-- A creator has no reason to install their own pack first just to leave
-- themselves a comment. Rating is unchanged (installers only) since a
-- creator rating their own pack would inflate the public average shown
-- in Découvrir.
-- No update/delete policy: editing/removing a posted comment is out of
-- scope (no moderation tooling yet).
create policy pack_comments_insert_own_if_installed
  on public.pack_comments
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from public.pack_installs pi
        where pi.pack_guid = pack_comments.pack_guid and pi.user_id = auth.uid()
      )
      or exists (
        select 1 from public.pack_catalog pc
        where pc.pack_guid = pack_comments.pack_guid and pc.owner_id = auth.uid()
      )
    )
  );

-- =========================================================
-- 4. New RPCs
-- =========================================================

-- Owner-only soft delete. Row + storage zip are kept; the pack drops out
-- of public search via is_public=false (confirmed: search_pack_catalog's
-- WHERE clause only checks is_public, so this alone is enough -- see
-- section 5). Uses 'archived', not a new 'unpublished' value:
-- pack_catalog already has a check constraint restricting
-- publication_status to draft/published/archived, and 'archived' already
-- means exactly this.
--
-- SECURITY DEFINER + manual owner_id/auth.uid() check, exactly mirroring
-- publish_my_pack's real body (pulled from the live project) -- NOT a
-- style choice. pack_catalog has no direct UPDATE access granted to the
-- `authenticated` role; every write goes through an owner-checking
-- SECURITY DEFINER function like this one. A plain SECURITY INVOKER
-- version (the default) would silently update zero rows every time,
-- since the calling role can't touch the row directly.
drop function if exists public.unpublish_my_pack(text);
drop function if exists public.delete_my_pack(text);

create or replace function public.unpublish_my_pack(p_pack_guid text default ''::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.pack_catalog;
begin
  if v_uid is null then
    raise exception 'Connexion Supabase requise.';
  end if;

  update public.pack_catalog
  set is_public = false,
      publication_status = 'archived',
      updated_at = now()
  where pack_guid = nullif(trim(p_pack_guid), '')
    and owner_id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Pack introuvable pour ce compte.';
  end if;

  return to_jsonb(v_row);
end;
$function$;

create or replace function public.delete_my_pack(p_pack_guid text default ''::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.pack_catalog;
begin
  if v_uid is null then
    raise exception 'Connexion Supabase requise.';
  end if;

  delete from public.pack_catalog
  where pack_guid = nullif(trim(p_pack_guid), '')
    and owner_id = v_uid
    and is_public = false
    and publication_status = 'archived'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Pack dépublié introuvable pour ce compte.';
  end if;

  return to_jsonb(v_row);
end;
$function$;

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
grant execute on function public.delete_my_pack(text) to authenticated;
grant execute on function public.record_pack_install(text, integer) to authenticated;
grant execute on function public.record_pack_installs_bulk(jsonb) to authenticated;
grant execute on function public.get_my_pack_status(text) to authenticated;
grant execute on function public.rate_pack(text, smallint) to authenticated;
grant execute on function public.add_pack_comment(text, text) to authenticated;

-- =========================================================
-- 5. Replaces the EXISTING search_pack_catalog RPC
-- =========================================================
-- This is the real function body as pulled from the live project via
-- `select pg_get_functiondef(oid) from pg_proc where proname =
-- 'search_pack_catalog';`, with three changes from the original:
--   1. avg_rating, rating_count, comment_count added to the per-row JSON
--      (they flow through for free from section 2's new columns, since
--      every CTE here selects b.*/filtered.* rather than naming columns).
--   2. A 'note' branch added to the ORDER BY inside the `ordered` CTE.
--   3. theme_rows now groups straight from public.pack_catalog (is_public
--      only) instead of from `filtered` -- the theme sidebar is a snapshot
--      of the catalog and no longer reacts to query/theme/type/status or to
--      your own install state (2026-08-05).
-- No change was needed to exclude archived/unpublished packs -- the WHERE
-- clause already filters on is_public = true only (confirmed against the
-- live body below), and unpublish_my_pack already clears that flag.
--
-- Known, deliberate limitation: this is a plain average, so one 5-star
-- rating can outrank a pack with hundreds of 4.9-average ratings. A
-- Bayesian/Wilson-score smoothed sort would fix this but is a separate,
-- later concern -- not implemented here.

create or replace function public.search_pack_catalog(p_query text DEFAULT ''::text, p_theme text DEFAULT ''::text, p_type_group text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_sort text DEFAULT 'pertinence'::text, p_limit integer DEFAULT 24, p_cursor integer DEFAULT 0, p_installed_versions jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language sql
 stable
as $function$
with params as (
  select
    nullif(trim(coalesce(p_query, '')), '') as query_text,
    nullif(trim(coalesce(p_theme, '')), '') as theme_text,
    nullif(trim(coalesce(p_type_group, '')), '') as type_text,
    coalesce(nullif(p_status, ''), 'all') as status_text,
    coalesce(nullif(p_sort, ''), 'pertinence') as sort_text,
    greatest(1, least(coalesce(p_limit, 24), 60)) as page_limit,
    greatest(0, coalesce(p_cursor, 0)) as page_offset,
    coalesce(p_installed_versions, '{}'::jsonb) as installed
),
base as (
  select
    b.*,
    case
      when params.installed ? b.pack_guid
        then (params.installed ->> b.pack_guid)::integer
      else null
    end as installed_version,
    case
      when params.installed ? b.pack_guid
        and (params.installed ->> b.pack_guid)::integer < b.version
        then 'update_available'
      when params.installed ? b.pack_guid
        then 'up_to_date'
      else 'not_installed'
    end as install_status,
    case
      when params.query_text is null then 0
      else ts_rank(b.search_vector, websearch_to_tsquery('simple', params.query_text))
    end as rank
  from public.pack_catalog b
  cross join params
  where b.is_public = true
    and (
      params.query_text is null
      or b.search_vector @@ websearch_to_tsquery('simple', params.query_text)
    )
    and (params.theme_text is null or b.themes @> array[params.theme_text])
    and (params.type_text is null or b.type_group = params.type_text)
),
filtered as (
  select base.*
  from base
  cross join params
  where params.status_text = 'all'
     or base.install_status = params.status_text
),
ordered as (
  select
    sorted.*,
    row_number() over () as page_order
  from (
    select filtered.*
    from filtered
    cross join params
    order by
      case when params.sort_text = 'pertinence' then filtered.rank end desc nulls last,
      case when params.sort_text = 'populaires' then filtered.featured end desc,
      case when params.sort_text = 'populaires' then filtered.download_count end desc,
      case when params.sort_text = 'note' then filtered.avg_rating end desc nulls last,
      case when params.sort_text = 'note' then filtered.rating_count end desc nulls last,
      case when params.sort_text = 'récents' then filtered.updated_at end desc,
      case when params.sort_text = 'nom' then lower(filtered.name) end asc,
      case when params.sort_text = 'questions' then filtered.question_count end desc,
      filtered.featured desc,
      filtered.download_count desc,
      lower(filtered.name) asc
    limit (select page_limit + 1 from params)
    offset (select page_offset from params)
  ) sorted
),
page as (
  select *
  from ordered
  where page_order <= (select page_limit from params)
),
-- Theme facets are a snapshot of the whole public catalog, independent of
-- query/theme/type/status -- otherwise the sidebar shrinks or reorders
-- whenever you search, filter, or install something, even though nothing in
-- the shared catalog changed. It should only move when the catalog itself
-- does.
theme_rows as (
  select
    unnest(themes) as theme,
    count(*) as result_count,
    sum(download_count) as download_count,
    bool_or(featured) as featured,
    bool_or(pinned) as pinned
  from public.pack_catalog
  where is_public = true
  group by theme
)
select jsonb_build_object(
  'packs',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'pack_guid', pack_guid,
        'name', name,
        'description', description,
        'type_group', type_group,
        'question_count', question_count,
        'version', version,
        'size_bytes', size_bytes,
        'license', license,
        'tags', tags,
        'themes', themes,
        'download_count', download_count,
        'featured', featured,
        'published_at', published_at,
        'updated_at', updated_at,
        'storage_path', storage_path,
        'avg_rating', avg_rating,
        'rating_count', rating_count,
        'comment_count', comment_count
      )
      order by page_order
    )
    from page
  ), '[]'::jsonb),
  'facets',
  jsonb_build_object(
    'themes',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'value', theme,
          'label', initcap(replace(theme, '-', ' ')),
          'result_count', result_count,
          'download_count', download_count,
          'featured', featured,
          'pinned', pinned
        )
        order by pinned desc, result_count desc, download_count desc, theme asc
      )
      from theme_rows
    ), '[]'::jsonb)
  ),
  'total', (select count(*) from filtered),
  'next_cursor',
  case
    when (select count(*) from ordered) > (select page_limit from params)
      then ((select page_offset from params) + (select page_limit from params))::text
    else null
  end
);
$function$;

select pg_notify('pgrst', 'reload schema');

commit;
