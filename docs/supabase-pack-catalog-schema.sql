-- Supabase setup for the pack catalog: safe catalog reads, variants,
-- suggested edits, permanent deletion, install tracking, ratings, comments,
-- and activity.
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
-- based on its real body as pulled from the live project. It now runs as
-- SECURITY DEFINER because the app intentionally does not rely on broad
-- pack_catalog table grants for public catalog search.

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

create table if not exists public.pack_suggested_edits (
  id bigint generated always as identity primary key,
  pack_guid text not null references public.pack_catalog(pack_guid) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_label text not null,
  target_question_guid text,
  target_group_guid text,
  target_label text,
  target_snapshot jsonb not null default '{}'::jsonb,
  proposed_question text not null default '',
  proposed_answer text not null default '',
  note text not null,
  status text not null default 'pending',
  owner_note text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  applied_at timestamptz
);

alter table public.pack_suggested_edits
  add column if not exists applied_at timestamptz;

do $$
begin
  alter table public.pack_suggested_edits
    add constraint pack_suggested_edits_note_length
    check (char_length(note) between 1 and 2000);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.pack_suggested_edits
    add constraint pack_suggested_edits_status_check
    check (status in ('pending', 'accepted', 'rejected'));
exception
  when duplicate_object then null;
end $$;

create index if not exists pack_suggested_edits_pack_status_created_idx
  on public.pack_suggested_edits (pack_guid, status, created_at desc);

create index if not exists pack_suggested_edits_user_created_idx
  on public.pack_suggested_edits (user_id, created_at desc);

create table if not exists public.pack_activity_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  pack_guid text not null references public.pack_catalog(pack_guid) on delete cascade,
  related_pack_guid text not null references public.pack_catalog(pack_guid) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  alter table public.pack_activity_events
    drop constraint if exists pack_activity_events_type_check;

  alter table public.pack_activity_events
    add constraint pack_activity_events_type_check
    check (event_type in ('variant_published', 'suggested_edit_created'));
exception
  when duplicate_object then null;
end $$;

create index if not exists pack_activity_events_user_unread_idx
  on public.pack_activity_events (user_id, read_at, created_at desc);

create unique index if not exists pack_activity_events_variant_once_idx
  on public.pack_activity_events (user_id, event_type, related_pack_guid)
  where event_type = 'variant_published';

-- =========================================================
-- 2. Denormalized aggregates and lineage on pack_catalog
-- =========================================================
-- Avoids a join on every search page and makes "top rated" sort a plain
-- indexed ORDER BY. Kept in sync by triggers below -- application code
-- never writes these columns directly.

alter table public.pack_catalog
  add column if not exists avg_rating numeric(3,2) not null default 0,
  add column if not exists rating_count integer not null default 0,
  add column if not exists comment_count integer not null default 0,
  add column if not exists variant_of_pack_guid text,
  add column if not exists root_pack_guid text;

update public.pack_catalog
set root_pack_guid = pack_guid
where root_pack_guid is null;

alter table public.pack_catalog
  alter column root_pack_guid set not null;

do $$
begin
  alter table public.pack_catalog
    add constraint pack_catalog_variant_not_self
    check (variant_of_pack_guid is null or variant_of_pack_guid <> pack_guid);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.pack_catalog
    add constraint pack_catalog_variant_of_pack_guid_fkey
    foreign key (variant_of_pack_guid)
    references public.pack_catalog(pack_guid)
    on delete restrict;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.pack_catalog
    add constraint pack_catalog_root_pack_guid_fkey
    foreign key (root_pack_guid)
    references public.pack_catalog(pack_guid)
    on delete restrict;
exception
  when duplicate_object then null;
end $$;

create index if not exists pack_catalog_avg_rating_idx
  on public.pack_catalog (avg_rating desc, rating_count desc);

create index if not exists pack_catalog_variant_of_pack_guid_idx
  on public.pack_catalog (variant_of_pack_guid);

create index if not exists pack_catalog_root_pack_guid_idx
  on public.pack_catalog (root_pack_guid);

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

