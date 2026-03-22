alter table public.user_books
  add column if not exists saved_from_user_id uuid references public.profiles(id) on delete set null;

create index if not exists user_books_saved_from_user_id_idx
  on public.user_books (saved_from_user_id)
  where saved_from_user_id is not null;
