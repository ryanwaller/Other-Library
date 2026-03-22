do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'user_books'
      and tc.constraint_type = 'CHECK'
      and tc.constraint_name = 'user_books_status_check'
  ) then
    alter table public.user_books
      drop constraint user_books_status_check;
  end if;
end $$;

alter table public.user_books
  add constraint user_books_status_check
  check (status in ('owned', 'loaned', 'selling', 'trading', 'wishlist'));

update public.user_books
set status = 'wishlist'
where collection_state = 'wanted'
  and coalesce(status, '') <> 'wishlist';
