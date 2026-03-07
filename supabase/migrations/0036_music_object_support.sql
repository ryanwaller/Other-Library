alter table public.user_books
  add column if not exists source_type text,
  add column if not exists source_url text,
  add column if not exists external_source_ids jsonb,
  add column if not exists music_metadata jsonb;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.book_entities'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role in (%'
  loop
    execute format('alter table public.book_entities drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table if exists public.book_entities
  drop constraint if exists book_entities_role_check;

alter table public.book_entities
  add constraint book_entities_role_check check (
    role in (
      'author',
      'editor',
      'designer',
      'subject',
      'tag',
      'category',
      'material',
      'printer',
      'publisher',
      'performer',
      'composer',
      'producer',
      'engineer',
      'mastering',
      'featured artist',
      'arranger',
      'conductor',
      'orchestra',
      'artwork',
      'design',
      'photography'
    )
  );

create or replace function public.set_book_entities(p_user_book_id bigint, p_role text, p_names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  owner uuid;
  catalog bigint;
  can_edit boolean;
  cleaned text[];
  n text;
  idx integer;
  ent_id uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select ub.owner_id, ub.library_id
    into owner, catalog
  from public.user_books ub
  where ub.id = p_user_book_id;

  if owner is null then
    raise exception 'not_found';
  end if;

  can_edit := owner = uid
    or exists (
      select 1
      from public.catalog_members cm
      where cm.catalog_id = catalog
        and cm.user_id = uid
        and cm.accepted_at is not null
        and cm.role in ('owner', 'editor')
    );
  if not can_edit then
    raise exception 'forbidden';
  end if;

  if p_role is null or trim(p_role) = '' then
    raise exception 'invalid_role';
  end if;

  p_role := lower(trim(p_role));
  if p_role not in (
    'author',
    'editor',
    'designer',
    'subject',
    'tag',
    'category',
    'material',
    'printer',
    'publisher',
    'performer',
    'composer',
    'producer',
    'engineer',
    'mastering',
    'featured artist',
    'arranger',
    'conductor',
    'orchestra',
    'artwork',
    'design',
    'photography'
  ) then
    raise exception 'invalid_role';
  end if;

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
