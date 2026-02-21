import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

type EditionMetadata = {
  isbn10?: string | null;
  isbn13?: string | null;
  title?: string | null;
  authors?: string[];
  publisher?: string | null;
  publish_date?: string | null; // YYYY-MM-DD
  description?: string | null;
  subjects?: string[];
  cover_url?: string | null;
  raw?: Record<string, unknown>;
  sources?: string[];
};

const USER_AGENT = "Other-Library/0.1 (https://other-library.com; contact: hello@other-library.com)";

function normalizeIsbn(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^0-9X]/g, "");
}

function isValidIsbn10(isbn10: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn10)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = isbn10[i]!;
    const value = ch === "X" ? 10 : Number(ch);
    sum += value * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn10ToIsbn13(isbn10: string): string | null {
  if (!isValidIsbn10(isbn10)) return null;
  const core = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(core[i]!);
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${core}${check}`;
}

function isValidIsbn13(isbn13: string): boolean {
  if (!/^\d{13}$/.test(isbn13)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(isbn13[i]!);
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(isbn13[12]!);
}

function parseDateToIso(dateLike: unknown): string | null {
  if (typeof dateLike !== "string") return null;
  const s = dateLike.trim();
  if (!s) return null;

  // Strict ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Try "YYYY-MM" (store first day of month)
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;

  // Try year-only (too ambiguous for a DATE column)
  if (/^\d{4}$/.test(s)) return null;

  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function uniqStrings(values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = (v ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function mergeMetadata(base: EditionMetadata, next: EditionMetadata, sourceName: string): EditionMetadata {
  const merged: EditionMetadata = { ...base };
  merged.sources = [...new Set([...(base.sources ?? []), sourceName, ...(next.sources ?? [])])];
  merged.raw = { ...(base.raw ?? {}), ...(next.raw ?? {}) };

  const pick = <K extends keyof EditionMetadata>(k: K) => {
    const current = merged[k];
    const incoming = next[k];
    const empty =
      current === undefined ||
      current === null ||
      (typeof current === "string" && current.trim() === "") ||
      (Array.isArray(current) && current.length === 0);
    if (empty && incoming !== undefined) merged[k] = incoming as EditionMetadata[K];
  };

  pick("isbn10");
  pick("isbn13");
  pick("title");
  pick("publisher");
  pick("publish_date");
  pick("description");
  pick("cover_url");

  merged.authors = uniqStrings([...(base.authors ?? []), ...(next.authors ?? [])]);
  merged.subjects = uniqStrings([...(base.subjects ?? []), ...(next.subjects ?? [])]);

  return merged;
}

async function fetchJson(url: string): Promise<unknown | null> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  return res.json();
}

async function openLibraryLookup(isbn13: string, isbn10: string | null): Promise<EditionMetadata | null> {
  const keys = uniqStrings([`ISBN:${isbn13}`, isbn10 ? `ISBN:${isbn10}` : null]);
  const url =
    `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(keys.join(","))}` +
    `&format=json&jscmd=data`;
  const json = await fetchJson(url);
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, any>;
  const data = obj[`ISBN:${isbn13}`] ?? (isbn10 ? obj[`ISBN:${isbn10}`] : null);
  if (!data || typeof data !== "object") return null;

  const title = typeof data.title === "string" ? data.title : null;
  const authors = Array.isArray(data.authors) ? data.authors.map((a: any) => a?.name).filter(Boolean) : [];
  const publisher = Array.isArray(data.publishers) ? data.publishers[0]?.name ?? null : null;
  const publish_date = parseDateToIso(data.publish_date);
  const description =
    typeof data.description === "string"
      ? data.description
      : typeof data.description?.value === "string"
        ? data.description.value
        : null;
  const subjects = Array.isArray(data.subjects) ? data.subjects.map((s: any) => s?.name).filter(Boolean) : [];
  const cover_url =
    data.cover?.large ?? data.cover?.medium ?? data.cover?.small ?? `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`;

  return {
    title,
    authors,
    publisher,
    publish_date,
    description,
    subjects,
    cover_url,
    raw: { openlibrary: data }
  };
}

async function googleBooksLookup(isbn: string): Promise<EditionMetadata | null> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`;
  const json = await fetchJson(url);
  if (!json || typeof json !== "object") return null;
  const obj = json as any;
  const item = Array.isArray(obj.items) ? obj.items[0] : null;
  const info = item?.volumeInfo;
  if (!info || typeof info !== "object") return null;

  const title = typeof info.title === "string" ? info.title : null;
  const authors = Array.isArray(info.authors) ? info.authors.filter((a: any) => typeof a === "string") : [];
  const publisher = typeof info.publisher === "string" ? info.publisher : null;
  const publish_date = parseDateToIso(info.publishedDate);
  const description = typeof info.description === "string" ? info.description : null;
  const subjects = Array.isArray(info.categories) ? info.categories.filter((c: any) => typeof c === "string") : [];
  const cover_url =
    info.imageLinks?.thumbnail ??
    info.imageLinks?.smallThumbnail ??
    (typeof info.imageLinks?.small === "string" ? info.imageLinks.small : null);

  return {
    title,
    authors,
    publisher,
    publish_date,
    description,
    subjects,
    cover_url,
    raw: { googleBooks: item }
  };
}

