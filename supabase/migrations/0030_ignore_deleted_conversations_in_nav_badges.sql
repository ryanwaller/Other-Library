-- Exclude deleted conversations and delete-notice-only updates from nav unread badges.

create or replace function public.unread_borrow_threads_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with unread as (
    select br.id
    from public.borrow_requests br
    left join public.borrow_request_reads r
      on r.borrow_request_id = br.id
     and r.user_id = auth.uid()
    left join public.borrow_request_deleted_for d
      on d.borrow_request_id = br.id
     and d.user_id = auth.uid()
    where auth.uid() is not null
      and br.kind = 'borrow'
      and (br.owner_id = auth.uid() or br.requester_id = auth.uid())
      and d.borrow_request_id is null
      and (r.last_read_at is null or br.updated_at > r.last_read_at)
      and exists (
        select 1
        from public.borrow_request_messages m
        where m.borrow_request_id = br.id
          and (r.last_read_at is null or m.created_at > r.last_read_at)
          and m.message !~* ' deleted this conversation\\.\\s*also delete\\?$'
      )
  )
  select count(*)::int from unread;
$$;

create or replace function public.unread_borrow_threads_summary()
returns table (
  unread_count int,
  latest_borrow_request_id bigint,
  latest_status text
)
language sql
stable
security definer
set search_path = public
as $$
  with unread as (
    select br.id, br.status, br.updated_at
    from public.borrow_requests br
    left join public.borrow_request_reads r
      on r.borrow_request_id = br.id
     and r.user_id = auth.uid()
    left join public.borrow_request_deleted_for d
      on d.borrow_request_id = br.id
     and d.user_id = auth.uid()
    where auth.uid() is not null
      and br.kind = 'borrow'
      and (br.owner_id = auth.uid() or br.requester_id = auth.uid())
      and d.borrow_request_id is null
      and (r.last_read_at is null or br.updated_at > r.last_read_at)
      and exists (
        select 1
        from public.borrow_request_messages m
        where m.borrow_request_id = br.id
          and (r.last_read_at is null or m.created_at > r.last_read_at)
          and m.message !~* ' deleted this conversation\\.\\s*also delete\\?$'
      )
  )
  select
    (select count(*)::int from unread) as unread_count,
    (select id from unread order by updated_at desc limit 1) as latest_borrow_request_id,
    (select status from unread order by updated_at desc limit 1) as latest_status;
$$;

create or replace function public.unread_incoming_borrow_requests_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with unread as (
    select br.id
    from public.borrow_requests br
    left join public.borrow_request_reads r
      on r.borrow_request_id = br.id
     and r.user_id = auth.uid()
    left join public.borrow_request_deleted_for d
      on d.borrow_request_id = br.id
     and d.user_id = auth.uid()
    where auth.uid() is not null
      and br.owner_id = auth.uid()
      and br.kind = 'borrow'
      and br.status = 'pending'
      and d.borrow_request_id is null
      and (r.last_read_at is null or br.updated_at > r.last_read_at)
      and exists (
        select 1
        from public.borrow_request_messages m
        where m.borrow_request_id = br.id
          and (r.last_read_at is null or m.created_at > r.last_read_at)
          and m.message !~* ' deleted this conversation\\.\\s*also delete\\?$'
      )
  )
  select count(*)::int from unread;
$$;
