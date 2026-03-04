-- Add sort_order column to libraries so catalogs can be manually reordered.
-- The app already queries this column with a graceful fallback if it's absent,
-- but adding it here eliminates the per-request error and fallback overhead.

alter table public.libraries
  add column if not exists sort_order integer;
