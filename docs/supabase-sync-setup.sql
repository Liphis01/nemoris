-- Supabase setup for Quiz App collection sync.
--
-- Run this once in the Supabase SQL editor for the project configured in
-- Settings -> Synchronisation. The app uses only the publishable key at
-- runtime, so it cannot create these objects itself.

begin;

create table if not exists public.collections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 0,
  schema_version text,
  updated_at timestamptz not null default timezone('utc', now()),
  last_device_id text,
  media_hashes jsonb not null default '[]'::jsonb
);

alter table public.collections
  add column if not exists version integer not null default 0,
  add column if not exists schema_version text,
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists last_device_id text,
  add column if not exists media_hashes jsonb not null default '[]'::jsonb;

do $$
begin
  alter table public.collections
    add constraint collections_version_non_negative check (version >= 0);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.collections
    add constraint collections_media_hashes_array
    check (jsonb_typeof(media_hashes) = 'array');
exception
  when duplicate_object then null;
end $$;

alter table public.collections enable row level security;

grant select, insert, update, delete on public.collections to authenticated;

drop policy if exists collections_select_own on public.collections;
drop policy if exists collections_insert_own on public.collections;
drop policy if exists collections_update_own on public.collections;
drop policy if exists collections_delete_own on public.collections;

create policy collections_select_own
  on public.collections
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy collections_insert_own
  on public.collections
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy collections_update_own
  on public.collections
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy collections_delete_own
  on public.collections
  for delete
  to authenticated
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('sync-collections', 'sync-collections', false)
on conflict (id) do update
  set public = excluded.public;

drop policy if exists sync_collections_objects_select_own on storage.objects;
drop policy if exists sync_collections_objects_insert_own on storage.objects;
drop policy if exists sync_collections_objects_update_own on storage.objects;
drop policy if exists sync_collections_objects_delete_own on storage.objects;

create policy sync_collections_objects_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'sync-collections'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy sync_collections_objects_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'sync-collections'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy sync_collections_objects_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'sync-collections'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'sync-collections'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy sync_collections_objects_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'sync-collections'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

select pg_notify('pgrst', 'reload schema');

commit;
