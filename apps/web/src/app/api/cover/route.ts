import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";

const ALLOWED_BUCKETS = new Set(["user-book-media"]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket") ?? "";
  const path = searchParams.get("path") ?? "";

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

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": data.type || "application/octet-stream",
      // Storage paths contain a timestamp so they are immutable — cache for 1 year
      "cache-control": "public, max-age=31536000, immutable"
    }
  });
}
