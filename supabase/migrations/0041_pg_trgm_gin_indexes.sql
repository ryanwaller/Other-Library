-- Enable pg_trgm for fast ILIKE / trigram similarity search.
-- GIN indexes on high-traffic ILIKE columns.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- entities.name: used in discover search, related-items entity lookup, and name resolution.
CREATE INDEX IF NOT EXISTS entities_name_trgm_idx
  ON public.entities USING gin (name gin_trgm_ops);

-- user_books.title_override: used in client-side full-text search on catalog/profile pages.
CREATE INDEX IF NOT EXISTS user_books_title_override_trgm_idx
  ON public.user_books USING gin (title_override gin_trgm_ops)
  WHERE title_override IS NOT NULL;

-- editions.title: backing title for books without a title_override.
CREATE INDEX IF NOT EXISTS editions_title_trgm_idx
  ON public.editions USING gin (title gin_trgm_ops)
  WHERE title IS NOT NULL;
