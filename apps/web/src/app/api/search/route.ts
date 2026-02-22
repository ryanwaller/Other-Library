import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

type SearchResult = {
  source: "openlibrary" | "googleBooks";
  title: string | null;
  authors: string[];
  publisher: string | null;
  publish_date: string | null; // ISO YYYY-MM-DD when confidently parsed, else null
  publish_year: number | null;
  subjects: string[];
  isbn10: string | null;
  isbn13: string | null;
  cover_url: string | null;
  raw: Record<string, unknown>;
};

const USER_AGENT = "Other-Library/0.1 (https://other-library.com; contact: hello@other-library.com)";

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

function parseDateToIso(dateLike: unknown): string | null {
  if (typeof dateLike !== "string") return null;
  const s = dateLike.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return null;

  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeIsbn(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^0-9X]/g, "");
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

function pickIsbn13(values: string[]): string | null {
  for (const v of values) {
    const n = normalizeIsbn(v);
    if (n.length === 13 && isValidIsbn13(n)) return n;
  }
  return null;
}

async function fetchJson(url: string): Promise<unknown | null> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  return res.json();
}

async function openLibrarySearch(title: string, author: string | null): Promise<SearchResult[]> {
  const qs = new URLSearchParams();
  qs.set("title", title);
  if (author) qs.set("author", author);
  qs.set("limit", "10");

  const url = `https://openlibrary.org/search.json?${qs.toString()}`;
  const json = await fetchJson(url);
  const docs = (json as any)?.docs;
  if (!Array.isArray(docs)) return [];

  const out: SearchResult[] = [];
  for (const d of docs) {
    const doc = d ?? {};
    const authors = Array.isArray(doc.author_name) ? doc.author_name.filter((x: any) => typeof x === "string") : [];
    const publisher = Array.isArray(doc.publisher) ? doc.publisher.find((x: any) => typeof x === "string") ?? null : null;
    const publishYear = typeof doc.first_publish_year === "number" ? doc.first_publish_year : null;
    const publishDateCandidate =
      Array.isArray(doc.publish_date) && doc.publish_date.length > 0 ? String(doc.publish_date[0] ?? "").trim() : null;
    const publish_date = parseDateToIso(publishDateCandidate);
    const subjects = Array.isArray(doc.subject) ? doc.subject.filter((x: any) => typeof x === "string").slice(0, 25) : [];

    const isbns = Array.isArray(doc.isbn) ? doc.isbn.filter((x: any) => typeof x === "string") : [];
    const isbn13 = pickIsbn13(isbns);
    const isbn10 = (() => {
      for (const v of isbns) {
        const n = normalizeIsbn(v);
        if (/^\d{9}[\dX]$/.test(n)) return n;
      }
      return null;
    })();

    const cover_i = typeof doc.cover_i === "number" ? doc.cover_i : null;
    const cover_url = cover_i ? `https://covers.openlibrary.org/b/id/${cover_i}-L.jpg` : null;

    out.push({
      source: "openlibrary",
      title: typeof doc.title === "string" ? doc.title : null,
      authors,
      publisher: typeof publisher === "string" ? publisher : null,
      publish_date,
      publish_year: publishYear,
      subjects,
      isbn10,
      isbn13,
      cover_url,
      raw: { openlibrary: doc }
    });
  }
  return out;
}

