-- Follow requests must be approved by the followee.
-- Also allow both participants to see each other's basic profile row so follow UIs can display usernames.

-- Prevent self-approval on INSERT (followers must always create pending requests).
drop policy if exists "follows_insert_self" on public.follows;
create policy "follows_insert_self"
on public.follows
for insert
with check (auth.uid() = follower_id and status = 'pending');

-- Allow viewing a profile if there's any follow relationship in either direction.
create or replace function public.can_view_profile(target uuid)
returns boolean
language sql
stable
as $$
  select
    (auth.uid() = target)
    or public.is_public_profile(target)
    or (auth.uid() is not null and public.is_approved_follower(auth.uid(), target))
    or public.has_public_books(target)
    or (
      auth.uid() is not null
      and exists (
        select 1
        from public.follows f
        where (f.follower_id = auth.uid() and f.followee_id = target)
           or (f.followee_id = auth.uid() and f.follower_id = target)
      )
    );
$$;

