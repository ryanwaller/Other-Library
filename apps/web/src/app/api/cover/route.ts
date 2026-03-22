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

  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const buf = await data.arrayBuffer();

  if (targetWidth && Number.isFinite(targetWidth) && targetWidth > 0 && targetWidth <= 2000) {
    try {
      const sharp = (await import("sharp")).default;
      const resized = await sharp(Buffer.from(buf))
        .resize({ width: targetWidth, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      return new NextResponse(new Uint8Array(resized), {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=31536000, immutable"
        }
      });
    } catch (sharpErr) {
      console.error("[cover] sharp error:", sharpErr);
      // Sharp unavailable — fall through and return original
    }
  }

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": data.type || "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable"
    }
  });
}
