-- Fix infinite recursion in catalog_members RLS.
--
-- The original "catalog_members_select_catalog_members" policy queried
-- catalog_members from within a policy on catalog_members, causing Postgres to
-- recurse infinitely on every row access.
--
-- Fix: replace it with a SECURITY DEFINER function (is_catalog_member) that
-- bypasses RLS when it queries catalog_members, breaking the cycle.
-- The new policy also folds in owner-of-catalog access so owners can always
-- see all membership rows for their catalogs.

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

-- Drop the old recursive policy and the replaced policy (idempotent).
drop policy if exists "catalog_members_select_catalog_members" on public.catalog_members;
drop policy if exists "catalog_members_select_members" on public.catalog_members;

-- New policy: owners can see all rows for their catalog; accepted members can
-- see all rows for catalogs they belong to (via the SECURITY DEFINER bypass).
create policy "catalog_members_select_members"
on public.catalog_members
for select
to authenticated
using (
  (EXISTS (
    SELECT 1 FROM public.libraries l
    WHERE l.id = catalog_members.catalog_id
      AND l.owner_id = auth.uid()
  ))
  OR is_catalog_member(catalog_id)
);
