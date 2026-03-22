alter table if exists public.homepage_feature_slots
  add column if not exists match_name text;