alter function public.pack_catalog_refresh_rating_stats()
  owner to postgres;

alter function public.pack_catalog_refresh_rating_stats()
  security definer;

alter function public.pack_catalog_refresh_rating_stats()
  set search_path to 'public';

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

alter function public.pack_catalog_refresh_comment_stats()
  owner to postgres;

alter function public.pack_catalog_refresh_comment_stats()
  security definer;

alter function public.pack_catalog_refresh_comment_stats()
  set search_path to 'public';

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
--
-- pack_catalog itself needs SELECT policies because the app reads public
-- rows anonymously and owner rows through PostgREST, but it still receives
-- no direct INSERT/UPDATE/DELETE grant. Mutations continue to go through
-- owner-checking RPCs.

alter table public.pack_catalog enable row level security;
alter table public.pack_installs enable row level security;
alter table public.pack_ratings enable row level security;
alter table public.pack_comments enable row level security;
alter table public.pack_suggested_edits enable row level security;
alter table public.pack_activity_events enable row level security;

grant select on public.pack_catalog to anon, authenticated;
grant select, insert, update on public.pack_installs to authenticated;
grant select, insert, update on public.pack_ratings to authenticated;
grant select, insert on public.pack_comments to authenticated;
grant select on public.pack_comments to anon;
grant select, insert, update(status, owner_note, resolved_at, updated_at, applied_at)
  on public.pack_suggested_edits to authenticated;
grant select, update(read_at) on public.pack_activity_events to authenticated;

drop policy if exists pack_catalog_select_public on public.pack_catalog;
drop policy if exists pack_catalog_select_own on public.pack_catalog;
drop policy if exists pack_installs_select_own on public.pack_installs;
drop policy if exists pack_installs_insert_own on public.pack_installs;
drop policy if exists pack_installs_update_own on public.pack_installs;

create policy pack_catalog_select_public
  on public.pack_catalog
  for select
  to anon, authenticated
  using (is_public = true);

create policy pack_catalog_select_own
  on public.pack_catalog
  for select
  to authenticated
  using (auth.uid() = owner_id);

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
drop policy if exists pack_suggested_edits_select_related on public.pack_suggested_edits;
drop policy if exists pack_suggested_edits_insert_own_if_installed on public.pack_suggested_edits;
drop policy if exists pack_suggested_edits_owner_resolve on public.pack_suggested_edits;
drop policy if exists pack_activity_events_select_own on public.pack_activity_events;
drop policy if exists pack_activity_events_mark_read_own on public.pack_activity_events;

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

create policy pack_suggested_edits_select_related
  on public.pack_suggested_edits
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.pack_catalog pc
      where pc.pack_guid = pack_suggested_edits.pack_guid
        and pc.owner_id = auth.uid()
    )
  );

create policy pack_suggested_edits_insert_own_if_installed
  on public.pack_suggested_edits
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.pack_installs pi
      where pi.pack_guid = pack_suggested_edits.pack_guid
        and pi.user_id = auth.uid()
    )
    and not exists (
      select 1 from public.pack_catalog pc
      where pc.pack_guid = pack_suggested_edits.pack_guid
        and pc.owner_id = auth.uid()
    )
  );

create policy pack_suggested_edits_owner_resolve
  on public.pack_suggested_edits
  for update
  to authenticated
  using (
    exists (
      select 1 from public.pack_catalog pc
      where pc.pack_guid = pack_suggested_edits.pack_guid
        and pc.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.pack_catalog pc
      where pc.pack_guid = pack_suggested_edits.pack_guid
        and pc.owner_id = auth.uid()
    )
  );

