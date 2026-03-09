import { NextResponse, type NextRequest } from "next/server";
import sizeOf from "image-size";

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

function normalizeHttpsUrl(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://")) return `https://${raw.slice("http://".length)}`;
  return raw;
}

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

function chooseBestCoverUrl(urls: Array<string | null | undefined>): string | null {
  const candidates = uniqStrings(urls.map((u) => normalizeHttpsUrl(u)).filter(Boolean) as string[]);
  if (candidates.length === 0) return null;

  const score = (u: string): number => {
    let s = 0;
    const lc = u.toLowerCase();
    if (lc.includes("covers.openlibrary.org")) s += 4;
    if (lc.includes("-l.")) s += 3;
    if (lc.includes("special:filepath")) s += 3;
    if (lc.includes("width=")) s += 1;
    if (lc.includes("zoom=2") || lc.includes("zoom=3")) s += 2;
    if (lc.includes("smallthumbnail")) s -= 2;
    if (lc.includes("thumbnail")) s -= 1;
    if (lc.endsWith(".jpg") || lc.endsWith(".jpeg") || lc.endsWith(".png") || lc.endsWith(".webp")) s += 1;
    return s;
  };

  return candidates.slice().sort((a, b) => score(b) - score(a))[0] ?? candidates[0] ?? null;
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
  let description: string | null =
    typeof data.description === "string"
      ? data.description
      : typeof data.description?.value === "string"
        ? data.description.value
        : null;
  let subjects: string[] = Array.isArray(data.subjects) ? data.subjects.map((s: any) => s?.name).filter(Boolean) : [];
  const cover_url = normalizeHttpsUrl(
    data.cover?.large ?? data.cover?.medium ?? data.cover?.small ?? `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`
  );

  // If description or subjects are thin, try the Works API for richer data
  const workKey = Array.isArray(data.works) && data.works.length > 0 ? (data.works[0]?.key as string | undefined) : undefined;
  if (workKey && typeof workKey === "string" && (!description || subjects.length === 0)) {
    try {
      const workJson = await fetchJson(`https://openlibrary.org${workKey}.json`);
      if (workJson && typeof workJson === "object") {
        const w = workJson as any;
        if (!description) {
          description =
            typeof w.description === "string"
              ? w.description
              : typeof w.description?.value === "string"
                ? w.description.value
                : null;
        }
        if (subjects.length === 0 && Array.isArray(w.subjects)) {
          subjects = uniqStrings([...subjects, ...w.subjects.filter((s: any) => typeof s === "string")]);
        }
      }
    } catch {
      // best-effort; ignore failures
    }
  }

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
  const cover_url = normalizeHttpsUrl(
    info.imageLinks?.thumbnail ??
      info.imageLinks?.smallThumbnail ??
      (typeof info.imageLinks?.small === "string" ? info.imageLinks.small : null)
  );

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

async function validateCoverUrl(url: string | null | undefined): Promise<string | null> {
  const normalized = normalizeHttpsUrl(url);
  if (!normalized) return null;

  try {
    const res = await fetch(normalized, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const dimensions = sizeOf(Buffer.from(buffer));
    if (!dimensions.width || !dimensions.height) return null;
    if (dimensions.width < 100 || dimensions.height < 100) return null;

    return normalized;
  } catch (e) {
    console.error("validateCoverUrl failed:", e, normalized);
    return null;
  }
}

function normalizeLccn(input: string): string {
  return input.trim()
    .replace(/^https?:\/\/lccn\.loc\.gov\//i, "")
    .replace(/[\s\-]+/g, "")
    .toLowerCase();
}

function looksLikeLccn(input: string): boolean {
  const n = normalizeLccn(input);
  if (/^[a-z]{1,3}\d{6,10}$/.test(n)) return true;
  if (/^(19|20)\d{8}$/.test(n)) return true;
  return false;
}

function normalizeOclc(input: string): string {
  const stripped = input.trim()
    .replace(/^oclc[:\s\/]*/i, "")
    .replace(/^oc[mn]/i, "")
    .replace(/^on/i, "")
    .replace(/\s+/g, "")
    .replace(/^0+/, "");
  return stripped || "0";
}

function looksLikeOclc(input: string): boolean {
  const raw = input.trim();
  return /^(ocm|ocn|on)\d+$/i.test(raw) || /^oclc[:\s\/]\d+$/i.test(raw);
}

async function openLibraryLookupByBibkey(bibkey: string): Promise<{ meta: EditionMetadata; isbn13: string | null; isbn10: string | null } | null> {
  const url = `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(bibkey)}&format=json&jscmd=data`;
  const json = await fetchJson(url);
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, any>;
  const data = obj[bibkey];
  if (!data || typeof data !== "object") return null;

  const title = typeof data.title === "string" ? data.title : null;
  const authors = Array.isArray(data.authors) ? data.authors.map((a: any) => a?.name).filter(Boolean) : [];
  const publisher = Array.isArray(data.publishers) ? data.publishers[0]?.name ?? null : null;
  const publish_date = parseDateToIso(data.publish_date);
  let description: string | null =
    typeof data.description === "string" ? data.description :
    typeof data.description?.value === "string" ? data.description.value : null;
  let subjects: string[] = Array.isArray(data.subjects) ? data.subjects.map((s: any) => s?.name).filter(Boolean) : [];

  const ids = data.identifiers ?? {};
  const isbn13 = (Array.isArray(ids.isbn_13) ? ids.isbn_13[0] : null) ?? null;
  const isbn10 = (Array.isArray(ids.isbn_10) ? ids.isbn_10[0] : null) ?? null;

  const cover_url = normalizeHttpsUrl(
    data.cover?.large ?? data.cover?.medium ?? data.cover?.small ??
    (isbn13 ? `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg` : null)
  );

  const workKey = Array.isArray(data.works) && data.works.length > 0 ? (data.works[0]?.key as string | undefined) : undefined;
  if (workKey && (!description || subjects.length === 0)) {
    try {
      const workJson = await fetchJson(`https://openlibrary.org${workKey}.json`);
      if (workJson && typeof workJson === "object") {
        const w = workJson as any;
        if (!description) {
          description = typeof w.description === "string" ? w.description :
            typeof w.description?.value === "string" ? w.description.value : null;
        }
        if (subjects.length === 0 && Array.isArray(w.subjects)) {
          subjects = uniqStrings([...subjects, ...w.subjects.filter((s: any) => typeof s === "string")]);
        }
      }
    } catch { /* best-effort */ }
  }

  return {
    meta: { isbn13, isbn10, title, authors, publisher, publish_date, description, subjects, cover_url, raw: { openlibrary: data } },
    isbn13,
    isbn10
  };
}

async function googleBooksLookupByQuery(q: string): Promise<EditionMetadata | null> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1`;
  const json = await fetchJson(url);
  if (!json || typeof json !== "object") return null;
  const item = (json as any)?.items?.[0];
  const info = item?.volumeInfo;
  if (!info || typeof info !== "object") return null;

  const title = typeof info.title === "string" ? info.title : null;
  const authors = Array.isArray(info.authors) ? info.authors.filter((a: any) => typeof a === "string") : [];
  const publisher = typeof info.publisher === "string" ? info.publisher : null;
  const publish_date = parseDateToIso(info.publishedDate);
  const description = typeof info.description === "string" ? info.description : null;
  const subjects = Array.isArray(info.categories) ? info.categories.filter((c: any) => typeof c === "string") : [];
  const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
  const isbn13 = (() => {
    for (const x of identifiers) {
      const id = String(x?.identifier ?? "");
      if (x?.type === "ISBN_13" && /^\d{13}$/.test(id) && isValidIsbn13(id)) return id;
    }
    return null;
  })();
  const isbn10 = (() => {
    for (const x of identifiers) {
      if (x?.type === "ISBN_10") {
        const id = String(x?.identifier ?? "").replace(/[^0-9X]/gi, "").toUpperCase();
        if (/^\d{9}[\dX]$/.test(id)) return id;
      }
    }
    return null;
  })();
  const cover_url = normalizeHttpsUrl(
    info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null
  );

  return { isbn13, isbn10, title, authors, publisher, publish_date, description, subjects, cover_url, raw: { googleBooks: item } };
}

async function locLookup(lccn: string): Promise<EditionMetadata | null> {
  const url = `https://www.loc.gov/item/${encodeURIComponent(lccn)}/?fo=json`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow"
    });
    if (!res.ok) return null;
    const json = await res.json();
    const item = (json as any)?.item;
    if (!item || typeof item !== "object") return null;

    const title = typeof item.title === "string" ? item.title.replace(/\s*\/\s*$/, "").trim() : null;

    const rawContributors: unknown[] = Array.isArray(item.contributor) ? item.contributor :
      Array.isArray(item.creator) ? item.creator : [];
    const authors = rawContributors
      .map((c: any) => (typeof c === "string" ? c : (c?.label ?? c?.name ?? "")))
      .map((s: string) => s.replace(/,?\s*\d{4}(-\d{4})?\.?\s*$/, "").replace(/\.\s*$/, "").trim())
      .filter(Boolean);

    const rawPublisher: unknown = item.publisher;
    const publisher: string | null = typeof rawPublisher === "string" ? rawPublisher :
      Array.isArray(rawPublisher) ? (rawPublisher[0] ?? null) : null;

    const rawDate: unknown = item.date ?? (Array.isArray(item.dates) ? item.dates[0] : null);
    const publish_date = parseDateToIso(typeof rawDate === "string" ? rawDate : null);

    const rawSubjects: unknown[] = Array.isArray(item.subject) ? item.subject :
      Array.isArray(item.subjects) ? item.subjects : [];
    const subjects = rawSubjects
      .map((s: any) => (typeof s === "string" ? s : (s?.label ?? s?.url ?? "")))
      .filter((s: string) => s && !s.startsWith("http"))
      .map((s: string) => s.replace(/--/g, " — ").trim())
      .filter(Boolean);

    const rawNotes: unknown[] = Array.isArray(item.notes) ? item.notes : [];
    const description = rawNotes.find((n: any) => typeof n === "string" && n.length > 30) as string | null ?? null;

    return { title, authors, publisher, publish_date, description: description ?? null, subjects, cover_url: null, raw: { loc: item } };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const input = (searchParams.get("isbn") ?? "").trim();
  const normalizedIsbn = normalizeIsbn(input);

  // ── ISBN path ────────────────────────────────────────────────────────────
  let isbn10: string | null = null;
  let isbn13: string | null = null;

  if (normalizedIsbn.length === 10 && isValidIsbn10(normalizedIsbn)) {
    isbn10 = normalizedIsbn;
    isbn13 = isbn10ToIsbn13(normalizedIsbn);
  } else if (normalizedIsbn.length === 13 && isValidIsbn13(normalizedIsbn)) {
    isbn13 = normalizedIsbn;
  }

  if (isbn13) {
    const empty: EditionMetadata = { isbn10, isbn13, authors: [], subjects: [], sources: [], raw: {} };
    let merged: EditionMetadata = empty;

    const [ol, gb, wd] = await Promise.allSettled([
      openLibraryLookup(isbn13, isbn10),
      googleBooksLookup(isbn13),
      wikidataLookup(isbn13, isbn10)
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

    const bestUrl = chooseBestCoverUrl([merged.cover_url, ...results.map(([, r]) => r?.cover_url)]);
    merged.cover_url = await validateCoverUrl(bestUrl);
    merged.authors = merged.authors ?? [];
    merged.subjects = merged.subjects ?? [];
    return NextResponse.json({ ok: true, edition: merged });
  }

  // ── LCCN path ────────────────────────────────────────────────────────────
  if (looksLikeLccn(input)) {
    const lccn = normalizeLccn(input);
    const empty: EditionMetadata = { authors: [], subjects: [], sources: [], raw: {} };
    let merged: EditionMetadata = empty;

    const [olResult, gbResult, locResult] = await Promise.allSettled([
      openLibraryLookupByBibkey(`LCCN:${lccn}`),
      googleBooksLookupByQuery(`lccn:${lccn}`),
      locLookup(lccn)
    ]);

    const olMeta = olResult.status === "fulfilled" ? olResult.value?.meta ?? null : null;
    const gbMeta = gbResult.status === "fulfilled" ? gbResult.value : null;
    const locMeta = locResult.status === "fulfilled" ? locResult.value : null;

    if (olResult.status === "fulfilled" && olResult.value) {
      merged.isbn13 = merged.isbn13 ?? olResult.value.isbn13;
      merged.isbn10 = merged.isbn10 ?? olResult.value.isbn10;
    }

    const allResults: Array<[string, EditionMetadata | null]> = [
      ["openlibrary", olMeta],
      ["loc", locMeta],
      ["googleBooks", gbMeta]
    ];
    for (const [name, res] of allResults) {
      if (!res) continue;
      merged = mergeMetadata(merged, res, name);
    }

    const allCoverUrls = allResults.map(([, r]) => r?.cover_url);
    if (merged.isbn13) allCoverUrls.push(`https://covers.openlibrary.org/b/isbn/${merged.isbn13}-L.jpg`);
    const bestUrl = chooseBestCoverUrl([merged.cover_url, ...allCoverUrls]);
    merged.cover_url = await validateCoverUrl(bestUrl);
    merged.authors = merged.authors ?? [];
    merged.subjects = merged.subjects ?? [];
    return NextResponse.json({ ok: true, edition: merged });
  }

  // ── OCLC path ────────────────────────────────────────────────────────────
  if (looksLikeOclc(input)) {
    const oclc = normalizeOclc(input);
    const empty: EditionMetadata = { authors: [], subjects: [], sources: [], raw: {} };
    let merged: EditionMetadata = empty;

    const olResultOclc = await openLibraryLookupByBibkey(`OCLC:${oclc}`).catch(() => null);
    const olMeta = olResultOclc?.meta ?? null;
    if (olResultOclc) {
      merged.isbn13 = merged.isbn13 ?? olResultOclc.isbn13;
      merged.isbn10 = merged.isbn10 ?? olResultOclc.isbn10;
    }
    if (olMeta) merged = mergeMetadata(merged, olMeta, "openlibrary");

    const isbnForGb = merged.isbn13 ?? merged.isbn10;
    const gbMeta = isbnForGb
      ? await googleBooksLookup(isbnForGb).catch(() => null)
      : (merged.title ? await googleBooksLookupByQuery(`${merged.title}${merged.authors?.[0] ? `+inauthor:${merged.authors[0]}` : ""}`).catch(() => null) : null);

    if (gbMeta) merged = mergeMetadata(merged, gbMeta, "googleBooks");

    const allCoverUrls = [olMeta?.cover_url, gbMeta?.cover_url];
    if (merged.isbn13) allCoverUrls.push(`https://covers.openlibrary.org/b/isbn/${merged.isbn13}-L.jpg`);
    const bestUrl = chooseBestCoverUrl([merged.cover_url, ...allCoverUrls]);
    merged.cover_url = await validateCoverUrl(bestUrl);
    merged.authors = merged.authors ?? [];
    merged.subjects = merged.subjects ?? [];
    return NextResponse.json({ ok: true, edition: merged });
  }

  return NextResponse.json(
    { ok: false, error: "Invalid identifier. Provide a valid ISBN-10, ISBN-13, LCCN, or OCLC number (ocm/ocn/on prefix)." },
    { status: 400 }
  );
}
