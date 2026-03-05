-- Allow owner/requester to keep chatting after a borrow request is cancelled.

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
      and br.status in ('pending', 'approved', 'rejected', 'cancelled')
  )
);
