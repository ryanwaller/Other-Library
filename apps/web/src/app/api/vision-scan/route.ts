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

// Generic terms that are not useful as book title queries
const GENERIC_TERMS = new Set([
  "book", "books", "paperback", "hardcover", "hardback", "audiobook", "audio book",
  "ebook", "e-book", "e book", "novel", "fiction", "nonfiction", "non-fiction",
  "literature", "publication", "publications", "isbn", "author", "reading",
  "cover", "book cover", "text", "document",
]);

// Book retailer/catalog domains in preference order
const BOOK_DOMAINS = [
  "amazon.com", "amazon.co.uk", "amazon.ca",
  "goodreads.com",
  "books.google.com",
  "openlibrary.org",
  "worldcat.org",
  "barnesandnoble.com",
  "bookshop.org",
];

function isBookTitleEntity(description: string): boolean {
  const lower = description.toLowerCase().trim();
  if (GENERIC_TERMS.has(lower)) return false;
  // Require at least two characters and not purely numeric
  if (lower.length < 3 || /^\d+$/.test(lower)) return false;
  return true;
}

function extractIsbn13FromUrl(url: string): string | null {
  // Patterns: /dp/XXXXXXXXXX, /isbn/XXXXXXXXXX, /books/XXXXXXXXXX, ?isbn=...
  const patterns = [
    /\/dp\/(\d{9}[\dX]|\d{13})/i,
    /\/isbn\/(\d{9}[\dX]|\d{13})/i,
    /\/books?\/(\d{9}[\dX]|\d{13})/i,
    /[?&]isbn=(\d{9}[\dX]|\d{13})/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) {
      const raw = m[1]!.replace(/[^\dX]/gi, "");
      if (raw.length === 13 && (raw.startsWith("978") || raw.startsWith("979"))) return raw;
      if (raw.length === 10) return isbn10to13(raw);
    }
  }
  return null;
}

function domainPriority(url: string): number {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const idx = BOOK_DOMAINS.findIndex((d) => host === d || host.endsWith("." + d));
    return idx === -1 ? BOOK_DOMAINS.length : idx;
  } catch {
    return BOOK_DOMAINS.length;
  }
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

  const requestBody = {
    requests: [
      {
        image: { content: image },
        // WEB_DETECTION only — visual web matching, not OCR (Tesseract handles that)
        features: [{ type: "WEB_DETECTION", maxResults: 10 }],
      },
    ],
  };

  console.log("[vision-scan] sending request:", JSON.stringify({
    requests: [
      {
        image: { content: `<base64 ${image.length} chars>` },
        features: requestBody.requests[0]!.features,
      },
    ],
  }, null, 2));

  try {
    const res = await fetch(`${VISION_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Vision API error: ${res.status}` }, { status: 502 });
    }

    const data = await res.json() as VisionResponse;
    console.log("[vision-scan] raw response:", JSON.stringify(data, null, 2));

    const web = data.responses?.[0]?.webDetection;
    if (!web) {
      return NextResponse.json({ ok: false, error: "No web detection result" });
    }

    // 1. webEntities — highest-scoring entity that looks like a book title
    const titleEntity = (web.webEntities ?? [])
      .filter((e) => e.score >= 0.5 && e.description && isBookTitleEntity(e.description))
      .sort((a, b) => b.score - a.score)[0];
    if (titleEntity?.description) {
      return NextResponse.json({
        ok: true,
        query: titleEntity.description,
        confidence: titleEntity.score,
        source: "webEntities",
      });
    }

    // 2. bestGuessLabels — fallback if no useful entity
    const bestLabel = (web.bestGuessLabels ?? [])
      .map((l) => l.label ?? "")
      .find((l) => l.length > 0 && isBookTitleEntity(l));
    if (bestLabel) {
      return NextResponse.json({ ok: true, query: bestLabel, confidence: 0.5, source: "bestGuessLabels" });
    }

    // 3. pagesWithMatchingImages — extract title from page titles, preferring book domains
    const pages = (web.pagesWithMatchingImages ?? [])
      .filter((p) => p.pageTitle)
      .sort((a, b) => domainPriority(a.url) - domainPriority(b.url));
    for (const page of pages) {
      const title = page.pageTitle!.trim();
      if (title.length > 3 && isBookTitleEntity(title)) {
        return NextResponse.json({ ok: true, query: title, confidence: 0.4, source: "pageTitle" });
      }
    }

    // 4. fullMatchingImages + partialMatchingImages — extract ISBNs from URL patterns
    const imageUrls = [
      ...(web.fullMatchingImages ?? []).map((i) => i.url),
      ...(web.partialMatchingImages ?? []).map((i) => i.url),
    ];
    for (const url of imageUrls) {
      const isbn = extractIsbn13FromUrl(url);
      if (isbn) return NextResponse.json({ ok: true, isbn, source: "imageUrl" });
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
