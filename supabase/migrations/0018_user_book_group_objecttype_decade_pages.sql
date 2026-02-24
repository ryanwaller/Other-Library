-- Additional OM taxonomy fields on user_books (group + object type + decade + pages)
-- Safe to run multiple times.

alter table public.user_books
  add column if not exists group_label text;

alter table public.user_books
  add column if not exists object_type text;

alter table public.user_books
  add column if not exists decade text;

alter table public.user_books
  add column if not exists pages integer;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'user_books'
      and tc.constraint_type = 'CHECK'
      and tc.constraint_name = 'user_books_object_type_check'
  ) then
    alter table public.user_books
      add constraint user_books_object_type_check check (
        object_type is null or object_type in ('book', 'magazine', 'ephemera', 'video', 'music')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'user_books'
      and tc.constraint_type = 'CHECK'
      and tc.constraint_name = 'user_books_decade_check'
  ) then
    alter table public.user_books
      add constraint user_books_decade_check check (
        decade is null or decade in ('prewar', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'user_books'
      and tc.constraint_type = 'CHECK'
      and tc.constraint_name = 'user_books_pages_check'
  ) then
    alter table public.user_books
      add constraint user_books_pages_check check (
        pages is null or (pages >= 1 and pages <= 20000)
      );
  end if;
end $$;

