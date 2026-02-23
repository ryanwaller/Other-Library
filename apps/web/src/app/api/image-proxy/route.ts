import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const USER_AGENT = "Other-Library/0.1 (https://other-library.com; contact: hello@other-library.com)";

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "127.0.0.1" || h === "0.0.0.0" || h === "::1") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split(".").map((x) => Number(x));
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 127) return true;
    if (a === 0) return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const urlValue = String(searchParams.get("url") ?? "").trim();
  if (!urlValue) return NextResponse.json({ ok: false, error: "Provide a url." }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid url." }, { status: 400 });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ ok: false, error: "Only http/https URLs are supported." }, { status: 400 });
  }

  if (parsed.username || parsed.password) {
    return NextResponse.json({ ok: false, error: "URLs with credentials are not supported." }, { status: 400 });
  }

  if (isBlockedHostname(parsed.hostname)) {
    return NextResponse.json({ ok: false, error: "That host is not allowed." }, { status: 400 });
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });
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

