import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

type SearchResult = {
  source: "openlibrary" | "googleBooks" | "discogs";
  object_type: "book" | "music";
  source_type: string | null;
  source_url: string | null;
  external_source_ids: Record<string, string | null> | null;
  title: string | null;
  authors: string[];
  publisher: string | null;
  publish_date: string | null;
  publish_year: number | null;
  description: string | null;
  subjects: string[];
  isbn10: string | null;
  isbn13: string | null;
  cover_url: string | null;
  music_metadata?: Record<string, unknown> | null;
  contributor_entities?: Record<string, string[]> | null;
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
  return input.trim().toUpperCase().replace(/[^0-9X]/g, "");
}

function normalizeBarcode(input: string): string {
  return input.trim().replace(/\D/g, "");
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
  const json = await fetchJson(`https://openlibrary.org/search.json?${qs.toString()}`);
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
      object_type: "book",
      source_type: "openlibrary",
      source_url: null,
      external_source_ids: null,
      title: typeof doc.title === "string" ? doc.title : null,
      authors,
      publisher: typeof publisher === "string" ? publisher : null,
      publish_date,
      publish_year: publishYear,
      description: null,
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
  const json = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(qParts.join("+"))}&maxResults=10&printType=books`);
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
      object_type: "book",
      source_type: "googleBooks",
      source_url: null,
      external_source_ids: null,
      title: typeof info.title === "string" ? info.title : null,
      authors: Array.isArray(info.authors) ? info.authors.filter((x: any) => typeof x === "string") : [],
      publisher: typeof info.publisher === "string" ? info.publisher : null,
      publish_date,
      publish_year,
      description: null,
      subjects,
      isbn10,
      isbn13,
      cover_url,
      raw: { googleBooks: it }
    });
  }
  return out;
}

function mapDiscogsFormat(values: string[]): string | null {
  const joined = values.join(" ").toLowerCase();
  if (joined.includes("box set")) return "Box set";
  if (joined.includes("flexi")) return "Flexi disc";
  if (joined.includes("cassette")) return "Cassette";
  if (joined.includes("cd")) return "CD";
  if (joined.includes('12"')) return '12"';
  if (joined.includes('10"')) return '10"';
  if (joined.includes('7"')) return '7"';
  if (joined.includes("lp") || joined.includes("vinyl")) return "LP";
  return null;
}

function mapDiscogsReleaseType(values: string[]): string | null {
  const joined = values.join(" ").toLowerCase();
  if (joined.includes("box set")) return "Box set";
  if (joined.includes("soundtrack")) return "Soundtrack";
  if (joined.includes("compilation")) return "Compilation";
  if (joined.includes("live")) return "Live";
  if (/\bep\b/.test(joined)) return "EP";
  if (joined.includes("single")) return "Single";
  if (joined.includes("album")) return "Album";
  return null;
}

function mapDiscogsSpeed(values: string[]): string | null {
  const joined = values.join(" ").toLowerCase();
  if (joined.includes("33")) return "33⅓ RPM";
  if (joined.includes("45")) return "45 RPM";
  if (joined.includes("78")) return "78 RPM";
  return null;
}

function mapDiscogsChannels(values: string[]): string | null {
  const joined = values.join(" ").toLowerCase();
  if (joined.includes("stereo") && joined.includes("mono")) return "Both";
  if (joined.includes("stereo")) return "Stereo";
  if (joined.includes("mono")) return "Mono";
  return null;
}

async function discogsSearch(params: { title: string | null; author: string | null; barcode: string | null }): Promise<SearchResult[]> {
  const qs = new URLSearchParams();
  qs.set("type", "release");
  if (params.barcode) {
    qs.set("barcode", params.barcode);
  } else if (params.title && params.author) {
    qs.set("release_title", params.title);
    qs.set("artist", params.author);
  } else if (params.title) {
    qs.set("q", params.title);
  } else {
    return [];
  }
  qs.set("per_page", "12");
  const json = await fetchJson(`https://api.discogs.com/database/search?${qs.toString()}`);
  const results = (json as any)?.results;
  if (!Array.isArray(results)) return [];

  const out: SearchResult[] = [];
  for (const row of results) {
    const rawTitle = String(row?.title ?? "").trim();
    const uri = String(row?.uri ?? "").trim();
    const year = Number.isFinite(Number(row?.year)) ? Number(row.year) : null;
    const thumb = String(row?.cover_image ?? row?.thumb ?? "").trim() || null;
    const styleValues = Array.isArray(row?.style) ? row.style.filter((x: any) => typeof x === "string") : [];
    const genreValues = Array.isArray(row?.genre) ? row.genre.filter((x: any) => typeof x === "string") : [];
    const formatValues = Array.isArray(row?.format) ? row.format.filter((x: any) => typeof x === "string") : [];
    const labelValues = Array.isArray(row?.label) ? row.label.filter((x: any) => typeof x === "string") : [];
    const artistValues = Array.isArray(row?.artist) ? row.artist.filter((x: any) => typeof x === "string") : [];
    const catno = String(row?.catno ?? "").trim() || null;
    const barcode = params.barcode;

    let displayTitle = rawTitle;
    let authors = uniqStrings(artistValues);

    if (authors.length === 0 && rawTitle.includes(" - ")) {
      const [artistPart, ...titleParts] = rawTitle.split(" - ");
      authors = [artistPart.trim()];
      displayTitle = titleParts.join(" - ").trim();
    }

    out.push({
      source: "discogs",
      object_type: "music",
      source_type: "discogs",
      source_url: uri ? `https://www.discogs.com${uri}` : null,
      external_source_ids: {
        discogs_id: row?.id ? String(row.id) : null,
        discogs_master_id: row?.master_id ? String(row.master_id) : null
      },
      title: displayTitle || null,
      authors: authors,
      publisher: labelValues[0] ?? null,
      publish_date: year ? `${year}-01-01` : null,
      publish_year: year,
      description: null,
      subjects: uniqStrings([...genreValues, ...styleValues]),
      isbn10: null,
      isbn13: null,
      cover_url: thumb || null,
      music_metadata: {
        primary_artist: authors[0] ?? null,
        label: labelValues[0] ?? null,
        release_date: year ? `${year}-01-01` : null,
        original_release_year: year ? String(year) : null,
        format: mapDiscogsFormat(formatValues),
        release_type: mapDiscogsReleaseType(formatValues),
        edition_pressing: null,
        catalog_number: catno,
        barcode,
        country: null,
        genres: uniqStrings(genreValues),
        styles: uniqStrings(styleValues),
        tracklist: [],
        discogs_id: row?.id ? String(row.id) : null,
        musicbrainz_id: null,
        speed: mapDiscogsSpeed(formatValues),
        disc_count: null,
        color_variant: null,
        limited_edition: null,
        reissue: null,
        channels: mapDiscogsChannels(formatValues),
        packaging_type: formatValues.find((value: string) => /gatefold|digipak|box set|sleeve|jewel case/i.test(value)) ?? null,
        track_count: null
      },
      contributor_entities: authors.length > 0 ? { performer: authors } : null,
      raw: { discogs: row }
    });
  }
  return out;
}

