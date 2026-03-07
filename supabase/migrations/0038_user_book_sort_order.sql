-- Add sort_order column to user_books for custom catalog ordering
alter table public.user_books
add column if not exists sort_order double precision not null default 0;

create index if not exists user_books_library_id_sort_order_idx on public.user_books (library_id, sort_order);

-- Initialize sort_order for existing items based on created_at to preserve current "Custom" behavior (which was likely latest-first or earliest-first)
-- Actually, the prompt says "Custom" should be a new sort type. 
-- Let's initialize them with a gap of 1000 to allow plenty of room for insertions.
with numbered as (
  select id, row_number() over (partition by library_id order by created_at asc) as rn
  from public.user_books
)
update public.user_books ub
set sort_order = numbered.rn * 1000
from numbered
where ub.id = numbered.id;
