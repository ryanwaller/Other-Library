create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  page_url text not null,
  page_title text not null,
  element_context text null,
  category text not null check (category in ('bug', 'feels_wrong', 'feature_idea', 'other')),
  message text not null,
  screenshot_path text null,
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'wont_fix')),
  admin_notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_status_idx on public.feedback (status);
create index if not exists feedback_category_idx on public.feedback (category);
create index if not exists feedback_user_id_idx on public.feedback (user_id);

create or replace function public.set_feedback_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_feedback_updated_at on public.feedback;
create trigger trg_feedback_updated_at
before update on public.feedback
for each row
execute function public.set_feedback_updated_at();

alter table public.feedback enable row level security;

drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists feedback_select_own on public.feedback;
create policy feedback_select_own on public.feedback
for select
to authenticated
using (auth.uid() = user_id);
