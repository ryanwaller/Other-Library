-- Search for visible books (your catalog first, then followees, then 2nd-degree/public).
-- Safe to run multiple times.

create or replace function public.search_visible_user_books(query_text text, max_results int default 50)
returns table (
  user_book_id bigint,
  owner_id uuid,
  owner_username text,
  title text,
  authors text[],
  isbn13 text,
  publisher text,
  relationship text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select trim(coalesce(query_text, '')) as q
  ),
  norm as (
    select regexp_replace((select q from q), '[^0-9Xx]', '', 'g') as isbn
  )
  select
    ub.id as user_book_id,
    ub.owner_id,
    p.username as owner_username,
    coalesce(nullif(trim(ub.title_override), ''), e.title, '(untitled)') as title,
    coalesce(
      case when ub.authors_override is not null and array_length(ub.authors_override, 1) > 0 then ub.authors_override else null end,
      e.authors,
      '{}'::text[]
    ) as authors,
    e.isbn13,
    coalesce(nullif(trim(ub.publisher_override), ''), e.publisher, '') as publisher,
    case
      when auth.uid() is not null and ub.owner_id = auth.uid() then 'you'
      when auth.uid() is not null and exists (
        select 1
        from public.follows f
        where f.follower_id = auth.uid()
          and f.followee_id = ub.owner_id
          and f.status = 'approved'
      ) then 'following'
      when auth.uid() is not null and exists (
        select 1
        from public.follows f1
        join public.follows f2
          on f2.follower_id = f1.followee_id
        where f1.follower_id = auth.uid()
          and f1.status = 'approved'
          and f2.followee_id = ub.owner_id
          and f2.status = 'approved'
      ) then '2nd_degree'
      else 'public'
    end as relationship
  from public.user_books ub
  join public.profiles p on p.id = ub.owner_id
  left join public.editions e on e.id = ub.edition_id
  where
    (select q from q) <> ''
    and public.can_view_user_book(ub)
    and (
      coalesce(nullif(trim(ub.title_override), ''), e.title, '') ilike ('%' || (select q from q) || '%')
      or coalesce(nullif(trim(ub.publisher_override), ''), e.publisher, '') ilike ('%' || (select q from q) || '%')
      or exists (
        select 1
        from unnest(coalesce(
          case when ub.authors_override is not null and array_length(ub.authors_override, 1) > 0 then ub.authors_override else null end,
          e.authors,
          '{}'::text[]
        )) a
        where a ilike ('%' || (select q from q) || '%')
      )
      or (
        (select isbn from norm) <> ''
        and (
          e.isbn13 = (select isbn from norm)
          or e.isbn10 = (select isbn from norm)
        )
      )
      or exists (
        select 1
        from public.user_book_tags ubt
        join public.tags t on t.id = ubt.tag_id
        where ubt.user_book_id = ub.id
          and t.kind = 'tag'
          and t.name ilike ('%' || (select q from q) || '%')
      )
      or exists (
        select 1
        from unnest(coalesce(ub.subjects_override, e.subjects, '{}'::text[])) s
        where s ilike ('%' || (select q from q) || '%')
      )
    )
  order by
    case
      when auth.uid() is not null and ub.owner_id = auth.uid() then 0
      when auth.uid() is not null and exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid()
          and f.followee_id = ub.owner_id
          and f.status = 'approved'
      ) then 1
      else 2
    end,
    ub.created_at desc
  limit greatest(1, least(coalesce(max_results, 50), 200));
$$;

