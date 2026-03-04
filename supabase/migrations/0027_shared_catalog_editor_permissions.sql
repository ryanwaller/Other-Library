-- Shared-catalog editor hardening:
-- 1) remove viewer role
-- 2) ensure accepted members can see shared catalogs on homepage
-- 3) allow editors to read/update/delete books and related media in shared catalogs
-- 4) allow editors to run set_book_entities for shared-catalog books

-- Promote any legacy viewer memberships.
update public.catalog_members
set role = 'editor'
where role = 'viewer';

-- Restrict roles to owner/editor only.
alter table public.catalog_members
  drop constraint if exists catalog_members_role_check;

alter table public.catalog_members
  add constraint catalog_members_role_check
  check (role in ('owner', 'editor'));

-- Libraries: members can always select catalogs they belong to (including empty catalogs).
drop policy if exists "libraries_select_shared_member" on public.libraries;
create policy "libraries_select_shared_member"
on public.libraries
for select
to authenticated
using (
  exists (
    select 1
    from public.catalog_members cm
    where cm.catalog_id = libraries.id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
  )
);

-- user_books: accepted members can read all books in shared catalogs.
drop policy if exists "user_books_select_shared_member" on public.user_books;
create policy "user_books_select_shared_member"
on public.user_books
for select
to authenticated
using (
  exists (
    select 1
    from public.catalog_members cm
    where cm.catalog_id = user_books.library_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
  )
);

-- user_books: editors/owners can insert into shared catalogs.
drop policy if exists "user_books_insert_shared_editor" on public.user_books;
create policy "user_books_insert_shared_editor"
on public.user_books
for insert
to authenticated
with check (
  auth.uid() = owner_id
  and exists (
    select 1
    from public.catalog_members cm
    where cm.catalog_id = user_books.library_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
      and cm.role in ('owner', 'editor')
  )
);

-- user_books: editors/owners can update any book in shared catalogs they can edit.
drop policy if exists "user_books_update_shared_editor" on public.user_books;
create policy "user_books_update_shared_editor"
on public.user_books
for update
to authenticated
using (
  exists (
    select 1
    from public.catalog_members cm
    where cm.catalog_id = user_books.library_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
      and cm.role in ('owner', 'editor')
  )
)
with check (
  exists (
    select 1
    from public.catalog_members cm
    where cm.catalog_id = user_books.library_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
      and cm.role in ('owner', 'editor')
  )
);

-- user_books: editors/owners can delete any book in shared catalogs they can edit.
drop policy if exists "user_books_delete_shared_editor" on public.user_books;
create policy "user_books_delete_shared_editor"
on public.user_books
for delete
to authenticated
using (
  exists (
    select 1
    from public.catalog_members cm
    where cm.catalog_id = user_books.library_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
      and cm.role in ('owner', 'editor')
  )
);

-- user_book_media: members can view media for shared-catalog books.
drop policy if exists "user_book_media_select_shared_member" on public.user_book_media;
create policy "user_book_media_select_shared_member"
on public.user_book_media
for select
to authenticated
using (
  exists (
    select 1
    from public.user_books ub
    join public.catalog_members cm on cm.catalog_id = ub.library_id
    where ub.id = user_book_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
  )
);

-- user_book_media: editors/owners can create/update/delete media on shared-catalog books.
drop policy if exists "user_book_media_insert_shared_editor" on public.user_book_media;
create policy "user_book_media_insert_shared_editor"
on public.user_book_media
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_books ub
    join public.catalog_members cm on cm.catalog_id = ub.library_id
    where ub.id = user_book_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
      and cm.role in ('owner', 'editor')
  )
);

drop policy if exists "user_book_media_update_shared_editor" on public.user_book_media;
create policy "user_book_media_update_shared_editor"
on public.user_book_media
for update
to authenticated
using (
  exists (
    select 1
    from public.user_books ub
    join public.catalog_members cm on cm.catalog_id = ub.library_id
    where ub.id = user_book_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
      and cm.role in ('owner', 'editor')
  )
)
with check (
  exists (
    select 1
    from public.user_books ub
    join public.catalog_members cm on cm.catalog_id = ub.library_id
    where ub.id = user_book_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
      and cm.role in ('owner', 'editor')
  )
);

drop policy if exists "user_book_media_delete_shared_editor" on public.user_book_media;
create policy "user_book_media_delete_shared_editor"
on public.user_book_media
for delete
to authenticated
using (
  exists (
    select 1
    from public.user_books ub
    join public.catalog_members cm on cm.catalog_id = ub.library_id
    where ub.id = user_book_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
      and cm.role in ('owner', 'editor')
  )
);

-- Entity sync RPC: allow owner/editor membership, not only row owner.
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
  if p_role not in ('author','editor','designer','subject','tag','category','material','printer','publisher') then
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
