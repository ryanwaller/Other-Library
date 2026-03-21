alter table public.homepage_feature_slots
drop constraint if exists homepage_feature_slots_slot_index_check;

alter table public.homepage_feature_slots
add constraint homepage_feature_slots_slot_index_check
check (slot_index between 1 and 4);