function score(r: SearchResult, title: string | null, author: string | null, barcode: string | null): number {
  let s = 0;
  const t = (r.title ?? "").toLowerCase();
  const titleLc = (title ?? "").toLowerCase();
  const a = (author ?? "").toLowerCase();
  if (barcode) {
    const resultBarcode = normalizeBarcode(String((r.music_metadata as any)?.barcode ?? ""));
    if (resultBarcode && resultBarcode === normalizeBarcode(barcode)) s += 20;
    if (r.object_type === "music") s += 8;
  }
  if (t && titleLc && titleLc === t) s += 8;
  if (t && titleLc && (titleLc.includes(t) || t.includes(titleLc))) s += 4;
  if (a) {
    const authors = (r.authors ?? []).map((x) => x.toLowerCase());
    if (authors.some((x) => x === a)) s += 5;
    if (authors.some((x) => x.includes(a) || a.includes(x))) s += 2;
  }
  if (r.object_type === "music") s += 2;
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
    const key = `${r.object_type}|${(r.title ?? "").toLowerCase()}|${(r.authors ?? []).join(",").toLowerCase()}|${String((r.external_source_ids ?? {}).discogs_id ?? "")}`;
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
  const barcode = normalizeBarcode(searchParams.get("barcode") ?? "");

  if (!title && !barcode) {
    return NextResponse.json({ ok: false, error: "Provide a title or barcode." }, { status: 400 });
  }

  const authorValue = author || null;
  const titleValue = title || null;
  const barcodeValue = barcode.length >= 12 ? barcode : null;

  const tasks: Array<Promise<SearchResult[]>> = [];
  if (titleValue) {
    tasks.push(openLibrarySearch(titleValue, authorValue));
    tasks.push(googleBooksSearch(titleValue, authorValue));
    tasks.push(discogsSearch({ title: titleValue, author: authorValue, barcode: null }));
  } else if (barcodeValue) {
    tasks.push(discogsSearch({ title: null, author: null, barcode: barcodeValue }));
  }

  const settled = await Promise.allSettled(tasks);
  const combined = settled.flatMap((entry) => (entry.status === "fulfilled" ? entry.value : []));
  const ranked = dedupe(combined)
    .map((r) => ({ r, s: score(r, titleValue, authorValue, barcodeValue) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r)
    .slice(0, 12);

  for (const r of ranked) {
    r.authors = uniqStrings(r.authors ?? []);
    r.subjects = uniqStrings(r.subjects ?? []);
  }

  return NextResponse.json({ ok: true, results: ranked });
}
