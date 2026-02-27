-- Entity + join system for linkable facet fields (authors/editors/designers/subjects/tags/categories/materials/printer/publisher)
-- Safe to run multiple times.

-- Ensure uuid generation is available.
create extension if not exists pgcrypto;

-- -----------------------
-- entities
-- -----------------------
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

alter table public.entities enable row level security;

drop policy if exists "entities_select_all" on public.entities;
create policy "entities_select_all"
on public.entities
for select
using (true);

-- No direct client writes for now (writes happen via SECURITY DEFINER RPC below).

-- -----------------------
-- book_entities (joins)
-- -----------------------
create table if not exists public.book_entities (
  user_book_id bigint not null references public.user_books (id) on delete cascade,
  entity_id uuid not null references public.entities (id) on delete restrict,
  role text not null check (
    role in (
      'author',
      'editor',
      'designer',
      'subject',
      'tag',
      'category',
      'material',
      'printer',
      'publisher'
    )
  ),
  position integer,
  created_at timestamptz not null default now(),
  primary key (user_book_id, entity_id, role)
);

create index if not exists book_entities_user_book_role_idx on public.book_entities (user_book_id, role);
create index if not exists book_entities_entity_role_idx on public.book_entities (entity_id, role);

alter table public.book_entities enable row level security;

drop policy if exists "book_entities_select_visible" on public.book_entities;
create policy "book_entities_select_visible"
on public.book_entities
for select
using (
  exists (
    select 1
    from public.user_books ub
    where ub.id = book_entities.user_book_id
      and public.can_view_user_book(ub)
  )
);

drop policy if exists "book_entities_insert_owner" on public.book_entities;
create policy "book_entities_insert_owner"
on public.book_entities
for insert
with check (
  exists (
    select 1
    from public.user_books ub
    where ub.id = book_entities.user_book_id
      and auth.uid() = ub.owner_id
  )
);

drop policy if exists "book_entities_delete_owner" on public.book_entities;
create policy "book_entities_delete_owner"
on public.book_entities
for delete
using (
  exists (
    select 1
    from public.user_books ub
    where ub.id = book_entities.user_book_id
      and auth.uid() = ub.owner_id
  )
);

-- -----------------------
-- Slug + upsert helpers
-- -----------------------
create or replace function public.slugify_entity_name(input text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)',
    '',
    'g'
  );
$$;

