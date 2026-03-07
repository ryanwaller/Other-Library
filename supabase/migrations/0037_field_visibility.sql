alter table public.user_books
add column if not exists field_visibility jsonb not null default '{}'::jsonb;

alter table public.book_entities
add column if not exists visibility boolean not null default true;

-- Update set_book_entities to support visibility if needed, 
-- but for now we can just allow updating it via a separate mechanism or enhance this RPC.
-- Actually, the request says "Users should be able to toggle visibility on or off before saving."
-- This implies the save operation (which uses set_book_entities for some fields) should handle it.

create or replace function public.set_book_entities_v2(
  p_user_book_id bigint, 
  p_role text, 
  p_names text[],
  p_visibility boolean[] default null
)
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
  cleaned_visibility boolean[];
  n text;
  v boolean;
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
    'art direction',
    'artwork',
    'design',
    'photography'
  ) then
    raise exception 'invalid_role';
  end if;

  cleaned := array[]::text[];
  cleaned_visibility := array[]::boolean[];
  for i in 1 .. coalesce(array_length(p_names, 1), 0) loop
    n := regexp_replace(trim(coalesce(p_names[i], '')), '\s+', ' ', 'g');
    if n = '' then
      continue;
    end if;
    v := coalesce(p_visibility[i], true);
    if not exists (select 1 from unnest(cleaned) x where lower(x) = lower(n)) then
      cleaned := cleaned || n;
      cleaned_visibility := cleaned_visibility || v;
    end if;
  end loop;

  delete from public.book_entities
  where user_book_id = p_user_book_id
    and role = p_role;

  for i in 1 .. coalesce(array_length(cleaned, 1), 0) loop
    ent_id := public.ensure_entity(cleaned[i]);
    insert into public.book_entities (user_book_id, entity_id, role, position, visibility)
    values (p_user_book_id, ent_id, p_role, i, cleaned_visibility[i])
    on conflict (user_book_id, entity_id, role) do update 
    set position = excluded.position,
        visibility = excluded.visibility;
  end loop;
end;
$$;

-- Update RLS for book_entities to respect field-level visibility
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
      and (
        book_entities.visibility = true
        or ub.owner_id = auth.uid()
        or exists (
          select 1
          from public.catalog_members cm
          where cm.catalog_id = ub.library_id
            and cm.user_id = auth.uid()
            and cm.accepted_at is not null
            and cm.role in ('owner', 'editor')
        )
      )
  )
);
