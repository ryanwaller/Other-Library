-- Allow selecting libraries ("catalogs") when the viewer can see at least one
-- book in that library. This enables public profile pages to group books by
-- library name while keeping empty/private libraries hidden.
--
-- Safe to run multiple times.

alter table public.libraries enable row level security;

drop policy if exists "libraries_select_viewable" on public.libraries;
drop policy if exists "libraries_select_owner" on public.libraries;

create policy "libraries_select_viewable"
on public.libraries
for select
using (
  auth.uid() = owner_id
  or exists (
    select 1
    from public.user_books ub
    where ub.library_id = libraries.id
  )
);