create or replace function public.make_entity_slug(name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  existing_id uuid;
  existing_name text;
begin
  base := public.slugify_entity_name(name);
  if base is null or length(base) = 0 then
    base := substr(md5(coalesce(name, '')), 1, 12);
  end if;

  select e.id, e.name into existing_id, existing_name
  from public.entities e
  where e.slug = base
  limit 1;

  if existing_id is null then
    return base;
  end if;

  if lower(trim(existing_name)) = lower(trim(coalesce(name, ''))) then
    return base;
  end if;

  return base || '-' || substr(md5(coalesce(name, '')), 1, 6);
end;
$$;

create or replace function public.ensure_entity(name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  norm_name text;
  v_slug text;
  existing uuid;
  new_id uuid;
begin
  norm_name := trim(coalesce(name, ''));
  if norm_name = '' then
    raise exception 'invalid_entity_name';
  end if;

  -- Prefer matching by normalized name (case-insensitive).
  select e.id into existing
  from public.entities e
  where lower(trim(e.name)) = lower(norm_name)
  limit 1;

  if existing is not null then
    return existing;
  end if;

  v_slug := public.make_entity_slug(norm_name);

  insert into public.entities (name, slug)
  values (norm_name, v_slug)
  on conflict (slug) do update set name = excluded.name
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.set_book_entities(p_user_book_id bigint, p_role text, p_names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  owner uuid;
  cleaned text[];
  n text;
  idx integer;
  ent_id uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select ub.owner_id into owner
  from public.user_books ub
  where ub.id = p_user_book_id;

  if owner is null then
    raise exception 'not_found';
  end if;

  if owner <> uid then
    raise exception 'forbidden';
  end if;

  if p_role is null or trim(p_role) = '' then
    raise exception 'invalid_role';
  end if;

  -- Normalize role input to lowercase.
  p_role := lower(trim(p_role));

  if p_role not in (
    'author','editor','designer','subject','tag','category','material','printer','publisher'
  ) then
    raise exception 'invalid_role';
  end if;

  -- Normalize names: trim, collapse whitespace, drop empty, preserve order, de-dupe (case-insensitive).
  cleaned := array[]::text[];
  foreach n in array coalesce(p_names, array[]::text[]) loop
    n := regexp_replace(trim(coalesce(n, '')), '\\s+', ' ', 'g');
    if n = '' then
      continue;
    end if;
    if not exists (select 1 from unnest(cleaned) x where lower(x) = lower(n)) then
      cleaned := cleaned || n;
    end if;
  end loop;

  delete from public.book_entities
  where user_book_id = p_user_book_id
    and role = p_role;

  idx := 0;
  foreach n in array cleaned loop
    idx := idx + 1;
    ent_id := public.ensure_entity(n);
    insert into public.book_entities (user_book_id, entity_id, role, position)
    values (p_user_book_id, ent_id, p_role, idx)
    on conflict do nothing;
  end loop;
end;
$$;

-- Helper for autocomplete (role-scoped) – returns entities already used in the requested role, ordered by popularity among visible books.
create or replace function public.search_entities(p_role text, p_q text, p_limit integer default 10)
returns table (id uuid, name text, slug text, uses bigint)
language sql
stable
as $$
  with params as (
    select
      lower(trim(coalesce(p_role, ''))) as role,
      lower(trim(coalesce(p_q, ''))) as q,
      greatest(1, least(coalesce(p_limit, 10), 50)) as lim
  )
  select
    e.id,
    e.name,
    e.slug,
    count(*) as uses
  from params p
  join public.book_entities be
    on be.role = p.role
  join public.entities e
    on e.id = be.entity_id
  where p.q = '' or lower(e.name) like ('%' || p.q || '%')
  group by e.id, e.name, e.slug
  order by uses desc, e.name asc
  limit (select lim from params);
$$;

-- -----------------------
-- Backfill from existing fields (best-effort)
-- -----------------------

-- Authors: prefer authors_override, else editions.authors
insert into public.book_entities (user_book_id, entity_id, role, position)
select
  ub.id,
  public.ensure_entity(a.name),
  'author',
  a.ord::int
from public.user_books ub
left join public.editions e on e.id = ub.edition_id
cross join lateral unnest(coalesce(ub.authors_override, e.authors, '{}'::text[])) with ordinality as a(name, ord)
where trim(coalesce(a.name, '')) <> ''
on conflict do nothing;

-- Editors
insert into public.book_entities (user_book_id, entity_id, role, position)
select
  ub.id,
  public.ensure_entity(a.name),
  'editor',
  a.ord::int
from public.user_books ub
cross join lateral unnest(coalesce(ub.editors_override, '{}'::text[])) with ordinality as a(name, ord)
where trim(coalesce(a.name, '')) <> ''
on conflict do nothing;

-- Designers
insert into public.book_entities (user_book_id, entity_id, role, position)
select
  ub.id,
  public.ensure_entity(a.name),
  'designer',
  a.ord::int
from public.user_books ub
cross join lateral unnest(coalesce(ub.designers_override, '{}'::text[])) with ordinality as a(name, ord)
where trim(coalesce(a.name, '')) <> ''
on conflict do nothing;

-- Subjects: prefer subjects_override, else editions.subjects
insert into public.book_entities (user_book_id, entity_id, role, position)
select
  ub.id,
  public.ensure_entity(s.name),
  'subject',
  s.ord::int
from public.user_books ub
left join public.editions e on e.id = ub.edition_id
cross join lateral unnest(coalesce(ub.subjects_override, e.subjects, '{}'::text[])) with ordinality as s(name, ord)
where trim(coalesce(s.name, '')) <> ''
on conflict do nothing;

-- Publisher: prefer publisher_override, else editions.publisher
insert into public.book_entities (user_book_id, entity_id, role, position)
select
  ub.id,
  public.ensure_entity(coalesce(ub.publisher_override, e.publisher)),
  'publisher',
  1
from public.user_books ub
left join public.editions e on e.id = ub.edition_id
where trim(coalesce(coalesce(ub.publisher_override, e.publisher), '')) <> ''
on conflict do nothing;

-- Printer
insert into public.book_entities (user_book_id, entity_id, role, position)
select
  ub.id,
  public.ensure_entity(ub.printer_override),
  'printer',
  1
from public.user_books ub
where trim(coalesce(ub.printer_override, '')) <> ''
on conflict do nothing;

-- Materials
insert into public.book_entities (user_book_id, entity_id, role, position)
select
  ub.id,
  public.ensure_entity(ub.materials_override),
  'material',
  1
from public.user_books ub
where trim(coalesce(ub.materials_override, '')) <> ''
on conflict do nothing;

-- Tags + categories from existing tag tables
insert into public.book_entities (user_book_id, entity_id, role, position)
select
  ubt.user_book_id,
  public.ensure_entity(t.name),
  case when t.kind = 'category' then 'category' else 'tag' end as role,
  row_number() over (partition by ubt.user_book_id, t.kind order by t.name) as position
from public.user_book_tags ubt
join public.tags t on t.id = ubt.tag_id
where trim(coalesce(t.name, '')) <> ''
on conflict do nothing;
