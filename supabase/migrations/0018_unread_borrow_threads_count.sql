-- Unread borrow threads (for Messages badge).
-- Counts borrow request threads with activity since last read for the current user.
-- Safe to run multiple times.

create or replace function public.unread_borrow_threads_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.borrow_requests br
  left join public.borrow_request_reads r
    on r.borrow_request_id = br.id
   and r.user_id = auth.uid()
  where auth.uid() is not null
    and br.kind = 'borrow'
    and (br.owner_id = auth.uid() or br.requester_id = auth.uid())
    and (r.last_read_at is null or br.updated_at > r.last_read_at);
$$;

