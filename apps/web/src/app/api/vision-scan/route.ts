import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

interface WebEntity {
  entityId?: string;
  score: number;
  description?: string;
}
interface WebImage {
  url: string;
}
interface WebPage {
  url: string;
  pageTitle?: string;
}
interface BestGuessLabel {
  label?: string;
  languageCode?: string;
}
interface VisionResponse {
  responses?: Array<{
    webDetection?: {
      webEntities?: WebEntity[];
      bestGuessLabels?: BestGuessLabel[];
      pagesWithMatchingImages?: WebPage[];
      fullMatchingImages?: WebImage[];
      partialMatchingImages?: WebImage[];
    };
  }>;
}

function isbn10to13(isbn10: string): string | null {
  if (!/^\d{9}[\dX]$/.test(isbn10)) return null;
  const digits = isbn10.slice(0, 9);
  const prefix = "978" + digits;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(prefix[i]!, 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return prefix + check;
}

function extractIsbn13(text: string): string | null {
  const matches = text.match(/[\d][\d\s\-]{8,}[\d]/g) ?? [];
  for (const m of matches) {
    const digits = m.replace(/\D/g, "");
    if (digits.length === 13 && (digits.startsWith("978") || digits.startsWith("979"))) {
      return digits;
    }
    if (digits.length === 10) {
      const isbn13 = isbn10to13(digits);
      if (isbn13) return isbn13;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Vision API not configured" }, { status: 503 });
  }

  let body: { image?: unknown };
  try {
    body = await req.json() as { image?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { image } = body;
  if (!image || typeof image !== "string") {
    return NextResponse.json({ ok: false, error: "Missing image" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${VISION_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: image },
            features: [{ type: "WEB_DETECTION", maxResults: 10 }],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Vision API error: ${res.status}` }, { status: 502 });
    }

    const data = await res.json() as VisionResponse;
    const web = data.responses?.[0]?.webDetection;
    if (!web) {
      return NextResponse.json({ ok: false, error: "No web detection result" });
    }

    // 1. Try to extract ISBN-13 from page URLs and image URLs
    const urls = [
      ...(web.pagesWithMatchingImages ?? []).map((p) => p.url),
      ...(web.fullMatchingImages ?? []).map((i) => i.url),
      ...(web.partialMatchingImages ?? []).map((i) => i.url),
    ];
    for (const url of urls) {
      const isbn = extractIsbn13(url);
      if (isbn) return NextResponse.json({ ok: true, isbn, source: "url" });
    }

    // 2. Try to extract ISBN from entity descriptions and page titles
    const texts = [
      ...(web.webEntities ?? []).map((e) => e.description ?? ""),
      ...(web.bestGuessLabels ?? []).map((l) => l.label ?? ""),
      ...(web.pagesWithMatchingImages ?? []).map((p) => p.pageTitle ?? ""),
    ];
    for (const t of texts) {
      const isbn = extractIsbn13(t);
      if (isbn) return NextResponse.json({ ok: true, isbn, source: "text" });
    }

    // 3. Build a text search query from best guess label + top entities
    const bestLabel = web.bestGuessLabels?.[0]?.label ?? "";
    const topEntities = (web.webEntities ?? [])
      .filter((e) => e.score >= 0.5 && e.description)
      .slice(0, 3)
      .map((e) => e.description!);
    const query = bestLabel || topEntities.join(" ");
    const confidence = web.webEntities?.[0]?.score ?? 0;

    if (query) {
      return NextResponse.json({ ok: true, query, confidence, source: "entities" });
    }

    return NextResponse.json({ ok: false, error: "No usable result" });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ ok: false, error: "Vision API timeout" }, { status: 504 });
    }
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
