create table if not exists public.entity_aliases (
  slug text primary key,
  name text not null,
  entity_id uuid not null references public.entities(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists entity_aliases_entity_id_idx on public.entity_aliases (entity_id);

alter table public.entity_aliases enable row level security;

drop policy if exists "entity_aliases_select_all" on public.entity_aliases;
create policy "entity_aliases_select_all"
on public.entity_aliases
for select
using (true);
