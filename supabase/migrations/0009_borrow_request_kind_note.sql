-- Allow "note" messages on public books even when not borrowable.
-- Adds borrow_requests.kind and updates insert policy accordingly.

alter table public.borrow_requests
  add column if not exists kind text not null default 'borrow';

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'borrow_requests'
      and tc.constraint_type = 'CHECK'
      and tc.constraint_name = 'borrow_requests_kind_check'
  ) then
    alter table public.borrow_requests
      add constraint borrow_requests_kind_check check (kind in ('borrow', 'note'));
  end if;
end $$;

create index if not exists borrow_requests_owner_kind_status_idx on public.borrow_requests (owner_id, kind, status, created_at desc);

-- Update requester insert policy: allow kind='note' as long as the book is visible and scope permits.
drop policy if exists "borrow_requests_insert_requester" on public.borrow_requests;
create policy "borrow_requests_insert_requester"
on public.borrow_requests
for insert
with check (
  auth.uid() = requester_id
  and status = 'pending'
  and kind in ('borrow', 'note')
  and exists (
    select 1
    from public.user_books ub
    join public.profiles p on p.id = ub.owner_id
    where ub.id = user_book_id
      and ub.owner_id = owner_id
      and public.can_view_user_book(ub)
      and (
        -- Borrow requests require the book to be borrowable; notes do not.
        kind = 'note'
        or (
          case
            when ub.borrowable_override is null then p.borrowable_default
            else ub.borrowable_override
          end
        )
      )
      and (
        case
          when ub.borrow_request_scope_override is null then p.borrow_request_scope
          else ub.borrow_request_scope_override
        end = 'anyone'
        or public.is_approved_follower(auth.uid(), ub.owner_id)
      )
  )
);

