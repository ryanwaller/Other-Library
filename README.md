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
- `APP_ORIGIN` (required in production for invite links, e.g. `https://your-domain.com`)
- `GOOGLE_VISION_API_KEY` (`/api/vision-scan`)
- `ENABLE_VISION_SCAN` (`true` to allow `/api/vision-scan`, default should stay `false` unless intentionally enabled)
- `VISION_SCAN_RATE_LIMIT_WINDOW_MS`, `VISION_SCAN_RATE_LIMIT_MAX`, `VISION_SCAN_MAX_IMAGE_BYTES` (safety limits for vision-scan)

## Run

- Web: `npm run dev:web`
- Mobile: `npm run dev:mobile`

## Validation

- Typecheck all workspaces: `npm run typecheck`
- Web tests: `npm -w @om/web run test`