function commonsFileUrl(fileName: string, width: number): string {
  // fileName is typically "Some cover.jpg"
  const safe = fileName.replace(/^File:/i, "");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(safe)}?width=${width}`;
}

function wikidataImageToUrl(value: string, width: number): string {
  const v = value.trim();
  if (!v) return commonsFileUrl(value, width);
  if (/^https?:\/\//i.test(v)) {
    const https = v.replace(/^http:\/\//i, "https://");
    return https.includes("width=") ? https : `${https}${https.includes("?") ? "&" : "?"}width=${width}`;
  }
  return commonsFileUrl(v, width);
}

async function wikidataLookup(isbn13: string, isbn10: string | null): Promise<EditionMetadata | null> {
  const values = uniqStrings([isbn13, isbn10]);
  if (values.length === 0) return null;

  const isbnValues = values.map((v) => `"${v}"`).join(" ");
  const query = `
SELECT ?item ?itemLabel ?description ?pubdate ?publisherLabel ?authorLabel ?image WHERE {
  VALUES ?isbn { ${isbnValues} }
  ?item (wdt:P212|wdt:P957) ?isbn .
  OPTIONAL { ?item schema:description ?description . FILTER(LANG(?description) = "en") }
  OPTIONAL { ?item wdt:P577 ?pubdate . }
  OPTIONAL { ?item wdt:P123 ?publisher . }
  OPTIONAL { ?item wdt:P50 ?author . }
  OPTIONAL { ?item wdt:P18 ?image . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const json = await fetchJson(url);
  const bindings = (json as any)?.results?.bindings;
  if (!Array.isArray(bindings) || bindings.length === 0) return null;

  const first = bindings[0] as any;
  const title = typeof first?.itemLabel?.value === "string" ? first.itemLabel.value : null;
  const publisher = typeof first?.publisherLabel?.value === "string" ? first.publisherLabel.value : null;
  const description = typeof first?.description?.value === "string" ? first.description.value : null;
  const pubdate = typeof first?.pubdate?.value === "string" ? first.pubdate.value : null;
  const publish_date = parseDateToIso(pubdate);

  const authors = uniqStrings(bindings.map((b: any) => b?.authorLabel?.value));
  const image = typeof first?.image?.value === "string" ? first.image.value : null;
  const cover_url = image ? wikidataImageToUrl(image, 900) : null;

  return {
    title,
    authors,
    publisher,
    publish_date,
    description,
    cover_url,
    raw: { wikidata: { query, bindings } }
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const input = searchParams.get("isbn") ?? "";
  const normalized = normalizeIsbn(input);

  let isbn10: string | null = null;
  let isbn13: string | null = null;

  if (normalized.length === 10 && isValidIsbn10(normalized)) {
    isbn10 = normalized;
    isbn13 = isbn10ToIsbn13(normalized);
  } else if (normalized.length === 13 && isValidIsbn13(normalized)) {
    isbn13 = normalized;
  } else {
    return NextResponse.json(
      { ok: false, error: "Invalid ISBN. Provide a valid ISBN-10 or ISBN-13." },
      { status: 400 }
    );
  }

  const empty: EditionMetadata = { isbn10, isbn13, authors: [], subjects: [], sources: [], raw: {} };
  let merged: EditionMetadata = empty;

  const [ol, gb, wd] = await Promise.allSettled([
    openLibraryLookup(isbn13!, isbn10),
    googleBooksLookup(isbn13!),
    wikidataLookup(isbn13!, isbn10)
  ]);

  const results: Array<[string, EditionMetadata | null]> = [
    ["openlibrary", ol.status === "fulfilled" ? ol.value : null],
    ["googleBooks", gb.status === "fulfilled" ? gb.value : null],
    ["wikidata", wd.status === "fulfilled" ? wd.value : null]
  ];

  for (const [name, res] of results) {
    if (!res) continue;
    merged = mergeMetadata(merged, res, name);
  }

  // Ensure arrays are present.
  merged.authors = merged.authors ?? [];
  merged.subjects = merged.subjects ?? [];

  return NextResponse.json({ ok: true, edition: merged });
}
