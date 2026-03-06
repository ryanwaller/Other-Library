alter table public.feedback
add column if not exists device_type text null;

alter table public.feedback
drop constraint if exists feedback_device_type_check;

alter table public.feedback
add constraint feedback_device_type_check
check (device_type in ('desktop', 'mobile', 'tablet', 'unknown'));
