alter table if exists public.homepage_feature_slots
  drop constraint if exists homepage_feature_slots_role_check;

alter table public.homepage_feature_slots
  add constraint homepage_feature_slots_role_check
  check (role is null or role in ('author', 'designer', 'publisher', 'performer', 'tag', 'category', 'material'));
