-- Supabase setup for user profiles (Profil screen): public username + emoji
-- avatar, and wiring pack author labels to prefer pseudos over e-mail.
--
-- Run this once in the Supabase SQL editor for the SAME project configured
-- under Settings -> Synchronisation in the app (Profil reuses the sync
-- sign-in only -- see backend/app/services/profile.py -- not the separate
-- pack-catalog sign-in).
--
-- Safe to run whether or not docs/supabase-pack-catalog-schema.sql has
-- already been applied to this project: section 5 below only touches the
-- existing add_pack_comment function, and will fail loudly (not silently)
-- if pack_comments/add_pack_comment don't exist yet -- run the pack-catalog
-- migration first in that case.

begin;

-- =========================================================
-- 1. New table
-- =========================================================

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text,
  avatar_emoji text not null default '🙂',
  avatar_color text not null default 'violet',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  alter table public.profiles
    add constraint profiles_username_length
    check (username is null or char_length(username) between 3 and 20);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.profiles
    add constraint profiles_avatar_color_allowed
    check (avatar_color in ('violet', 'amber', 'green', 'blue', 'teal', 'neutral'));
exception
  when duplicate_object then null;
end $$;

-- NULLs are never equal to each other in a unique index, so rows with no
-- username chosen yet never collide.
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- =========================================================
-- 2. updated_at housekeeping
-- =========================================================

create or replace function public.profiles_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before insert or update on public.profiles
  for each row execute function public.profiles_set_updated_at();

-- =========================================================
-- 3. Row level security -- owner-only, direct grant (mirrors
--    pack_installs/pack_ratings: pack comments, suggested edits, and pack
--    activity resolve display labels through SECURITY DEFINER RPCs instead of
--    broad profile reads. If a future feature needs to show OTHER users'
--    profiles directly, relax profiles_select_own to
--    `to anon, authenticated using (true)`, exactly like
--    pack_comments_select_all does.
-- =========================================================

alter table public.profiles enable row level security;

grant select, insert, update on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =========================================================
-- 4. Upsert RPC -- same shape as rate_pack (direct grant + owner RLS above
--    is what actually authorizes the write; no SECURITY DEFINER needed,
--    unlike unpublish_my_pack which exists specifically because
--    pack_catalog has no direct write grant).
-- =========================================================

create or replace function public.upsert_my_profile(
  p_username text,
  p_avatar_emoji text,
  p_avatar_color text
)
returns public.profiles
language plpgsql
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;

  insert into public.profiles (user_id, username, avatar_emoji, avatar_color)
  values (auth.uid(), p_username, p_avatar_emoji, p_avatar_color)
  on conflict (user_id) do update
    set username = excluded.username,
        avatar_emoji = excluded.avatar_emoji,
        avatar_color = excluded.avatar_color
  returning * into result;

  return result;
end;
$$;

grant execute on function public.upsert_my_profile(text, text, text) to authenticated;

-- =========================================================
-- 5. Replaces the shared pack-user display helper and the EXISTING
--    add_pack_comment RPC so new comments carry the poster's chosen username
--    when set, falling back to their e-mail, then 'Utilisateur' -- exactly
--    like before. Same add_pack_comment signature/return type/language as the
--    live function (docs/supabase-pack-catalog-schema.sql section 4), so
--    `create or replace` applies cleanly without a drop.
-- =========================================================

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

grant execute on function public.pack_user_display_label(uuid, text) to authenticated;
grant execute on function public.add_pack_comment(text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
