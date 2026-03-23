/**
 * Transform a cover image URL to a resized version served through our resize proxy.
 *
 * Handles three URL forms:
 *   - Supabase signed URLs  (/storage/v1/object/sign/bucket/path?token=...)
 *   - Supabase public URLs  (/storage/v1/object/public/bucket/path)
 *   - /api/image-proxy?url=... (already-proxied external covers)
 *   - Raw external https:// URLs (routes them through image-proxy)
 *
 * Returns the original src unchanged if it doesn't match any resizable form.
 */

const COVER_VERSION = 9;

export function resizeCoverUrl(src: string | null | undefined, maxWidth: number): string | null {
  if (!src) return null;

  // Supabase storage URL (signed or public)
  try {
    const url = new URL(src);
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+)$/);
    if (match) {
      const bucket = match[1];
      const path = match[2];
      return `/api/cover?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}&w=${maxWidth}&v=${COVER_VERSION}`;
    }
  } catch {
    // not a valid URL — fall through
  }

  // Already-proxied external image — append width param
  if (src.startsWith("/api/image-proxy?") && !src.includes("&width=")) {
    return `${src}&width=${maxWidth}`;
  }

  // Raw external URL — route through image-proxy with resize
  if (/^https?:\/\//i.test(src)) {
    return `/api/image-proxy?url=${encodeURIComponent(src)}&width=${maxWidth}`;
  }

  return src;
}
