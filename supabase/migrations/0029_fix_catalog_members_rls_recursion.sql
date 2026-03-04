-- Fix infinite recursion in catalog_members RLS.
--
-- Three recursion chains existed:
-- 1. catalog_members policy self-referenced catalog_members directly
-- 2. libraries -> catalog_members -> catalog_members_select_members -> libraries (cycle)
-- 3. user_books -> catalog_members -> catalog_members_select_members -> libraries
--    -> libraries_select_viewable -> user_books (cycle)
--
-- Fix: use two SECURITY DEFINER functions that bypass RLS when they query
-- their respective tables, breaking all cycles.

create or replace function public.is_catalog_member(p_catalog_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  SELECT EXISTS (
    SELECT 1 FROM catalog_members
    WHERE catalog_id = p_catalog_id
      AND user_id = auth.uid()
      AND accepted_at IS NOT NULL
  );
$$;

create or replace function public.is_catalog_owner(p_catalog_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  SELECT EXISTS (
    SELECT 1 FROM libraries
    WHERE id = p_catalog_id
      AND owner_id = auth.uid()
  );
$$;

-- Drop old recursive policies (idempotent).
drop policy if exists "catalog_members_select_catalog_members" on public.catalog_members;
drop policy if exists "catalog_members_select_members" on public.catalog_members;

-- New policy: both checks go through SECURITY DEFINER functions,
-- so neither triggers RLS on the table being accessed.
create policy "catalog_members_select_members"
on public.catalog_members
for select
to authenticated
using (
  is_catalog_owner(catalog_id)
  OR is_catalog_member(catalog_id)
);
