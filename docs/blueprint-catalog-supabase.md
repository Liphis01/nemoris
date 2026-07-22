# Catalogue Blueprints Supabase

Ce catalogue alimente le menu **Blueprints > Importer**. L'application locale
interroge Supabase via son backend local, puis importe les ZIP avec les routes
Blueprints existantes.

## 1. Créer le projet

1. Ouvre Supabase et crée un projet.
2. Dans **Project Settings > API**, copie :
   - l'URL du projet, par exemple `https://xxxx.supabase.co`
   - la clé publishable/anon publique.
3. Dans l'app, colle ces deux valeurs dans **Paramètres > Blueprints**.

N'utilise jamais la `service_role key` dans l'application.

## 2. Créer la table et la recherche

Dans **SQL Editor**, colle puis exécute ce script.

```sql
create table if not exists public.blueprint_catalog (
  id bigint generated always as identity primary key,
  blueprint_guid text not null unique,
  name text not null,
  description text not null default '',
  type_group text not null default 'text',
  question_count integer not null default 0,
  version integer not null default 1,
  size_bytes bigint,
  license text not null default '',
  tags text[] not null default '{}',
  themes text[] not null default '{}',
  download_count integer not null default 0,
  featured boolean not null default false,
  pinned boolean not null default false,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  storage_path text not null,
  is_public boolean not null default false,
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(license, '')), 'C') ||
    setweight(to_tsvector('simple', array_to_string(tags, ' ')), 'B') ||
    setweight(to_tsvector('simple', array_to_string(themes, ' ')), 'B')
  ) stored
);

create index if not exists blueprint_catalog_public_idx
  on public.blueprint_catalog (is_public, featured, download_count desc, updated_at desc);

create index if not exists blueprint_catalog_search_idx
  on public.blueprint_catalog using gin(search_vector);

create index if not exists blueprint_catalog_themes_idx
  on public.blueprint_catalog using gin(themes);

alter table public.blueprint_catalog enable row level security;

drop policy if exists "Public blueprints are readable" on public.blueprint_catalog;
create policy "Public blueprints are readable"
  on public.blueprint_catalog
  for select
  using (is_public = true);

create or replace function public.search_blueprint_catalog(
  p_query text default '',
  p_theme text default '',
  p_type_group text default '',
  p_status text default 'all',
  p_sort text default 'pertinence',
  p_limit integer default 24,
  p_cursor integer default 0,
  p_installed_versions jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
as $$
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
      when params.installed ? b.blueprint_guid
        then (params.installed ->> b.blueprint_guid)::integer
      else null
    end as installed_version,
    case
      when params.installed ? b.blueprint_guid
        and (params.installed ->> b.blueprint_guid)::integer < b.version
        then 'update_available'
      when params.installed ? b.blueprint_guid
        then 'up_to_date'
      else 'not_installed'
    end as install_status,
    case
      when params.query_text is null then 0
      else ts_rank(b.search_vector, websearch_to_tsquery('simple', params.query_text))
    end as rank
  from public.blueprint_catalog b
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
theme_rows as (
  select
    unnest(themes) as theme,
    count(*) as result_count,
    sum(download_count) as download_count,
    bool_or(featured) as featured,
    bool_or(pinned) as pinned
  from filtered
  group by theme
)
select jsonb_build_object(
  'blueprints',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'blueprint_guid', blueprint_guid,
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
        'storage_path', storage_path
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
$$;
```

## 3. Créer le bucket ZIP

1. Va dans **Storage**.
2. Crée un bucket nommé `blueprint-zips`.
3. Mets-le en public pour cette première version.
4. Upload un fichier ZIP, par exemple `world/countries-v1.zip`.
5. Ajoute une ligne dans `blueprint_catalog` avec le même `storage_path`.

Exemple minimal :

```sql
insert into public.blueprint_catalog (
  blueprint_guid,
  name,
  description,
  type_group,
  question_count,
  version,
  size_bytes,
  license,
  tags,
  themes,
  download_count,
  featured,
  pinned,
  storage_path,
  is_public
) values (
  'world-countries',
  'Pays du monde',
  'Carte interactive des pays.',
  'map',
  252,
  1,
  72420,
  'CC0',
  array['pays', 'monde'],
  array['géographie', 'cartes'],
  0,
  true,
  true,
  'world/countries-v1.zip',
  true
);
```
