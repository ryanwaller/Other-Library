import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";

const ALLOWED_BUCKETS = new Set(["user-book-media"]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket") ?? "";
  const path = searchParams.get("path") ?? "";
  const wParam = searchParams.get("w");
  const targetWidth = wParam ? parseInt(wParam, 10) : null;

  if (!ALLOWED_BUCKETS.has(bucket) || !path) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Server misconfigured." }, { status: 500 });
  }

  // Primary: Supabase image transform API (no native binaries needed).
  // Requires the image transformation feature to be enabled on the project.
  // When enabled, Supabase returns a /render/image/sign/ URL that resizes on fetch.
  // When NOT enabled, it silently returns a regular /object/sign/ URL (full-size image)
  // — so we check for the render path before trusting the response.
  if (targetWidth && Number.isFinite(targetWidth) && targetWidth > 0 && targetWidth <= 2000) {
    try {
      const { data: signedData, error: signedError } = await (admin.storage
        .from(bucket) as any)
        .createSignedUrl(path, 60, {
          transform: { width: targetWidth, quality: 80 }
        });

      if (!signedError && signedData?.signedUrl?.includes("/render/image/sign/")) {
        const imgRes = await fetch(signedData.signedUrl);
        if (imgRes.ok) {
          const buf = await imgRes.arrayBuffer();
          return new NextResponse(new Uint8Array(buf), {
            status: 200,
            headers: {
              "content-type": imgRes.headers.get("content-type") || "image/jpeg",
              "cache-control": "public, max-age=31536000, immutable",
              "x-resize-method": "supabase-transform"
            }
          });
        }
        console.error("[cover] supabase transform fetch failed:", imgRes.status, imgRes.statusText);
      } else if (signedError) {
        console.error("[cover] supabase transform signedUrl error:", signedError);
      }
    } catch (err) {
      console.error("[cover] supabase transform exception:", err);
    }
  }

  // Fallback: fetch original via signed URL (uses Supabase CDN, consistent with
  // how the rest of the app accesses images), then resize with sharp.
  const { data: signedFallback, error: signedFallbackError } = await (admin.storage.from(bucket) as any).createSignedUrl(path, 60);
  if (signedFallbackError || !signedFallback?.signedUrl) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }
  const rawRes = await fetch(signedFallback.signedUrl);
  if (!rawRes.ok) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const buf = await rawRes.arrayBuffer();

  if (targetWidth && Number.isFinite(targetWidth) && targetWidth > 0 && targetWidth <= 2000) {
    try {
      const sharp = (await import("sharp")).default;
      const inputMeta = await sharp(Buffer.from(buf)).metadata();
      console.log(`[cover] input: ${inputMeta.width}x${inputMeta.height} (${inputMeta.format}) → target w=${targetWidth}`);
      const resized = await sharp(Buffer.from(buf))
        .resize({ width: targetWidth, fit: "inside" })
        .webp({ quality: 80 })
        .toBuffer();
      const outputMeta = await sharp(resized).metadata();
      console.log(`[cover] output: ${outputMeta.width}x${outputMeta.height}`);
      return new NextResponse(new Uint8Array(resized), {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=31536000, immutable",
          "x-resize-method": "sharp",
          "x-resize-dims": `${inputMeta.width}x${inputMeta.height}->${outputMeta.width}x${outputMeta.height}`
        }
      });
    } catch (sharpErr) {
      const msg = sharpErr instanceof Error ? sharpErr.message : String(sharpErr);
      console.error("[cover] sharp error:", msg);
    }
  }

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": rawRes.headers.get("content-type") || "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      "x-resize-method": "original"
    }
  });
}
