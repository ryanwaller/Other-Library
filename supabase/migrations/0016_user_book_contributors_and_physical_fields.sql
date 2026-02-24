-- More per-user metadata overrides on user_books (contributors + physical/edition details)
-- Safe to run multiple times.

alter table public.user_books
add column if not exists editors_override text[];

alter table public.user_books
add column if not exists designers_override text[];

alter table public.user_books
add column if not exists printer_override text;

alter table public.user_books
add column if not exists materials_override text;

alter table public.user_books
add column if not exists edition_override text;

