-- Track "last read" per borrow request participant + unread count for notifications.
-- Safe to run multiple times.

create table if not exists public.borrow_request_reads (
  borrow_request_id bigint not null references public.borrow_requests (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (borrow_request_id, user_id)
);

create index if not exists borrow_request_reads_user_id_idx
  on public.borrow_request_reads (user_id, last_read_at desc);

alter table public.borrow_request_reads enable row level security;

drop policy if exists "borrow_request_reads_select_self" on public.borrow_request_reads;
create policy "borrow_request_reads_select_self"
on public.borrow_request_reads
for select
using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "borrow_request_reads_insert_self" on public.borrow_request_reads;
create policy "borrow_request_reads_insert_self"
on public.borrow_request_reads
for insert
with check (
  auth.uid() is not null
  and auth.uid() = user_id
  and exists (
    select 1
    from public.borrow_requests br
    where br.id = borrow_request_id
      and (br.owner_id = auth.uid() or br.requester_id = auth.uid())
  )
);

drop policy if exists "borrow_request_reads_update_self" on public.borrow_request_reads;
create policy "borrow_request_reads_update_self"
on public.borrow_request_reads
for update
using (auth.uid() is not null and auth.uid() = user_id)
with check (
  auth.uid() is not null
  and auth.uid() = user_id
  and exists (
    select 1
    from public.borrow_requests br
    where br.id = borrow_request_id
      and (br.owner_id = auth.uid() or br.requester_id = auth.uid())
  )
);

create or replace function public.mark_borrow_request_read(input_borrow_request_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.borrow_request_reads (borrow_request_id, user_id, last_read_at)
  select br.id, auth.uid(), now()
  from public.borrow_requests br
  where br.id = input_borrow_request_id
    and (br.owner_id = auth.uid() or br.requester_id = auth.uid())
  on conflict (borrow_request_id, user_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.unread_incoming_borrow_requests_count()
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
    and br.owner_id = auth.uid()
    and br.kind = 'borrow'
    and br.status = 'pending'
    and (r.last_read_at is null or br.updated_at > r.last_read_at);
$$;