create policy pack_activity_events_select_own
  on public.pack_activity_events
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy pack_activity_events_mark_read_own
  on public.pack_activity_events
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
drop function if exists public.publish_my_pack(text);
drop function if exists public.upsert_my_pack_draft(
  text, text, text, text, integer, integer, integer, text, text[], text[], text
);
drop function if exists public.upsert_my_pack_draft(
  text, text, text, text, integer, integer, integer, text, text[], text[], text, text
);
drop function if exists public.get_pack_family(text);
drop function if exists public.list_pack_activity_events(integer);
drop function if exists public.mark_pack_activity_events_read(bigint[]);
drop function if exists public.submit_pack_suggested_edit(text, text, text, text, jsonb, text, text, text);
drop function if exists public.list_pack_suggested_edits(text, integer);
drop function if exists public.resolve_pack_suggested_edit(bigint, text, text);
drop function if exists public.mark_pack_suggested_edit_applied(bigint);

create or replace function public.pack_catalog_recommendation_score(
  p_avg_rating numeric,
  p_rating_count integer,
  p_download_count integer,
  p_updated_at timestamptz
)
returns numeric
language sql
stable
as $$
  select
    (
      (
        coalesce(p_avg_rating, 0) * greatest(coalesce(p_rating_count, 0), 0)
        + 3.5 * 5
      )
      / (greatest(coalesce(p_rating_count, 0), 0) + 5)
    )
    + ln(greatest(coalesce(p_rating_count, 0), 0) + 1) * 0.12
    + ln(greatest(coalesce(p_download_count, 0), 0) + 1) * 0.08
    + case
        when p_updated_at > now() - interval '90 days'
          then 0.05
        else 0
      end;
$$;

