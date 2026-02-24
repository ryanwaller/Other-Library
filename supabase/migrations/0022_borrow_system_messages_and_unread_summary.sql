-- Borrow chat UX helpers:
-- - Allow chat to continue after a reject (status = rejected)
-- - Provide unread summary for nav (count + latest thread)
-- - Default object_type to 'book'
-- Safe to run multiple times.

-- Default new objects to "book" and backfill nulls.
alter table public.user_books
  alter column object_type set default 'book';

update public.user_books
set object_type = 'book'
where object_type is null;

-- Allow inserting messages when a thread is rejected (so users can continue discussing).
drop policy if exists "borrow_request_messages_insert_owner_or_requester" on public.borrow_request_messages;
create policy "borrow_request_messages_insert_owner_or_requester"
on public.borrow_request_messages
for insert
with check (
  auth.uid() is not null
  and auth.uid() = sender_id
  and exists (
    select 1
    from public.borrow_requests br
    where br.id = borrow_request_id
      and (br.owner_id = auth.uid() or br.requester_id = auth.uid())
      and br.status in ('pending', 'approved', 'rejected')
  )
);

-- Unread borrow threads summary for nav (count + latest).
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
    where auth.uid() is not null
      and br.kind = 'borrow'
      and (br.owner_id = auth.uid() or br.requester_id = auth.uid())
      and (r.last_read_at is null or br.updated_at > r.last_read_at)
  )
  select
    (select count(*)::int from unread) as unread_count,
    (select id from unread order by updated_at desc limit 1) as latest_borrow_request_id,
    (select status from unread order by updated_at desc limit 1) as latest_status;
$$;

grant execute on function public.unread_borrow_threads_summary() to authenticated;

