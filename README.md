# OM Library App

Minimal web + iOS app for cataloging books and sharing with approved followers.

## Tech
- iOS/Android: Expo (React Native)
- Web: Next.js (App Router) — supports crawlable public pages later
- Backend: Supabase (Postgres + Auth + Storage) with Row Level Security

## Setup (first run)
1) Create a Supabase project.
2) In Supabase SQL editor, run:
   - `supabase/schema.sql`
3) Copy `.env.example` to `.env` and fill in the Supabase URL + anon key.
4) Install deps from repo root:
   - `npm install`
5) Run:
   - Web: `npm run dev:web`
   - Mobile: `npm run dev:mobile` (then open iOS simulator / Expo Go)

## Notes
- Default privacy is followers-only; users can opt into public profile and/or public books via fields on `profiles` and `user_books`.
- Recommended domains:
  - `other-library.com` + `www.other-library.com` for marketing and crawlable public pages later
  - `app.other-library.com` for the authenticated app (middleware rewrites requests to `/app`)
