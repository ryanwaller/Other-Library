import { NextResponse, type NextRequest } from "next/server";
import { fetchWithSafeRedirects, isSafeHttpUrl } from "../../../lib/networkSafety";

export const runtime = "nodejs";

const USER_AGENT = "Other-Library/0.1 (https://other-library.com; contact: hello@other-library.com)";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const urlValue = String(searchParams.get("url") ?? "").trim();
  const widthParam = searchParams.get("width");
  const targetWidth = widthParam ? parseInt(widthParam, 10) : null;
  if (!urlValue) return NextResponse.json({ ok: false, error: "Provide a url." }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid url." }, { status: 400 });
  }

  if (!isSafeHttpUrl(parsed)) {
    return NextResponse.json({ ok: false, error: "That host is not allowed." }, { status: 400 });
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const { response: res } = await fetchWithSafeRedirects(
      parsed.toString(),
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          Referer: parsed.hostname.endsWith("discogs.com") ? "https://www.discogs.com/" : parsed.toString()
        },
        signal: controller.signal
      },
      5
    );
    if (!res.ok) return NextResponse.json({ ok: false, error: `Fetch failed (${res.status})` }, { status: 400 });

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "URL did not return an image." }, { status: 400 });
    }

    const contentLength = Number(res.headers.get("content-length") ?? "0");
    const MAX = 6_000_000; // 6MB
    if (contentLength && contentLength > MAX) {
      return NextResponse.json({ ok: false, error: "Image too large." }, { status: 400 });
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX) {
      return NextResponse.json({ ok: false, error: "Image too large." }, { status: 400 });
    }

    if (targetWidth && Number.isFinite(targetWidth) && targetWidth > 0 && targetWidth <= 2000) {
      const sharp = (await import("sharp")).default;
      const resized = await sharp(Buffer.from(buf))
        .resize({ width: targetWidth, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      return new NextResponse(resized, {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=3600"
        }
      });
    }

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600"
      }
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.name === "AbortError" ? "Timed out." : e?.message ?? "Fetch failed" }, { status: 400 });
  } finally {
    clearTimeout(t);
  }
}