async function googleBooksSearch(title: string, author: string | null): Promise<SearchResult[]> {
  const qParts = [`intitle:${title}`];
  if (author) qParts.push(`inauthor:${author}`);
  const q = qParts.join("+");

  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books`;
  const json = await fetchJson(url);
  const items = (json as any)?.items;
  if (!Array.isArray(items)) return [];

  const out: SearchResult[] = [];
  for (const it of items) {
    const info = it?.volumeInfo;
    if (!info || typeof info !== "object") continue;

    const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
    const isbn13 =
      pickIsbn13(identifiers.map((x: any) => (x?.type === "ISBN_13" ? String(x?.identifier ?? "") : ""))) ??
      pickIsbn13(identifiers.map((x: any) => String(x?.identifier ?? "")));
    const isbn10 = (() => {
      for (const x of identifiers) {
        const id = String(x?.identifier ?? "");
        const n = normalizeIsbn(id);
        if (x?.type === "ISBN_10" && /^\d{9}[\dX]$/.test(n)) return n;
      }
      for (const x of identifiers) {
        const n = normalizeIsbn(String(x?.identifier ?? ""));
        if (/^\d{9}[\dX]$/.test(n)) return n;
      }
      return null;
    })();

    const publish_date = parseDateToIso(info.publishedDate);
    const publish_year = (() => {
      const s = typeof info.publishedDate === "string" ? info.publishedDate.trim() : "";
      if (/^\d{4}/.test(s)) return Number(s.slice(0, 4));
      return null;
    })();

    const subjects = Array.isArray(info.categories) ? info.categories.filter((x: any) => typeof x === "string") : [];
    const cover_url =
      typeof info.imageLinks?.thumbnail === "string"
        ? String(info.imageLinks.thumbnail).replace(/^http:\/\//i, "https://")
        : typeof info.imageLinks?.smallThumbnail === "string"
          ? String(info.imageLinks.smallThumbnail).replace(/^http:\/\//i, "https://")
          : null;

    out.push({
      source: "googleBooks",
      title: typeof info.title === "string" ? info.title : null,
      authors: Array.isArray(info.authors) ? info.authors.filter((x: any) => typeof x === "string") : [],
      publisher: typeof info.publisher === "string" ? info.publisher : null,
      publish_date,
      publish_year,
      subjects,
      isbn10,
      isbn13,
      cover_url,
      raw: { googleBooks: it }
    });
  }
  return out;
}

function score(r: SearchResult, title: string, author: string | null): number {
  const titleLc = title.toLowerCase();
  const t = (r.title ?? "").toLowerCase();
  const a = (author ?? "").toLowerCase();
  let s = 0;
  if (t && titleLc === t) s += 8;
  if (t && (titleLc.includes(t) || t.includes(titleLc))) s += 4;
  if (a) {
    const authors = (r.authors ?? []).map((x) => x.toLowerCase());
    if (authors.some((x) => x === a)) s += 5;
    if (authors.some((x) => x.includes(a) || a.includes(x))) s += 2;
  }
  if (r.isbn13) s += 3;
  if (r.cover_url) s += 1;
  if (r.publisher) s += 1;
  if (r.publish_date || r.publish_year) s += 1;
  return s;
}

function dedupe(results: SearchResult[]): SearchResult[] {
  const seenIsbn = new Set<string>();
  const seenKey = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    if (r.isbn13) {
      if (seenIsbn.has(r.isbn13)) continue;
      seenIsbn.add(r.isbn13);
      out.push(r);
      continue;
    }
    const key = `${(r.title ?? "").toLowerCase()}|${(r.authors ?? []).join(",").toLowerCase()}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    out.push(r);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = (searchParams.get("title") ?? "").trim();
  const author = (searchParams.get("author") ?? "").trim();

  if (!title) {
    return NextResponse.json({ ok: false, error: "Provide a title." }, { status: 400 });
  }

  const authorValue = author || null;

  const [ol, gb] = await Promise.allSettled([openLibrarySearch(title, authorValue), googleBooksSearch(title, authorValue)]);

  const combined = [
    ...(ol.status === "fulfilled" ? ol.value : []),
    ...(gb.status === "fulfilled" ? gb.value : [])
  ];

  const ranked = dedupe(combined)
    .map((r) => ({ r, s: score(r, title, authorValue) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r)
    .slice(0, 12);

  // Ensure arrays are present.
  for (const r of ranked) {
    r.authors = uniqStrings(r.authors ?? []);
    r.subjects = uniqStrings(r.subjects ?? []);
  }

  return NextResponse.json({ ok: true, results: ranked });
}
