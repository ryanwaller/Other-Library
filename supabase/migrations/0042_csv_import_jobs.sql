create table if not exists public.csv_import_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  library_id bigint not null references public.libraries(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  apply_overrides boolean not null default false,
  rows jsonb not null default '[]'::jsonb,
  total_rows integer not null default 0,
  processed_rows integer not null default 0,
  success_rows integer not null default 0,
  failed_rows integer not null default 0,
  last_error text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists csv_import_jobs_owner_created_idx
  on public.csv_import_jobs (owner_id, created_at desc);

create index if not exists csv_import_jobs_owner_status_idx
  on public.csv_import_jobs (owner_id, status, created_at desc);

create or replace function public.touch_csv_import_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_csv_import_jobs_updated_at on public.csv_import_jobs;
create trigger trg_touch_csv_import_jobs_updated_at
before update on public.csv_import_jobs
for each row
execute function public.touch_csv_import_jobs_updated_at();

alter table public.csv_import_jobs enable row level security;

drop policy if exists "csv_import_jobs_select_own" on public.csv_import_jobs;
create policy "csv_import_jobs_select_own"
on public.csv_import_jobs
for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "csv_import_jobs_insert_own" on public.csv_import_jobs;
create policy "csv_import_jobs_insert_own"
on public.csv_import_jobs
for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "csv_import_jobs_update_own" on public.csv_import_jobs;
create policy "csv_import_jobs_update_own"
on public.csv_import_jobs
for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);
