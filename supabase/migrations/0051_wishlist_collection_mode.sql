alter table public.libraries
  add column if not exists kind text;

update public.libraries
set kind = 'catalog'
where kind is null;

alter table public.libraries
  alter column kind set default 'catalog';

alter table public.libraries
  alter column kind set not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'libraries'
      and tc.constraint_name = 'libraries_kind_check'
  ) then
    alter table public.libraries
      add constraint libraries_kind_check
      check (kind in ('catalog', 'wishlist'));
  end if;
end $$;

create index if not exists libraries_owner_kind_idx
  on public.libraries (owner_id, kind);

create unique index if not exists libraries_one_wishlist_per_owner_idx
  on public.libraries (owner_id)
  where kind = 'wishlist';

alter table public.user_books
  add column if not exists collection_state text;

update public.user_books
set collection_state = 'owned'
where collection_state is null;

alter table public.user_books
  alter column collection_state set default 'owned';

alter table public.user_books
  alter column collection_state set not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'user_books'
      and tc.constraint_name = 'user_books_collection_state_check'
  ) then
    alter table public.user_books
      add constraint user_books_collection_state_check
      check (collection_state in ('owned', 'wanted'));
  end if;
end $$;

create index if not exists user_books_owner_collection_state_idx
  on public.user_books (owner_id, collection_state, created_at desc);

create index if not exists user_books_edition_collection_state_idx
  on public.user_books (edition_id, collection_state)
  where edition_id is not null;
