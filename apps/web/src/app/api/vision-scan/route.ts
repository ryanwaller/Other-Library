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

// Terms that are not useful as title/author queries
const GENERIC_TERMS = new Set([
  "book", "books", "paperback", "hardcover", "hardback", "audiobook", "audio book",
  "ebook", "e-book", "e book", "novel", "fiction", "nonfiction", "non-fiction",
  "literature", "publication", "publications", "isbn", "author", "reading",
  "cover", "book cover", "text", "document", "font", "typeface", "typography",
  "brand", "product", "logo", "design", "print", "printing", "type", "art",
  "image", "photo", "illustration", "graphic", "visual", "media",
]);

// Book retailer/catalog domains — ISBNs and page titles from these are trusted
const BOOK_DOMAINS = [
  "amazon.com", "amazon.co.uk", "amazon.ca",
  "goodreads.com",
  "books.google.com",
  "openlibrary.org",
  "worldcat.org",
  "barnesandnoble.com",
  "bookshop.org",
];

function isBookDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return BOOK_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

/**
 * Returns true if the string looks like it could be a title or author name —
 * not a single short word, not a generic term, not OCR garbage.
 */
function isUsablePhrase(s: string): boolean {
  const trimmed = s.trim();
  const lower = trimmed.toLowerCase();

  if (GENERIC_TERMS.has(lower)) return false;

  // Must contain at least one run of 4+ letters (rules out "OCR", "ISBN", single chars)
  if (!/[a-zA-Z]{4,}/.test(trimmed)) return false;

  // Single word under 4 characters is not useful
  if (!/\s/.test(trimmed) && trimmed.length < 4) return false;

  // Purely numeric
  if (/^\d+$/.test(trimmed)) return false;

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

    // 1. ISBN from pagesWithMatchingImages — only trust bookstore/library domains
    for (const page of (web.pagesWithMatchingImages ?? [])) {
      if (isBookDomain(page.url)) {
        const isbn = extractIsbn13FromUrl(page.url);
        if (isbn) return NextResponse.json({ ok: true, isbn, source: "pageUrl" });
      }
    }

    // 2. ISBN from fullMatchingImages + partialMatchingImages URL patterns
    const imageUrls = [
      ...(web.fullMatchingImages ?? []).map((i) => i.url),
      ...(web.partialMatchingImages ?? []).map((i) => i.url),
    ];
    for (const url of imageUrls) {
      const isbn = extractIsbn13FromUrl(url);
      if (isbn) return NextResponse.json({ ok: true, isbn, source: "imageUrl" });
    }

    // 3. No ISBN found — build a combined text query from bestGuessLabels + webEntities.
    //    Both feed into the same title search as the Tesseract OCR path.
    //    Filter out generic/useless terms; deduplicate by substring containment.
    const candidates: string[] = [];

    const bestLabel = web.bestGuessLabels?.[0]?.label ?? "";
    if (bestLabel && isUsablePhrase(bestLabel)) candidates.push(bestLabel);

    for (const entity of (web.webEntities ?? [])) {
      if (!entity.description || entity.score < 0.5) continue;
      if (!isUsablePhrase(entity.description)) continue;
      const lower = entity.description.toLowerCase();
      // Skip if already covered by an existing candidate (substring both ways)
      const duplicate = candidates.some(
        (c) => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase())
      );
      if (!duplicate) candidates.push(entity.description);
      if (candidates.length >= 3) break;
    }

    const query = candidates.join(" ").trim();
    if (query) {
      const confidence = web.webEntities?.[0]?.score ?? 0.4;
      return NextResponse.json({ ok: true, query, confidence, source: "combined" });
    }

    // Nothing useful — stay silent, let Tesseract continue
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