create or replace function public.upsert_my_pack_draft(
  p_pack_guid text default ''::text,
  p_name text default ''::text,
  p_description text default ''::text,
  p_type_group text default 'text'::text,
  p_question_count integer default 0,
  p_version integer default 1,
  p_size_bytes integer default 0,
  p_license text default ''::text,
  p_tags text[] default '{}'::text[],
  p_themes text[] default '{}'::text[],
  p_storage_path text default ''::text,
  p_variant_of_pack_guid text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_pack_guid text := nullif(trim(coalesce(p_pack_guid, '')), '');
  v_variant_of text := nullif(trim(coalesce(p_variant_of_pack_guid, '')), '');
  v_root_guid text;
  v_existing public.pack_catalog;
  v_base public.pack_catalog;
  v_row public.pack_catalog;
  v_tags text[] := coalesce(p_tags, '{}'::text[]);
  v_themes text[] := coalesce(p_themes, '{}'::text[]);
begin
  if v_uid is null then
    raise exception 'Connexion Supabase requise.';
  end if;

  if v_pack_guid is null then
    raise exception 'Pack introuvable.';
  end if;

  select *
  into v_existing
  from public.pack_catalog
  where pack_guid = v_pack_guid;

  if v_existing.id is not null and v_existing.owner_id <> v_uid then
    raise exception 'Pack introuvable pour ce compte.';
  end if;

  if v_existing.id is not null then
    v_variant_of := v_existing.variant_of_pack_guid;
    v_root_guid := coalesce(v_existing.root_pack_guid, v_existing.pack_guid);
  elsif v_variant_of is not null then
    if v_variant_of = v_pack_guid then
      raise exception 'Un pack ne peut pas être sa propre variante.';
    end if;

    select *
    into v_base
    from public.pack_catalog
    where pack_guid = v_variant_of
      and is_public = true;

    if v_base.id is null then
      raise exception 'Pack de base introuvable.';
    end if;

    if v_base.owner_id = v_uid then
      raise exception 'Utilise Publier les changements pour ton propre pack.';
    end if;

    if not exists (
      select 1
      from public.pack_installs pi
      where pi.pack_guid = v_variant_of
        and pi.user_id = v_uid
    ) then
      raise exception 'Installe ce pack avant de publier une variante.';
    end if;

    v_root_guid := coalesce(v_base.root_pack_guid, v_base.pack_guid);
  else
    v_root_guid := v_pack_guid;
  end if;

  insert into public.pack_catalog as existing (
    pack_guid,
    owner_id,
    name,
    description,
    type_group,
    question_count,
    version,
    size_bytes,
    license,
    tags,
    themes,
    storage_path,
    is_public,
    publication_status,
    variant_of_pack_guid,
    root_pack_guid,
    search_vector,
    updated_at
  )
  values (
    v_pack_guid,
    v_uid,
    nullif(trim(coalesce(p_name, '')), ''),
    coalesce(p_description, ''),
    coalesce(nullif(trim(p_type_group), ''), 'text'),
    greatest(coalesce(p_question_count, 0), 0),
    greatest(coalesce(p_version, 1), 1),
    greatest(coalesce(p_size_bytes, 0), 0),
    coalesce(p_license, ''),
    v_tags,
    v_themes,
    coalesce(p_storage_path, ''),
    false,
    'draft',
    v_variant_of,
    v_root_guid,
    to_tsvector(
      'simple',
      concat_ws(
        ' ',
        p_name,
        p_description,
        p_license,
        array_to_string(v_tags, ' '),
        array_to_string(v_themes, ' ')
      )
    ),
    timezone('utc', now())
  )
  on conflict (pack_guid) do update
    set name = excluded.name,
        description = excluded.description,
        type_group = excluded.type_group,
        question_count = excluded.question_count,
        version = excluded.version,
        size_bytes = excluded.size_bytes,
        license = excluded.license,
        tags = excluded.tags,
        themes = excluded.themes,
        storage_path = excluded.storage_path,
        is_public = false,
        publication_status = 'draft',
        variant_of_pack_guid = existing.variant_of_pack_guid,
        root_pack_guid = existing.root_pack_guid,
        search_vector = excluded.search_vector,
        updated_at = timezone('utc', now())
    where existing.owner_id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Pack introuvable pour ce compte.';
  end if;

  return to_jsonb(v_row);
end;
$function$;

create or replace function public.publish_my_pack(p_pack_guid text default ''::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_previous public.pack_catalog;
  v_row public.pack_catalog;
begin
  if v_uid is null then
    raise exception 'Connexion Supabase requise.';
  end if;

  select *
  into v_previous
  from public.pack_catalog
  where pack_guid = nullif(trim(p_pack_guid), '')
    and owner_id = v_uid;

  if v_previous.id is null then
    raise exception 'Pack introuvable pour ce compte.';
  end if;

  update public.pack_catalog
  set is_public = true,
      publication_status = 'published',
      published_at = coalesce(published_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = v_previous.id
  returning * into v_row;

  if v_row.variant_of_pack_guid is not null then
    insert into public.pack_activity_events (
      user_id,
      actor_id,
      event_type,
      pack_guid,
      related_pack_guid,
      payload
    )
    select distinct
      recipient.owner_id,
      v_uid,
      'variant_published',
      recipient.pack_guid,
      v_row.pack_guid,
      jsonb_build_object(
        'pack_name', recipient.name,
        'related_pack_name', v_row.name,
        'root_pack_guid', v_row.root_pack_guid
      )
    from public.pack_catalog recipient
    where recipient.pack_guid in (
        v_row.variant_of_pack_guid,
        v_row.root_pack_guid
      )
      and recipient.owner_id <> v_uid
    on conflict do nothing;
  end if;

  return to_jsonb(v_row);
end;
$function$;

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

create or replace function public.pack_user_display_label(
  p_user_id uuid,
  p_fallback text default null::text
)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_username text;
begin
  -- Profiles are optional on older catalog deployments, so keep this lookup
  -- dynamic instead of taking a hard dependency at function creation time.
  if p_user_id is not null and to_regclass('public.profiles') is not null then
    execute
      'select nullif(trim(username), '''') from public.profiles where user_id = $1 limit 1'
    into v_username
    using p_user_id;
  end if;

  return coalesce(
    v_username,
    nullif(trim(coalesce(p_fallback, '')), ''),
    'Utilisateur'
  );
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
    public.pack_user_display_label(auth.uid(), auth.jwt() ->> 'email'),
    p_body
  )
  returning *;
$$;

create or replace function public.submit_pack_suggested_edit(
  p_pack_guid text,
  p_target_question_guid text default null::text,
  p_target_group_guid text default null::text,
  p_target_label text default ''::text,
  p_target_snapshot jsonb default '{}'::jsonb,
  p_proposed_question text default ''::text,
  p_proposed_answer text default ''::text,
  p_note text default ''::text
)
returns public.pack_suggested_edits
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_pack public.pack_catalog;
  v_note text := trim(coalesce(p_note, ''));
  v_author_label text;
  v_row public.pack_suggested_edits;
begin
  if v_uid is null then
    raise exception 'Connexion Supabase requise.';
  end if;

  v_author_label := public.pack_user_display_label(
    v_uid,
    auth.jwt() ->> 'email'
  );

  if char_length(v_note) < 1 or char_length(v_note) > 2000 then
    raise exception 'Ajoute une note pour expliquer la correction.';
  end if;

  select *
  into v_pack
  from public.pack_catalog
  where pack_guid = p_pack_guid
    and is_public = true
  limit 1;

  if not found then
    raise exception 'Pack introuvable.';
  end if;

  if v_pack.owner_id = v_uid then
    raise exception 'Tu possèdes déjà ce pack.';
  end if;

  if not exists (
    select 1
    from public.pack_installs pi
    where pi.pack_guid = p_pack_guid
      and pi.user_id = v_uid
  ) then
    raise exception 'Installe ce pack avant de proposer une correction.';
  end if;

  insert into public.pack_suggested_edits (
    pack_guid,
    user_id,
    author_label,
    target_question_guid,
    target_group_guid,
    target_label,
    target_snapshot,
    proposed_question,
    proposed_answer,
    note
  )
  values (
    p_pack_guid,
    v_uid,
    v_author_label,
    nullif(trim(coalesce(p_target_question_guid, '')), ''),
    nullif(trim(coalesce(p_target_group_guid, '')), ''),
    left(trim(coalesce(p_target_label, '')), 160),
    coalesce(p_target_snapshot, '{}'::jsonb),
    left(trim(coalesce(p_proposed_question, '')), 2000),
    left(trim(coalesce(p_proposed_answer, '')), 2000),
    v_note
  )
  returning *
  into v_row;

  insert into public.pack_activity_events (
    user_id,
    actor_id,
    event_type,
    pack_guid,
    related_pack_guid,
    payload
  )
  values (
    v_pack.owner_id,
    v_uid,
    'suggested_edit_created',
    p_pack_guid,
    p_pack_guid,
    jsonb_build_object(
      'suggested_edit_id', v_row.id,
      'pack_name', v_pack.name,
      'target_label', v_row.target_label,
      'author_label', v_row.author_label
    )
  );

  return v_row;
end;
$$;

create or replace function public.list_pack_suggested_edits(
  p_pack_guid text,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with params as (
  select
    auth.uid() as uid,
    greatest(1, least(coalesce(p_limit, 50), 60)) as limit_value
),
authorized as (
  select pc.pack_guid
  from public.pack_catalog pc
  join params on params.uid = pc.owner_id
  where pc.pack_guid = p_pack_guid
  limit 1
),
rows as (
  select pse.*
  from public.pack_suggested_edits pse
  join authorized on authorized.pack_guid = pse.pack_guid
  order by
    case when pse.status = 'pending' then 0 else 1 end,
    pse.created_at desc
  limit (select limit_value from params)
)
select jsonb_build_object(
  'suggestions',
  coalesce((
    select jsonb_agg(
      to_jsonb(rows)
      || jsonb_build_object(
        'author_label',
        public.pack_user_display_label(rows.user_id, rows.author_label)
      )
      order by
      case when rows.status = 'pending' then 0 else 1 end,
      rows.created_at desc
    )
    from rows
  ), '[]'::jsonb),
  'pending_count',
  (
    select count(*)
    from public.pack_suggested_edits pse
    join authorized on authorized.pack_guid = pse.pack_guid
    where pse.status = 'pending'
  )
);
$$;

create or replace function public.resolve_pack_suggested_edit(
  p_edit_id bigint,
  p_status text,
  p_owner_note text default ''::text
)
returns public.pack_suggested_edits
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := trim(coalesce(p_status, ''));
  v_row public.pack_suggested_edits;
begin
  if v_uid is null then
    raise exception 'Connexion Supabase requise.';
  end if;

  if v_status not in ('accepted', 'rejected') then
    raise exception 'Statut de suggestion invalide.';
  end if;

  update public.pack_suggested_edits pse
  set status = v_status,
      author_label = public.pack_user_display_label(pse.user_id, pse.author_label),
      owner_note = left(trim(coalesce(p_owner_note, '')), 1000),
      resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where pse.id = p_edit_id
    and exists (
      select 1
      from public.pack_catalog pc
      where pc.pack_guid = pse.pack_guid
        and pc.owner_id = v_uid
    )
  returning *
  into v_row;

  if not found then
    raise exception 'Suggestion introuvable.';
  end if;

  return v_row;
end;
$$;

create or replace function public.mark_pack_suggested_edit_applied(
  p_edit_id bigint
)
returns public.pack_suggested_edits
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.pack_suggested_edits;
begin
  if v_uid is null then
    raise exception 'Connexion Supabase requise.';
  end if;

  update public.pack_suggested_edits pse
  set applied_at = coalesce(pse.applied_at, timezone('utc', now())),
      author_label = public.pack_user_display_label(pse.user_id, pse.author_label),
      updated_at = timezone('utc', now())
  where pse.id = p_edit_id
    and pse.status = 'accepted'
    and exists (
      select 1
      from public.pack_catalog pc
      where pc.pack_guid = pse.pack_guid
        and pc.owner_id = v_uid
    )
  returning *
  into v_row;

  if not found then
    raise exception 'Suggestion acceptée introuvable.';
  end if;

  return v_row;
end;
$$;

create or replace function public.get_pack_family(p_pack_guid text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with selected as (
  select coalesce(root_pack_guid, pack_guid) as root_guid
  from public.pack_catalog
  where pack_guid = p_pack_guid
    and is_public = true
  limit 1
),
family as (
  select
    pc.*,
    public.pack_catalog_recommendation_score(
      pc.avg_rating,
      pc.rating_count,
      pc.download_count,
      pc.updated_at
    ) as recommendation_score
  from public.pack_catalog pc
  join selected on coalesce(pc.root_pack_guid, pc.pack_guid) = selected.root_guid
  where pc.is_public = true
),
recommended as (
  select pack_guid
  from family
  order by
    recommendation_score desc,
    case when variant_of_pack_guid is null then 0 else 1 end,
    updated_at desc,
    lower(name) asc
  limit 1
),
original as (
  select *
  from family
  where pack_guid = (select root_guid from selected)
  limit 1
),
counts as (
  select count(*) filter (where variant_of_pack_guid is not null) as variant_count
  from family
)
select jsonb_build_object(
  'pack_guid', p_pack_guid,
  'original_pack_guid', (select root_guid from selected),
  'recommended_pack_guid', (select pack_guid from recommended),
  'variant_count', coalesce((select variant_count from counts), 0),
  'packs',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'pack_guid', family.pack_guid,
        'name', family.name,
        'description', family.description,
        'type_group', family.type_group,
        'question_count', family.question_count,
        'version', family.version,
        'size_bytes', family.size_bytes,
        'license', family.license,
        'tags', family.tags,
        'themes', family.themes,
        'download_count', family.download_count,
        'featured', family.featured,
        'published_at', family.published_at,
        'updated_at', family.updated_at,
        'storage_path', family.storage_path,
        'avg_rating', family.avg_rating,
        'rating_count', family.rating_count,
        'comment_count', family.comment_count,
        'variant_of_pack_guid', family.variant_of_pack_guid,
        'root_pack_guid', family.root_pack_guid,
        'original_pack_guid', (select root_guid from selected),
        'recommended_pack_guid', (select pack_guid from recommended),
        'original_name', (select name from original),
        'variant_count', (select variant_count from counts)
      )
      order by
        case when family.pack_guid = (select root_guid from selected) then 0 else 1 end,
        case when family.pack_guid = (select pack_guid from recommended) then 0 else 1 end,
        family.recommendation_score desc,
        family.updated_at desc,
        lower(family.name) asc
    )
    from family
  ), '[]'::jsonb)
);
$$;

create or replace function public.list_pack_activity_events(p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with params as (
  select auth.uid() as uid, greatest(1, least(coalesce(p_limit, 20), 60)) as limit_value
),
events as (
  select
    pae.id,
    pae.event_type,
    pae.pack_guid,
    base.name as pack_name,
    pae.related_pack_guid,
    related.name as related_pack_name,
    case
      when pae.event_type = 'suggested_edit_created' then
        jsonb_set(
          pae.payload,
          '{author_label}',
          to_jsonb(public.pack_user_display_label(
            pae.actor_id,
            pae.payload ->> 'author_label'
          )),
          true
        )
      else pae.payload
    end as payload,
    pae.read_at,
    pae.created_at
  from public.pack_activity_events pae
  join params on params.uid = pae.user_id
  left join public.pack_catalog base on base.pack_guid = pae.pack_guid
  left join public.pack_catalog related on related.pack_guid = pae.related_pack_guid
  order by pae.created_at desc
  limit (select limit_value from params)
)
select jsonb_build_object(
  'events',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', id,
        'event_type', event_type,
        'pack_guid', pack_guid,
        'pack_name', pack_name,
        'related_pack_guid', related_pack_guid,
        'related_pack_name', related_pack_name,
        'payload', payload,
        'read_at', read_at,
        'created_at', created_at
      )
      order by created_at desc
    )
    from events
  ), '[]'::jsonb),
  'unread_count',
  (
    select count(*)
    from public.pack_activity_events pae
    join params on params.uid = pae.user_id
    where pae.read_at is null
  )
);
$$;

create or replace function public.mark_pack_activity_events_read(
  p_event_ids bigint[] default '{}'::bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  affected integer;
begin
  if v_uid is null then
    raise exception 'Connexion Supabase requise.';
  end if;

  update public.pack_activity_events
  set read_at = coalesce(read_at, timezone('utc', now()))
  where user_id = v_uid
    and read_at is null
    and (
      cardinality(coalesce(p_event_ids, '{}'::bigint[])) = 0
      or id = any(p_event_ids)
    );

  get diagnostics affected = row_count;

  return jsonb_build_object('updated', affected);
end;
$$;

grant execute on function public.upsert_my_pack_draft(
  text, text, text, text, integer, integer, integer, text, text[], text[], text, text
) to authenticated;
grant execute on function public.publish_my_pack(text) to authenticated;
grant execute on function public.unpublish_my_pack(text) to authenticated;
grant execute on function public.delete_my_pack(text) to authenticated;
grant execute on function public.record_pack_install(text, integer) to authenticated;
grant execute on function public.record_pack_installs_bulk(jsonb) to authenticated;
grant execute on function public.get_my_pack_status(text) to authenticated;
grant execute on function public.rate_pack(text, smallint) to authenticated;
grant execute on function public.pack_user_display_label(uuid, text) to authenticated;
grant execute on function public.add_pack_comment(text, text) to authenticated;
grant execute on function public.submit_pack_suggested_edit(
  text, text, text, text, jsonb, text, text, text
) to authenticated;
grant execute on function public.list_pack_suggested_edits(text, integer) to authenticated;
grant execute on function public.resolve_pack_suggested_edit(bigint, text, text) to authenticated;
grant execute on function public.mark_pack_suggested_edit_applied(bigint) to authenticated;
grant execute on function public.get_pack_family(text) to anon, authenticated;
grant execute on function public.list_pack_activity_events(integer) to authenticated;
grant execute on function public.mark_pack_activity_events_read(bigint[]) to authenticated;

-- =========================================================
-- 5. Replaces the EXISTING search_pack_catalog RPC
-- =========================================================
-- This keeps the old response envelope/row fields but now groups public
-- rows by root_pack_guid and returns one recommended representative per
-- family. The representative score is deterministic and smoothed; ties keep
-- the original above variants. theme_rows still groups straight from
-- public.pack_catalog (is_public only) so the theme sidebar is a stable
-- snapshot of the catalog instead of reacting to query/theme/type/status or
-- to your own install state.
-- No change was needed to exclude archived/unpublished packs -- the WHERE
-- clause already filters on is_public = true only (confirmed against the
-- live body below), and unpublish_my_pack already clears that flag.

create or replace function public.search_pack_catalog(p_query text DEFAULT ''::text, p_theme text DEFAULT ''::text, p_type_group text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_sort text DEFAULT 'pertinence'::text, p_limit integer DEFAULT 24, p_cursor integer DEFAULT 0, p_installed_versions jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
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
    coalesce(b.root_pack_guid, b.pack_guid) as family_guid,
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
    end as rank,
    public.pack_catalog_recommendation_score(
      b.avg_rating,
      b.rating_count,
      b.download_count,
      b.updated_at
    ) as recommendation_score
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
family_counts as (
  select
    coalesce(root_pack_guid, pack_guid) as family_guid,
    count(*) filter (where variant_of_pack_guid is not null) as variant_count
  from public.pack_catalog
  where is_public = true
  group by coalesce(root_pack_guid, pack_guid)
),
family_originals as (
  select
    original.pack_guid as family_guid,
    original.name as original_name
  from public.pack_catalog original
  where original.is_public = true
    and coalesce(original.root_pack_guid, original.pack_guid) = original.pack_guid
),
family_representatives as (
  select *
  from (
    select
      filtered.*,
      row_number() over (
        partition by filtered.family_guid
        order by
          filtered.recommendation_score desc,
          case when filtered.variant_of_pack_guid is null then 0 else 1 end,
          filtered.updated_at desc,
          lower(filtered.name) asc
      ) as family_rank
    from filtered
  ) ranked
  where family_rank = 1
),
ordered as (
  select
    sorted.*,
    row_number() over () as page_order
  from (
    select
      family_representatives.*,
      coalesce(family_counts.variant_count, 0) as variant_count,
      family_originals.original_name
    from family_representatives
    cross join params
    left join family_counts
      on family_counts.family_guid = family_representatives.family_guid
    left join family_originals
      on family_originals.family_guid = family_representatives.family_guid
    order by
      case when params.sort_text = 'pertinence' then family_representatives.rank end desc nulls last,
      case when params.sort_text = 'populaires' then family_representatives.featured end desc,
      case when params.sort_text = 'populaires' then family_representatives.download_count end desc,
      case when params.sort_text = 'note' then family_representatives.avg_rating end desc nulls last,
      case when params.sort_text = 'note' then family_representatives.rating_count end desc nulls last,
      case when params.sort_text = 'récents' then family_representatives.updated_at end desc,
      case when params.sort_text = 'nom' then lower(family_representatives.name) end asc,
      case when params.sort_text = 'questions' then family_representatives.question_count end desc,
      family_representatives.featured desc,
      family_representatives.recommendation_score desc,
      family_representatives.download_count desc,
      case when family_representatives.variant_of_pack_guid is null then 0 else 1 end,
      lower(family_representatives.name) asc
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
        'comment_count', comment_count,
        'variant_of_pack_guid', variant_of_pack_guid,
        'root_pack_guid', root_pack_guid,
        'original_pack_guid', family_guid,
        'recommended_pack_guid', pack_guid,
        'original_name', original_name,
        'variant_count', variant_count
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
  'total', (select count(*) from family_representatives),
  'next_cursor',
  case
    when (select count(*) from ordered) > (select page_limit from params)
      then ((select page_offset from params) + (select page_limit from params))::text
    else null
  end
);
$function$;

grant execute on function public.search_pack_catalog(
  text, text, text, text, text, integer, integer, jsonb
) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
