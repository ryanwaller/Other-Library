-- Per-user metadata overrides on user_books
-- Safe to run multiple times.

alter table public.user_books
add column if not exists publisher_override text;

alter table public.user_books
add column if not exists publish_date_override date;

alter table public.user_books
add column if not exists description_override text;

alter table public.user_books
add column if not exists subjects_override text[];

