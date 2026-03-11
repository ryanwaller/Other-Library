-- Add subtitle_override to user_books for periodical issue subtitles
ALTER TABLE public.user_books ADD COLUMN IF NOT EXISTS subtitle_override text;
