-- Public follow counts + (optionally restricted) follower/following lists.
-- Used for public profile pages (/u/:username) so they can show counts and
-- let viewers browse follower/following pages.
--
-- Safe to run multiple times.

-- Counts (visible whenever the profile itself is viewable).
create or replace function public.get_follow_counts(target_username text)
returns table (followers_count bigint, following_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select p.id
    from public.profiles p
    where p.username = public.normalize_username(target_username)
    limit 1
  )
  select
    case
      when exists (select 1 from target t where public.can_view_profile(t.id)) then
        (select count(*) from public.follows f join target t on f.followee_id = t.id where f.status = 'approved')
      else null
    end as followers_count,
    case
      when exists (select 1 from target t where public.can_view_profile(t.id)) then
        (select count(*) from public.follows f join target t on f.follower_id = t.id where f.status = 'approved')
      else null
    end as following_count;
$$;

grant execute on function public.get_follow_counts(text) to anon, authenticated;

-- Lists (more restricted than profile view):
-- - Owner can always view
-- - Approved followers can view
-- - Public profiles can view
create or replace function public.can_view_follow_list(target uuid)
returns boolean
language sql
stable
as $$
  select
    (auth.uid() = target)
    or public.is_public_profile(target)
    or (auth.uid() is not null and public.is_approved_follower(auth.uid(), target));
$$;

create or replace function public.get_followers(target_username text, page_limit int default 200, page_offset int default 0)
returns table (id uuid, username text, display_name text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select p.id
    from public.profiles p
    where p.username = public.normalize_username(target_username)
    limit 1
  )
  select p.id, p.username, p.display_name, p.avatar_path
  from public.follows f
  join target t on t.id = f.followee_id
  join public.profiles p on p.id = f.follower_id
  where f.status = 'approved'
    and public.can_view_follow_list(t.id)
  order by f.updated_at desc
  limit greatest(1, least(page_limit, 500))
  offset greatest(page_offset, 0);
$$;

grant execute on function public.get_followers(text, int, int) to anon, authenticated;

create or replace function public.get_following(target_username text, page_limit int default 200, page_offset int default 0)
returns table (id uuid, username text, display_name text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select p.id
    from public.profiles p
    where p.username = public.normalize_username(target_username)
    limit 1
  )
  select p.id, p.username, p.display_name, p.avatar_path
  from public.follows f
  join target t on t.id = f.follower_id
  join public.profiles p on p.id = f.followee_id
  where f.status = 'approved'
    and public.can_view_follow_list(t.id)
  order by f.updated_at desc
  limit greatest(1, least(page_limit, 500))
  offset greatest(page_offset, 0);
$$;

grant execute on function public.get_following(text, int, int) to anon, authenticated;

