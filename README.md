## OM Library App

Monorepo for OM web (`apps/web`), mobile (`apps/mobile`), shared package (`packages/shared`), and Supabase SQL (`supabase`).

## Local Setup

1. Install dependencies:
   `npm install`
2. Create env files:
   - `cp .env.example apps/web/.env.local`
   - `cp .env.example apps/mobile/.env`
3. Fill in real values in both env files.

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Optional (web-only features):
- `SUPABASE_SERVICE_ROLE_KEY` (admin API routes)
- `GOOGLE_VISION_API_KEY` (`/api/vision-scan`)

## Run

- Web: `npm run dev:web`
- Mobile: `npm run dev:mobile`

## Validation

- Typecheck all workspaces: `npm run typecheck`
- Web tests: `npm -w @om/web run test`
