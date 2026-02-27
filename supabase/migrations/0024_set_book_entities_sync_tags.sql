-- Keep legacy tag tables in sync when using the new entity join system for roles tag/category.
-- Safe to run multiple times.

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
  tag_id bigint;
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

  p_role := lower(trim(p_role));
  if p_role not in (
    'author','editor','designer','subject','tag','category','material','printer','publisher'
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

  -- Legacy sync for UI/features still using tags + user_book_tags.
  if p_role in ('tag', 'category') then
    -- Remove existing tags of this kind for the book.
    delete from public.user_book_tags ubt
    using public.tags t
    where ubt.user_book_id = p_user_book_id
      and ubt.tag_id = t.id
      and t.owner_id = owner
      and t.kind = p_role;

    -- Upsert tags and attach.
    foreach n in array cleaned loop
      insert into public.tags (owner_id, name, kind)
      values (owner, n, p_role)
      on conflict (owner_id, name, kind) do update set name = excluded.name
      returning id into tag_id;

      insert into public.user_book_tags (user_book_id, tag_id)
      values (p_user_book_id, tag_id)
      on conflict do nothing;
    end loop;
  end if;
end;
$$;

