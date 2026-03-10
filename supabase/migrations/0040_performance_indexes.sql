-- Performance indexes identified via audit.
-- Safe to run multiple times (CREATE INDEX IF NOT EXISTS).

-- follows: reverse lookup by followee_id (used by RLS visibility checks and
-- "who follows this user" queries). The existing PK covers follower_id first,
-- making followee_id-first lookups seq-scan the table.
CREATE INDEX IF NOT EXISTS follows_followee_id_status_idx
  ON public.follows (followee_id, status);

-- user_books: owner_id lookup without library_id (used by public profile page
-- and visibility checks that go by owner rather than library).
CREATE INDEX IF NOT EXISTS user_books_owner_id_idx
  ON public.user_books (owner_id);

-- user_books: edition_id lookup (FK join to editions, no dedicated index).
CREATE INDEX IF NOT EXISTS user_books_edition_id_idx
  ON public.user_books (edition_id)
  WHERE edition_id IS NOT NULL;

-- user_book_tags: tag_id-first lookup for tag-based filtering.
-- The PK is (user_book_id, tag_id) so tag_id-first joins seq-scan.
CREATE INDEX IF NOT EXISTS user_book_tags_tag_id_idx
  ON public.user_book_tags (tag_id);

-- entities: name lookup for ILIKE search (discover entity search).
-- pg_trgm GIN index would be ideal but requires the extension; this btree
-- index at least covers equality and prefix lookups.
CREATE INDEX IF NOT EXISTS entities_name_idx
  ON public.entities (name);

-- borrow_request_messages: sender_id FK (flagged by Supabase advisor).
CREATE INDEX IF NOT EXISTS borrow_request_messages_sender_id_idx
  ON public.borrow_request_messages (sender_id);

-- catalog_members: invited_by FK (flagged by Supabase advisor).
CREATE INDEX IF NOT EXISTS catalog_members_invited_by_idx
  ON public.catalog_members (invited_by)
  WHERE invited_by IS NOT NULL;
