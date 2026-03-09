alter table public.feedback
drop constraint if exists feedback_category_check;

alter table public.feedback
add constraint feedback_category_check
check (category in ('bug', 'feels_wrong', 'feature_idea', 'spacing_issue', 'design_issue', 'other'));
