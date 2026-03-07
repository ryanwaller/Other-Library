import { NextResponse, type NextRequest } from "next/server";
import sizeOf from "image-size";
import { fetchWithSafeRedirects, isSafeHttpUrl } from "../../../lib/networkSafety";
import {
  emptyMusicMetadata,
  normalizeMusicChannels,
  normalizeMusicFormat,
  normalizeMusicReleaseType,
  normalizeMusicSpeed,
  type MusicContributorRole,
  type MusicMetadata,
  type MusicTrack
} from "../../../lib/music";

export const runtime = "nodejs";

type TrimUnit = "in" | "mm";

type ImportMetadata = {
  title: string | null;
  authors: string[];
  editors: string[];
  designers: string[];
  printers: string[];
  publisher: string | null;
  publish_date: string | null; // ISO YYYY-MM-DD when confidently parsed, else null
  description: string | null;
  subjects: string[];
  isbn10: string | null;
  isbn13: string | null;
  cover_url: string | null;
  cover_candidates: string[];
  trim_width: number | null;
  trim_height: number | null;
  trim_unit: TrimUnit | null;
  object_type?: "book" | "music" | null;
  source_type?: string | null;
  source_url?: string | null;
  external_source_ids?: Record<string, string | null> | null;
  music_metadata?: MusicMetadata | null;
  contributor_entities?: Partial<Record<MusicContributorRole, string[]>> | null;
  sources: string[];
  raw: Record<string, unknown>;
};

type DiscogsTrackLike = {
  position?: string | null;
  title?: string | null;
  duration?: string | null;
  type_?: string | null;
  sub_tracks?: DiscogsTrackLike[] | null;
};

type DiscogsReleaseLike = {
  id?: number;
  title?: string;
  artists_sort?: string;
  artists?: Array<{ name?: string | null }>;
  extraartists?: Array<{ name?: string | null; role?: string | null }>;
  labels?: Array<{ name?: string | null; catno?: string | null }>;
  released?: string | null;
  year?: number | null;
  country?: string | null;
  genres?: string[] | null;
  styles?: string[] | null;
  tracklist?: DiscogsTrackLike[];
  formats?: Array<{ name?: string | null; qty?: string | null; descriptions?: string[] | null; text?: string | null }>;
  identifiers?: Array<{ type?: string | null; value?: string | null }>;
  images?: Array<{ uri?: string | null; uri150?: string | null }>;
  notes?: string | null;
  main_release?: number | null;
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

function normalizeHttpsUrl(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://")) return `https://${raw.slice("http://".length)}`;
  return raw;
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

function pickBestIsbn(candidates: string[]): { isbn10: string | null; isbn13: string | null } {
  let isbn13: string | null = null;
  let isbn10: string | null = null;
  for (const c of candidates) {
    if (!c) continue;
    const n = normalizeIsbn(c);
    if (n.length === 13 && isValidIsbn13(n)) {
      isbn13 = isbn13 ?? n;
      console.log(`[isbn] Valid ISBN-13 detected: ${n}`);
    }
    if (n.length === 10 && isValidIsbn10(n)) {
      isbn10 = isbn10 ?? n;
      console.log(`[isbn] Valid ISBN-10 detected: ${n}`);
    }
  }
  if (!isbn13 && isbn10) {
    isbn13 = isbn10ToIsbn13(isbn10);
    if (isbn13) console.log(`[isbn] Derived ISBN-13 from ISBN-10: ${isbn13}`);
  }
  return { isbn10, isbn13 };
}

function parseDimensions(s: string): { trim_width: number | null; trim_height: number | null; trim_unit: TrimUnit | null } {
  const m = s.match(/([\d.]+)\s*[×x]\s*([\d.]+)\s*(cm|mm|in|")?/i);
  if (!m) return { trim_width: null, trim_height: null, trim_unit: null };
  let a = parseFloat(m[1]!);
  let b = parseFloat(m[2]!);
  const unitRaw = (m[3] ?? "").toLowerCase().trim();
  if (isNaN(a) || isNaN(b) || a <= 0 || b <= 0) return { trim_width: null, trim_height: null, trim_unit: null };

  let unit: TrimUnit;
  if (unitRaw === "in" || unitRaw === '"') {
    unit = "in";
  } else {
    // cm → convert to mm; mm → keep as-is; default → assume mm
    if (unitRaw === "cm") {
      a = Math.round(a * 10 * 10) / 10;
      b = Math.round(b * 10 * 10) / 10;
    }
    unit = "mm";
  }

  return { trim_width: Math.min(a, b), trim_height: Math.max(a, b), trim_unit: unit };
}

function extractRolesFromText(text: string | null, pattern: RegExp): string[] {
  if (!text) return [];
  const m = pattern.exec(text);
  if (!m) return [];
  return uniqStrings(
    m[1]!
      .split(/\s*,\s*|\s+and\s+/i)
      .map((s) => s.replace(/\.$/, "").trim())
      .filter(Boolean)
  );
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTitleSuffix(input: string, hostname: string): string {
  let t = input.trim().replace(/\s+/g, " ");
  if (!t) return t;

  const host = hostname.toLowerCase().replace(/^www\./, "");
  const hostLabel = host.split(".")[0] ?? host;
  const hostWords = hostLabel.replace(/[^a-z0-9]+/g, " ").trim();

  // Specifically for Printed Matter
  if (hostLabel === "printedmatter") {
    t = t.replace(/ - Printed Matter$/i, "").replace(/ \| Printed Matter$/i, "").replace(/ Printed Matter$/i, "");
  }

  const candidates = [
    { sep: " | ", preferLeft: true },
    { sep: " — ", preferLeft: true },
    { sep: " – ", preferLeft: true },
    { sep: " - ", preferLeft: true },
    { sep: " · ", preferLeft: true },
    { sep: " : ", preferLeft: true },
    { sep: ": ", preferLeft: true }
  ];

  for (const { sep } of candidates) {
    if (!t.includes(sep)) continue;
    const parts = t.split(sep).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    
    const lastPart = parts[parts.length - 1] ?? "";
    const lastPartLc = lastPart.toLowerCase();
    
    const hostHit =
      (hostWords && lastPartLc.includes(hostWords)) ||
      (hostLabel && lastPartLc.includes(hostLabel)) ||
      lastPartLc.includes(host);
    
    const isCommonSuffix = ["shop", "store", "online", "books", "official site", "catalog", "publisher"].some(s => lastPartLc.includes(s));
    const shortRight = lastPart.length <= 20;
    
    if (hostHit || isCommonSuffix || shortRight) {
      return parts.slice(0, -1).join(sep).trim();
    }
  }

  return t;
}

function looksLikeBookishJsonLd(typesLc: string[]): boolean {
  return (
    typesLc.includes("book") ||
    typesLc.includes("creativework") ||
    typesLc.includes("publicationvolume") ||
    typesLc.includes("bookseries") ||
    typesLc.includes("comicstory") ||
    typesLc.includes("thesis")
  );
}

function looksLikeBoilerplateDescription(desc: string): boolean {
  const d = desc.toLowerCase();
  const bad = [
    "add to cart",
    "in stock",
    "out of stock",
    "free shipping",
    "shipping",
    "returns",
    "privacy policy",
    "terms of service",
    "subscribe to our newsletter",
    "cookie",
    "sign up",
    "checkout"
  ];
  return bad.some((b) => d.includes(b));
}

function normalizeDescription(value: string | null, allowBoilerplate: boolean): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  // Replace multiple horizontal spaces but keep newlines
  let s = raw.replace(/[ \t]+/g, " ");
  // Trim each line and collapse multiple newlines
  s = s.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join("\n\n");
  if (!s) return null;

  // Reject if it looks like a full page text dump
  const paragraphCount = s.split("\n\n").length;
  if (paragraphCount > 15) {
    console.warn(`[scrape] Rejecting description: too many paragraphs (${paragraphCount})`);
    return null;
  }

  if (!allowBoilerplate && looksLikeBoilerplateDescription(s)) {
    console.warn(`[scrape] Rejecting description: looks like boilerplate`);
    return null;
  }
  
  if (s.length > 1500) {
    console.log(`[scrape] Truncating description from ${s.length} to 1500`);
    s = s.slice(0, 1500);
  }
  return s;
}

function parseTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    const key = m[1]!.toLowerCase();
    const value = decodeEntities((m[2] ?? m[3] ?? m[4] ?? "").trim());
    attrs[key] = value;
  }
  return attrs;
}

function extractMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attrs = parseTagAttributes(tag);
    const key = (attrs.property || attrs.name || "").trim();
    const content = (attrs.content || "").trim();
    if (!key || !content) continue;
    meta[key.toLowerCase()] = content;
  }
  return meta;
}

function extractTitleTag(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const t = decodeEntities(m[1] ?? "").trim().replace(/\s+/g, " ");
  return t || null;
}

function extractJsonLdObjects(html: string): any[] {
  const out: any[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(decodeEntities(raw));
      const push = (v: any) => {
        if (!v) return;
        if (Array.isArray(v)) {
          for (const x of v) push(x);
          return;
        }
        if (typeof v === "object") {
          if (Array.isArray((v as any)["@graph"])) {
            for (const x of (v as any)["@graph"]) push(x);
            return;
          }
          out.push(v);
        }
      };
      push(parsed);
    } catch {
      // ignore bad JSON-LD blocks
    }
  }
  return out;
}

function jsonLdType(node: any): string[] {
  const t = node?.["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x: any) => typeof x === "string");
  return [];
}

function pickJsonLdCandidate(nodes: any[]): any | null {
  const scored = nodes
    .map((n) => {
      const types = jsonLdType(n).map((x) => x.toLowerCase());
      let score = 0;
      if (types.includes("book")) score += 10;
      if (types.includes("product")) score += 3;
      if (types.includes("creativework")) score += 2;
      if (typeof n?.name === "string") score += 2;
      if (typeof n?.isbn === "string") score += 2;
      if (n?.author) score += 1;
      if (n?.image) score += 1;
      return { n, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.n ?? null;
}

function normalizeAuthors(value: any): string[] {
  const pushName = (x: any, out: string[]) => {
    if (!x) return;
    if (typeof x === "string") {
      out.push(x);
      return;
    }
    if (typeof x?.name === "string") out.push(String(x.name));
  };

  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const v of value) pushName(v, out);
  } else {
    pushName(value, out);
  }
  return uniqStrings(out);
}

function normalizePublisher(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value?.name === "string") return String(value.name).trim() || null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const p = normalizePublisher(v);
      if (p) return p;
    }
  }
  return null;
}

function normalizeImage(value: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    if (!v) return;
    if (typeof v === "string") out.push(v);
    else if (typeof v?.url === "string") out.push(String(v.url));
  };
  if (Array.isArray(value)) {
    for (const v of value) push(v);
  } else {
    push(value);
  }
  return uniqStrings(out.map((u) => normalizeHttpsUrl(u)).filter(Boolean) as string[]);
}

function normalizeKeywords(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return uniqStrings(value.map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean));
  if (typeof value === "string") {
    return uniqStrings(
      value
        .split(/[,;|]/g)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  return [];
}

function extractLikelyIsbnsFromHtml(html: string): string[] {
  const out: string[] = [];

  // Prefer patterns that are explicitly labeled.
  const labeled = html.match(/isbn(?:-?1[03])?[^0-9X]{0,20}([0-9X][0-9X\- ]{8,20}[0-9X])/gi) ?? [];
  for (const m of labeled) {
    const digits = normalizeIsbn(m.replace(/.*?([0-9X][0-9X\- ]{8,20}[0-9X]).*/i, "$1"));
    if (digits.length === 10 || digits.length === 13) out.push(digits);
  }

  // Common GTIN/EAN-13 for products.
  const gtin = html.match(/\b(?:gtin13|ean13|ean|upc)[^0-9]{0,20}(\d{13})\b/gi) ?? [];
  for (const m of gtin) {
    const digits = normalizeIsbn(m.replace(/.*?(\d{13}).*/i, "$1"));
    if (digits.length === 13) out.push(digits);
  }

  return uniqStrings(out);
}

// --- Printed Matter scraper ---

function scrapePrintedMatter(html: string): Partial<ImportMetadata> {
  // Title: first <h1>
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = h1Match ? decodeEntities(h1Match[1]!.replace(/<[^>]+>/g, "").trim()) : null;

  // Authors: linked names appearing before the <h1> in the DOM
  const h1Pos = h1Match?.index ?? html.length;
  const beforeH1 = html.slice(0, h1Pos);
  // Look for a cluster of <a> tags near the h1, strip nav/header noise
  // Try to find a wrapper element containing artist links
  const artistBlockRe = /<(?:p|div|ul|span|h2|h3)[^>]*>((?:\s*(?:<li[^>]*>)?\s*<a\b[^>]*>[^<]+<\/a>\s*(?:<\/li>)?\s*,?\s*(?:and\s*)?)+)<\/(?:p|div|ul|span|h2|h3)>/gi;
  let artistBlockMatch: RegExpExecArray | null = null;
  let bestBlock = "";
  let m: RegExpExecArray | null;
  // Find the last matching block before h1 — closest to the title
  const aBlockRe = new RegExp(artistBlockRe.source, "gi");
  while ((m = aBlockRe.exec(beforeH1))) {
    bestBlock = m[1]!;
    artistBlockMatch = m;
  }
  let authors: string[] = [];
  if (bestBlock) {
    const aRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
    let aM: RegExpExecArray | null;
    while ((aM = aRe.exec(bestBlock))) {
      const name = decodeEntities(aM[1]!.replace(/<[^>]+>/g, "").trim());
      if (name && name.length < 80) authors.push(name);
    }
  }
  // Fallback: if no block found, find the last few <a> tags immediately before h1
  if (authors.length === 0) {
    const tailLinks = beforeH1.match(/<a\b[^>]*>([^<]{2,60})<\/a>/gi) ?? [];
    // Take the last 1–4 links as likely artist credits
    const lastLinks = tailLinks.slice(-4);
    for (const link of lastLinks) {
      const aM = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(link);
      if (aM) {
        const name = decodeEntities(aM[1]!.replace(/<[^>]+>/g, "").trim());
        if (name && name.length < 80) authors.push(name);
      }
    }
  }
  authors = uniqStrings(authors);

  // Metadata from definition list (<dt>/<dd>) or labeled list items
  const listItems: Record<string, string> = {};

  // Try <dt>/<dd> pairs first
  const dtddRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let dtM: RegExpExecArray | null;
  while ((dtM = dtddRe.exec(html))) {
    const key = decodeEntities(dtM[1]!.replace(/<[^>]+>/g, "").trim()).toLowerCase().replace(/\s+/g, " ");
    const val = decodeEntities(dtM[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (key && val) listItems[key] = val;
  }

  // Fallback: <li><strong>Label</strong>: Value</li> or <li><span>Label</span>Value</li>
  if (Object.keys(listItems).length === 0) {
    const liRe = /<li[^>]*>\s*<(?:strong|b|span)[^>]*>([\s\S]*?)<\/(?:strong|b|span)>:?\s*([\s\S]*?)\s*<\/li>/gi;
    let liM: RegExpExecArray | null;
    while ((liM = liRe.exec(html))) {
      const key = decodeEntities(liM[1]!.replace(/<[^>]+>/g, "").trim()).toLowerCase();
      const val = decodeEntities(liM[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (key && val) listItems[key] = val;
    }
  }

  // Also try "Label: Value" text patterns in the page if still empty
  if (Object.keys(listItems).length === 0) {
    const labeledRe = /\b(Publisher|Year|Pages?|Dimensions?|ISBN(?:-?1[03])?|Edition)\s*:?\s*([^\n<]{2,100})/gi;
    let lM: RegExpExecArray | null;
    const stripped = html.replace(/<[^>]+>/g, " ");
    while ((lM = labeledRe.exec(stripped))) {
      const key = lM[1]!.trim().toLowerCase();
      const val = lM[2]!.trim();
      if (key && val && !listItems[key]) listItems[key] = val;
    }
  }

  const publisher = listItems["publisher"] ?? null;

  // Year: can be "year", "date", "publish date"
  const yearStr = (listItems["year"] ?? listItems["date"] ?? listItems["publish date"] ?? "").trim();
  const publish_date = yearStr ? parseDateToIso(yearStr) : null;

  // Pages: strip " p." or "pages" suffix
  const pagesStr = (listItems["pages"] ?? listItems["page"] ?? "").replace(/\s*pp?\.?/i, "").trim();
  const pagesNum = pagesStr ? parseInt(pagesStr, 10) : null;
  void pagesNum; // available but not in ImportMetadata currently

  // Dimensions
  const dimsStr = listItems["dimensions"] ?? listItems["dimension"] ?? listItems["size"] ?? listItems["format"] ?? "";
  const dims = dimsStr ? parseDimensions(dimsStr) : { trim_width: null, trim_height: null, trim_unit: null as TrimUnit | null };

  // ISBN: try several label variants
  const isbnStr = listItems["isbn"] ?? listItems["isbn-13"] ?? listItems["isbn-10"] ?? listItems["isbn13"] ?? listItems["isbn10"] ?? "";
  const pickedIsbn = pickBestIsbn([isbnStr, ...extractLikelyIsbnsFromHtml(html.slice(0, 10000))]);

  // Cover image: prefer cloudfront.net (Printed Matter's CDN), then any product image
  const cloudfrontMatch = /<img\b[^>]+src="(https:\/\/[^"]*cloudfront\.net[^"]*)"[^>]*>/i.exec(html);
  const anyImgMatch = !cloudfrontMatch
    ? /<img\b[^>]+src="([^"]*\.(?:jpg|jpeg|png|webp))(?:\?[^"]*)?"/i.exec(html)
    : null;
  const cover_url = normalizeHttpsUrl(cloudfrontMatch?.[1] ?? anyImgMatch?.[1] ?? null);

  // Description: search for common content containers
  let description: string | null = null;
  const descCandidates = [
    /<div\b[^>]+class="[^"]*product-description[^"]*"[^>]*>([\s\S]+?)<\/div>/i,
    /<div\b[^>]+class="[^"]*product-details[^"]*"[^>]*>([\s\S]+?)<\/div>/i,
    /<div\b[^>]+id="[^"]*description[^"]*"[^>]*>([\s\S]+?)<\/div>/i,
    /<article\b[^>]*>([\s\S]+?)<\/article>/i
  ];

  for (const re of descCandidates) {
    const match = re.exec(html);
    if (match) {
      const content = match[1]!;
      // More aggressive HTML tag removal while preserving structure if possible
      const cleaned = decodeEntities(content.replace(/<[^>]+>/g, "\n").replace(/[ \t]+/g, " ").trim());
      if (cleaned.length > 50) {
        description = normalizeDescription(cleaned, false);
        if (description) break;
      }
    }
  }

  // Fallback: text block after the last <hr> near the bottom of the page
  if (!description) {
    const hrIdx = html.lastIndexOf("<hr");
    if (hrIdx !== -1) {
      const afterHr = html.slice(hrIdx);
      // Capture everything after HR instead of just one block
      const fullRest = decodeEntities(afterHr.replace(/<[^>]+>/g, "\n").replace(/[ \t]+/g, " ").trim());
      if (fullRest.length > 20) {
        description = normalizeDescription(fullRest, false);
      }
    }
  }

  // Extract credited roles from description text - use more robust matching
  const editors = extractRolesFromText(description, /[Ee]dited\s+by\s+([^.;\n\r]+)/);
  const designers = extractRolesFromText(description, /[Dd]esigned?\s+by\s+([^.;\n\r]+)/);
  const printers = extractRolesFromText(description, /[Pp]rinted\s+by\s+([^.;\n\r]+)/);

  return {
    title,
    authors,
    editors,
    designers,
    printers,
    publisher,
    publish_date,
    description,
    isbn10: pickedIsbn.isbn10,
    isbn13: pickedIsbn.isbn13,
    cover_url,
    cover_candidates: cover_url ? [cover_url] : [],
    trim_width: dims.trim_width,
    trim_height: dims.trim_height,
    trim_unit: dims.trim_unit,
    raw: { printedMatter: { listItems, dimsStr, yearStr, isbnStr } }
  };
}

// --- AbeBooks ISBN extraction ---

function extractIsbnFromAbeUrl(url: URL): string | null {
  // Pattern: /book-search/isbn/9781234567890/ or /9781234567890/title
  const pathMatch = url.pathname.match(/\/(\d{13}|\d{10})\b/);
  if (pathMatch) return pathMatch[1]!;
  // Query param fallback
  const qIsbn = url.searchParams.get("isbn");
  if (qIsbn) return qIsbn;
  return null;
}

function extractIsbnFromPrintedMatterUrl(url: URL): string | null {
  // Pattern: /tables/9781234567890 (not a real PM pattern but for consistency)
  const pathMatch = url.pathname.match(/\/(\d{13}|\d{10})\b/);
  if (pathMatch) return pathMatch[1]!;
  return null;
}

// --- Generic helpers ---

function mergePreferBase(base: ImportMetadata, next: Partial<ImportMetadata>, sourceName: string): ImportMetadata {
  const merged: ImportMetadata = { ...base };
  merged.sources = [...new Set([...(base.sources ?? []), sourceName, ...((next.sources as any) ?? [])])];
  merged.raw = { ...(base.raw ?? {}), ...(next.raw ?? {}) };

  const pick = <K extends keyof ImportMetadata>(k: K) => {
    const current = merged[k];
    const incoming = next[k];
    const empty =
      current === undefined ||
      current === null ||
      (typeof current === "string" && current.trim() === "") ||
      (Array.isArray(current) && current.length === 0);
    if (empty && incoming !== undefined) merged[k] = incoming as ImportMetadata[K];
  };

  pick("title");
  pick("publisher");
  pick("publish_date");
  pick("description");
  pick("isbn10");
  pick("isbn13");
  pick("cover_url");
  pick("trim_width");
  pick("trim_height");
  pick("trim_unit");

  merged.authors = uniqStrings([...(base.authors ?? []), ...(((next.authors as any) ?? []) as string[])]);
  merged.editors = uniqStrings([...(base.editors ?? []), ...(((next.editors as any) ?? []) as string[])]);
  merged.designers = uniqStrings([...(base.designers ?? []), ...(((next.designers as any) ?? []) as string[])]);
  merged.printers = uniqStrings([...(base.printers ?? []), ...(((next.printers as any) ?? []) as string[])]);
  merged.subjects = uniqStrings([...(base.subjects ?? []), ...(((next.subjects as any) ?? []) as string[])]);
  merged.cover_candidates = uniqStrings([...(base.cover_candidates ?? []), ...(((next.cover_candidates as any) ?? []) as string[])]);

  return merged;
}

function detectDomainKind(hostname: string): string {
  const h = hostname.toLowerCase();
  if (h === "amazon.com" || h.endsWith(".amazon.com")) return "amazon";
  if (h === "bookshop.org" || h.endsWith(".bookshop.org")) return "bookshop";
  if (h.endsWith(".myshopify.com") || h.includes("shopify")) return "shopify";
  if (h === "books.google.com") return "googlebooks";
  if (h === "printedmatter.org" || h.endsWith(".printedmatter.org")) return "printedmatter";
  if (h === "abebooks.com" || h.endsWith(".abebooks.com")) return "abebooks";
  if (h === "discogs.com" || h.endsWith(".discogs.com")) return "discogs";
  return "generic";
}

function parseDiscogsTarget(url: URL): { kind: "release" | "master"; id: string } | null {
  const match = url.pathname.match(/\/(release|master)\/(\d+)/i);
  if (!match?.[1] || !match?.[2]) return null;
  const kind = match[1].toLowerCase();
  if (kind !== "release" && kind !== "master") return null;
  return { kind, id: match[2] };
}

function roleFromDiscogs(input: string): MusicContributorRole | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("art direction")) return "art direction";
  if (value === "artist" || value.includes("artwork")) return "artwork";
  if (value.includes("designer") || value.includes("designed by") || value.includes("design by") || value === "design") return "designer";
  if (value.includes("featuring") || value.includes("featured")) return "featured artist";
  if (value.includes("mastered")) return "mastering";
  if (value.includes("engineer")) return "engineer";
  if (value.includes("producer")) return "producer";
  if (value.includes("composed") || value.includes("composer")) return "composer";
  if (value.includes("arranged") || value.includes("arranger")) return "arranger";
  if (value.includes("conducted") || value.includes("conductor")) return "conductor";
  if (value.includes("orchestra")) return "orchestra";
  if (value.includes("photo")) return "photography";
  if (value.includes("perform") || value.includes("vocals") || value.includes("guitar") || value.includes("drums") || value.includes("bass")) return "performer";
  return null;
}

function flattenDiscogsTracklist(rows: DiscogsTrackLike[] | null | undefined): MusicTrack[] {
  const out: MusicTrack[] = [];
  const walk = (track: DiscogsTrackLike | null | undefined) => {
    if (!track) return;
    const type = String(track.type_ ?? "").trim() || null;
    const title = String(track.title ?? "").trim();
    const position = String(track.position ?? "").trim() || null;
    const duration = String(track.duration ?? "").trim() || null;
    const subTracks = Array.isArray(track.sub_tracks) ? track.sub_tracks : [];
    if (title && type !== "heading" && type !== "index") {
      out.push({ position, title, duration, type });
    }
    for (const subTrack of subTracks) walk(subTrack);
  };
  for (const row of rows ?? []) walk(row);
  return out;
}

function parseDiscogsReleaseDate(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  return parseDateToIso(raw);
}

function collectDiscogsContributorEntities(data: DiscogsReleaseLike): Partial<Record<MusicContributorRole, string[]>> {
  const next: Partial<Record<MusicContributorRole, string[]>> = {};
  for (const row of data.extraartists ?? []) {
    const name = String(row?.name ?? "").replace(/\s+\(\d+\)$/, "").trim();
    const role = roleFromDiscogs(String(row?.role ?? ""));
    if (!name || !role) continue;
    const existing = next[role] ?? [];
    if (!existing.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
      next[role] = [...existing, name];
    }
  }
  return next;
}

function normalizeDiscogsParts(values: Array<string | null | undefined>): string[] {
  return uniqStrings(values.map((value) => String(value ?? "").trim()).filter(Boolean));
}

function pickDiscogsMatch(values: string[], pattern: RegExp): string | null {
  return values.find((value) => pattern.test(value)) ?? null;
}

function deriveDiscogsFormat(source: DiscogsReleaseLike): string | null {
  const candidates = normalizeDiscogsParts([
    ...(source.formats ?? []).map((format) => format?.name),
    ...(source.formats ?? []).flatMap((format) => format?.descriptions ?? []),
    ...(source.formats ?? []).map((format) => format?.text)
  ]);
  for (const value of candidates) {
    const normalized = normalizeMusicFormat(value);
    if (normalized) return normalized;
  }
  return null;
}

function deriveDiscogsPressing(source: DiscogsReleaseLike): string | null {
  const formatDescriptions = normalizeDiscogsParts((source.formats ?? []).flatMap((format) => format?.descriptions ?? []));
  const formatTexts = normalizeDiscogsParts((source.formats ?? []).map((format) => format?.text));
  const notes = String(source.notes ?? "").trim();
  const detailBits = uniqStrings([
    ...formatTexts,
    ...formatDescriptions.filter((value) =>
      /test pressing|promo|white label|numbered|special edition|club edition|limited edition|reissue|repress|remaster|unofficial|mispress|first pressing|second pressing/i.test(value)
    )
  ]);
  if (detailBits.length > 0) return detailBits.join(", ");
  return notes || null;
}

function deriveDiscogsReleaseType(source: DiscogsReleaseLike): string | null {
  const candidates = normalizeDiscogsParts([
    ...(source.formats ?? []).flatMap((format) => format?.descriptions ?? []),
    ...(source.formats ?? []).map((format) => format?.text),
    String(source.title ?? "")
  ]);
  for (const value of candidates) {
    const normalized = normalizeMusicReleaseType(value);
    if (normalized) return normalized;
  }
  return null;
}

function buildDiscogsMusicMetadata(source: DiscogsReleaseLike, primaryArtist: string): MusicMetadata {
  const base = emptyMusicMetadata();
  const label = String(source.labels?.[0]?.name ?? "").trim() || null;
  const catalogNumber = String(source.labels?.[0]?.catno ?? "").trim() || null;
  const releaseDate = parseDiscogsReleaseDate(source.released ?? (source.year ? String(source.year) : null));
  const year = source.year ? String(source.year) : null;
  const formatDescriptions = normalizeDiscogsParts((source.formats ?? []).flatMap((format) => format?.descriptions ?? []));
  const formatTexts = normalizeDiscogsParts((source.formats ?? []).map((format) => format?.text));
  const formatText = deriveDiscogsFormat(source);
  const packagingType =
    pickDiscogsMatch([...formatDescriptions, ...formatTexts], /gatefold|digipak|sleeve|box set|jewel case|keep case|wallet|gatefold sleeve/i);
  const speed = pickDiscogsMatch([...formatDescriptions, ...formatTexts], /\d{2}(?:\s?1\/3)?\s?rpm/i);
  const barcode =
    (source.identifiers ?? [])
      .find((identifier) => /barcode|ean|upc/i.test(String(identifier?.type ?? "")))
      ?.value?.replace(/\s+/g, " ").trim() ?? null;
  const musicbrainzId =
    (source.identifiers ?? [])
      .find((identifier) => /musicbrainz/i.test(String(identifier?.type ?? "")))
      ?.value?.trim() ?? null;
  const tracklist = flattenDiscogsTracklist(source.tracklist);
  const discCount = (source.formats ?? [])
    .map((format) => Number(format?.qty ?? ""))
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((sum, value) => sum + value, 0);
  const releaseHints = [...formatDescriptions, ...formatTexts, String(source.notes ?? "").trim()].filter(Boolean);
  return {
    ...base,
    primary_artist: primaryArtist || null,
    label,
    release_date: releaseDate,
    original_release_year: year,
    format: formatText,
    release_type: deriveDiscogsReleaseType(source),
    edition_pressing: deriveDiscogsPressing(source),
    catalog_number: catalogNumber,
    barcode,
    country: String(source.country ?? "").trim() || null,
    genres: uniqStrings(source.genres ?? []),
    styles: uniqStrings(source.styles ?? []),
    tracklist,
    discogs_id: source.id ? String(source.id) : null,
    musicbrainz_id: musicbrainzId,
    speed: normalizeMusicSpeed(speed),
    disc_count: discCount > 0 ? discCount : null,
    color_variant: pickDiscogsMatch(releaseHints, /color|colou?r|clear|opaque|marbled|splatter|translucent|smoke|swirl/i),
    limited_edition: releaseHints.some((value) => /limited|numbered/i.test(value)) ? true : null,
    reissue: releaseHints.some((value) => /reissue|repress|remaster/i.test(value))
      ? true
      : releaseHints.some((value) => /original/i.test(value))
        ? false
        : null,
    channels: normalizeMusicChannels(pickDiscogsMatch(releaseHints, /mono|stereo|both/i)),
    packaging_type: packagingType,
    track_count: tracklist.length || null
  };
}

async function fetchDiscogsPreview(url: URL): Promise<ImportMetadata | null> {
  const target = parseDiscogsTarget(url);
  if (!target) return null;

  const endpoint = `https://api.discogs.com/${target.kind === "release" ? "releases" : "masters"}/${target.id}`;
  const baseRes = await fetch(endpoint, { headers: { "User-Agent": USER_AGENT } });
  if (!baseRes.ok) {
    throw new Error(`Discogs lookup failed (${baseRes.status})`);
  }
  let data = (await baseRes.json()) as DiscogsReleaseLike;

  if (target.kind === "master" && Number(data.main_release)) {
    const releaseRes = await fetch(`https://api.discogs.com/releases/${data.main_release}`, { headers: { "User-Agent": USER_AGENT } });
    if (releaseRes.ok) {
      const release = (await releaseRes.json()) as DiscogsReleaseLike;
      data = {
        ...data,
        ...release,
        tracklist: Array.isArray(release.tracklist) && release.tracklist.length > 0 ? release.tracklist : data.tracklist,
        year: data.year ?? release.year ?? null
      };
    }
  }

  const artists = uniqStrings([
    String(data.artists_sort ?? "").trim(),
    ...((data.artists ?? []).map((artist) => String(artist?.name ?? "").replace(/\s+\(\d+\)$/, "").trim()))
  ]);
  const primaryArtist = artists[0] ?? "";
  const musicMetadata = buildDiscogsMusicMetadata(data, primaryArtist);
  const contributorEntities = collectDiscogsContributorEntities(data);
  if (primaryArtist) {
    contributorEntities.performer = uniqStrings([primaryArtist, ...(contributorEntities.performer ?? [])]);
  }
  const coverCandidates = uniqStrings(
    (data.images ?? []).flatMap((image) => [normalizeHttpsUrl(image?.uri), normalizeHttpsUrl(image?.uri150)]).filter(Boolean) as string[]
  );

  return {
    ...makeEmpty(),
    object_type: "music",
    source_type: "discogs",
    source_url: url.toString(),
    external_source_ids: {
      discogs_id: musicMetadata.discogs_id,
      discogs_kind: target.kind
    },
    title: String(data.title ?? "").trim() || null,
    authors: primaryArtist ? [primaryArtist] : [],
    publisher: musicMetadata.label,
    publish_date: musicMetadata.release_date,
    description: null,
    subjects: uniqStrings([...(musicMetadata.genres ?? []), ...(musicMetadata.styles ?? [])]),
    cover_url: coverCandidates[0] ?? null,
    cover_candidates: coverCandidates,
    music_metadata: musicMetadata,
    contributor_entities: contributorEntities,
    sources: ["discogs"],
    raw: {
      discogs: data
    }
  };
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  // Option A: Full browser-like headers
  const browserHeaders = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": "https://www.google.com/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Upgrade-Insecure-Requests": "1"
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  
  try {
    console.log(`[fetch] Trying Option A (browser headers) for ${url}`);
    const { response: res, finalUrl } = await fetchWithSafeRedirects(
      url,
      {
        headers: browserHeaders,
        signal: controller.signal
      },
      5
    );

    if (res.ok) {
      console.log(`[fetch] Option A succeeded for ${url}`);
      const txt = await res.text();
      const html = txt.length > 2_000_000 ? txt.slice(0, 2_000_000) : txt;
      return { html, finalUrl };
    }

    if (res.status === 403) {
      console.warn(`[fetch] Option A failed with 403 for ${url}`);
    } else {
      throw new Error(`Fetch failed (${res.status})`);
    }
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.warn(`[fetch] Option A timed out for ${url}`);
    } else {
      console.error(`[fetch] Option A error for ${url}:`, e.message);
    }
  } finally {
    clearTimeout(t);
  }

  // Option B: Scraping Proxy (AllOrigins)
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const proxyController = new AbortController();
  const pt = setTimeout(() => proxyController.abort(), 12000);

  try {
    console.log(`[fetch] Trying Option B (AllOrigins proxy) for ${url}`);
    const res = await fetch(proxyUrl, { signal: proxyController.signal });
    if (!res.ok) throw new Error(`Proxy failed (${res.status})`);
    
    const json = await res.json();
    const html = String(json?.contents ?? "");
    if (!html || html.length < 100) throw new Error("Empty proxy response");

    console.log(`[fetch] Option B succeeded for ${url}`);
    return { 
      html: html.length > 2_000_000 ? html.slice(0, 2_000_000) : html,
      finalUrl: url 
    };
  } catch (e: any) {
    console.error(`[fetch] Option B failed for ${url}:`, e.message);
    throw e;
  } finally {
    clearTimeout(pt);
  }
}

async function tryIsbnEnrichment(req: NextRequest, isbn13Or10: string | null): Promise<any | null> {
  const value = (isbn13Or10 ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(req.url);
    url.pathname = "/api/isbn";
    url.search = `?isbn=${encodeURIComponent(value)}`;
    const res = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
    const json = await res.json();
    if (!res.ok || !json?.ok) return null;
    return json.edition ?? null;
  } catch {
    return null;
  }
}

function makeEmpty(): ImportMetadata {
  return {
    title: null,
    authors: [],
    editors: [],
    designers: [],
    printers: [],
    publisher: null,
    publish_date: null,
    description: null,
    subjects: [],
    isbn10: null,
    isbn13: null,
    cover_url: null,
    cover_candidates: [],
    trim_width: null,
    trim_height: null,
    trim_unit: null,
    object_type: "book",
    source_type: null,
    source_url: null,
    external_source_ids: null,
    music_metadata: null,
    contributor_entities: null,
    sources: [],
    raw: {}
  };
}

async function validateCoverUrl(url: string | null | undefined): Promise<string | null> {
  const normalized = normalizeHttpsUrl(url);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (!isSafeHttpUrl(parsed)) return null;
    const { response: res } = await fetchWithSafeRedirects(
      parsed,
      {
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(5000)
      },
      3
    );
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

export async function POST(req: NextRequest) {
  let urlValue = "";
  try {
    const body = (await req.json()) as any;
    urlValue = String(body?.url ?? "").trim();
  } catch {
    urlValue = "";
  }

  if (!urlValue) {
    return NextResponse.json({ ok: false, error: "Provide a URL." }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid URL." }, { status: 400 });
  }

  if (!isSafeHttpUrl(parsed)) {
    return NextResponse.json({ ok: false, error: "That host is not allowed." }, { status: 400 });
  }

  const domainKind = detectDomainKind(parsed.hostname);

  if (domainKind === "discogs") {
    try {
      const preview = await fetchDiscogsPreview(parsed);
      if (!preview) {
        return NextResponse.json({ ok: false, error: "Unsupported Discogs URL." }, { status: 400 });
      }
      const validCandidates = (await Promise.all(preview.cover_candidates.map((url) => validateCoverUrl(url)))).filter(Boolean) as string[];
      preview.cover_candidates = validCandidates;
      preview.cover_url = validCandidates[0] ?? null;
      return NextResponse.json({
        ok: true,
        domain: parsed.hostname,
        domain_kind: domainKind,
        final_url: parsed.toString(),
        scraped: preview,
        preview
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? "Discogs import failed" }, { status: 400 });
    }
  }

  // AbeBooks: try ISBN from URL before fetching (fetch often fails due to bot protection)
  if (domainKind === "abebooks") {
    const isbnFromUrl = extractIsbnFromAbeUrl(parsed);
    if (isbnFromUrl) {
      const edition = await tryIsbnEnrichment(req, isbnFromUrl);
      if (edition && typeof edition === "object") {
        const preview: ImportMetadata = mergePreferBase(makeEmpty(), {
          title: typeof edition.title === "string" ? edition.title : null,
          authors: Array.isArray(edition.authors) ? edition.authors : [],
          publisher: typeof edition.publisher === "string" ? edition.publisher : null,
          publish_date: typeof edition.publish_date === "string" ? edition.publish_date : null,
          description: typeof edition.description === "string" ? edition.description : null,
          subjects: Array.isArray(edition.subjects) ? edition.subjects : [],
          isbn10: typeof edition.isbn10 === "string" ? edition.isbn10 : null,
          isbn13: typeof edition.isbn13 === "string" ? edition.isbn13 : null,
          cover_url: normalizeHttpsUrl(edition.cover_url),
          cover_candidates: [normalizeHttpsUrl(edition.cover_url)].filter(Boolean) as string[],
          raw: { isbnEdition: edition }
        }, "isbn");
        return NextResponse.json({
          ok: true,
          domain: parsed.hostname,
          domain_kind: domainKind,
          final_url: urlValue,
          scraped: preview,
          isbn_edition: edition,
          preview
        });
      }
    }
    // Try fetching, but if it fails fall through to the message
  }

  let html = "";
  let finalUrl = urlValue;
  try {
    const fetched = await fetchHtml(parsed.toString());
    html = fetched.html;
    finalUrl = fetched.finalUrl;
  } catch (e: any) {
    // Option C: ISBN extraction and fallback
    console.warn(`[fetch] All fetch options failed for ${urlValue}. Trying Option C (ISBN fallback).`);
    const isbnFromUrl = domainKind === "abebooks" ? extractIsbnFromAbeUrl(parsed) : extractIsbnFromPrintedMatterUrl(parsed);
    if (isbnFromUrl) {
      const edition = await tryIsbnEnrichment(req, isbnFromUrl);
      if (edition && typeof edition === "object") {
        const preview: ImportMetadata = mergePreferBase(makeEmpty(), {
          title: typeof edition.title === "string" ? edition.title : null,
          authors: Array.isArray(edition.authors) ? edition.authors : [],
          publisher: typeof edition.publisher === "string" ? edition.publisher : null,
          publish_date: typeof edition.publish_date === "string" ? edition.publish_date : null,
          description: typeof edition.description === "string" ? edition.description : null,
          subjects: Array.isArray(edition.subjects) ? edition.subjects : [],
          isbn10: typeof edition.isbn10 === "string" ? edition.isbn10 : null,
          isbn13: typeof edition.isbn13 === "string" ? edition.isbn13 : null,
          cover_url: normalizeHttpsUrl(edition.cover_url),
          cover_candidates: [normalizeHttpsUrl(edition.cover_url)].filter(Boolean) as string[],
          raw: { isbnEdition: edition, fallback: true }
        }, "isbn");
        
        console.log(`[fetch] Option C succeeded for ${urlValue} (found ISBN ${isbnFromUrl})`);
        return NextResponse.json({
          ok: true,
          domain: parsed.hostname,
          domain_kind: domainKind,
          final_url: urlValue,
          scraped: preview,
          isbn_edition: edition,
          preview,
          info: "Direct scrape failed but ISBN data was found."
        });
      }
    }

    // AbeBooks fetch failure: return helpful message
    if (domainKind === "abebooks") {
      return NextResponse.json(
        { ok: false, error: "AbeBooks pages can't be scraped directly — paste the ISBN instead" },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: false, error: e?.message ?? "Fetch failed" }, { status: 400 });
  }

  // --- Domain-specific scraping ---

  if (domainKind === "printedmatter") {
    const pmScraped = scrapePrintedMatter(html);
    let scraped = mergePreferBase(makeEmpty(), pmScraped, "printedmatter");

    // If ISBN found, enrich with authoritative sources
    const isbnForLookup = scraped.isbn13 ?? scraped.isbn10 ?? null;
    const isbnEdition = await tryIsbnEnrichment(req, isbnForLookup);

    let merged = scraped;
    if (isbnEdition && typeof isbnEdition === "object") {
      const editionAsImport: Partial<ImportMetadata> = {
        title: typeof (isbnEdition as any).title === "string" ? String((isbnEdition as any).title) : null,
        authors: Array.isArray((isbnEdition as any).authors) ? (isbnEdition as any).authors : [],
        publisher: typeof (isbnEdition as any).publisher === "string" ? String((isbnEdition as any).publisher) : null,
        publish_date: typeof (isbnEdition as any).publish_date === "string" ? String((isbnEdition as any).publish_date) : null,
        description: typeof (isbnEdition as any).description === "string" ? String((isbnEdition as any).description) : null,
        subjects: Array.isArray((isbnEdition as any).subjects) ? (isbnEdition as any).subjects : [],
        isbn10: typeof (isbnEdition as any).isbn10 === "string" ? String((isbnEdition as any).isbn10) : null,
        isbn13: typeof (isbnEdition as any).isbn13 === "string" ? String((isbnEdition as any).isbn13) : null,
        cover_url: normalizeHttpsUrl((isbnEdition as any).cover_url),
        cover_candidates: [normalizeHttpsUrl((isbnEdition as any).cover_url), ...scraped.cover_candidates].filter(Boolean) as string[],
        raw: { isbnEdition }
      };
      // Prefer scraped (Printed Matter data is more authoritative for PM-specific fields);
      // fill any missing values from ISBN lookup
      merged = mergePreferBase(makeEmpty(), scraped, "printedmatter");
      merged = mergePreferBase(merged, editionAsImport, "isbn");
      // Prefer Printed Matter's own cover
      if (scraped.cover_url) {
        merged.cover_url = scraped.cover_url;
        merged.cover_candidates = uniqStrings([scraped.cover_url, ...((isbnEdition as any).cover_url ? [normalizeHttpsUrl((isbnEdition as any).cover_url)!] : [])]);
      }
    }

    return NextResponse.json({
      ok: true,
      domain: parsed.hostname,
      domain_kind: domainKind,
      final_url: finalUrl,
      scraped,
      isbn_edition: isbnEdition,
      preview: merged
    });
  }

  // --- AbeBooks: try ISBN from fetched HTML ---
  if (domainKind === "abebooks") {
    const meta = extractMeta(html);
    const isbnCandidates = uniqStrings([
      meta["isbn"],
      meta["product:isbn"],
      meta["books:isbn"],
      ...extractLikelyIsbnsFromHtml(html)
    ]);
    const picked = pickBestIsbn(isbnCandidates);
    const isbnFound = picked.isbn13 ?? picked.isbn10 ?? null;
    if (isbnFound) {
      const edition = await tryIsbnEnrichment(req, isbnFound);
      if (edition && typeof edition === "object") {
        const preview: ImportMetadata = mergePreferBase(makeEmpty(), {
          title: typeof edition.title === "string" ? edition.title : null,
          authors: Array.isArray(edition.authors) ? edition.authors : [],
          publisher: typeof edition.publisher === "string" ? edition.publisher : null,
          publish_date: typeof edition.publish_date === "string" ? edition.publish_date : null,
          description: typeof edition.description === "string" ? edition.description : null,
          subjects: Array.isArray(edition.subjects) ? edition.subjects : [],
          isbn10: typeof edition.isbn10 === "string" ? edition.isbn10 : null,
          isbn13: typeof edition.isbn13 === "string" ? edition.isbn13 : null,
          cover_url: normalizeHttpsUrl(edition.cover_url),
          cover_candidates: [normalizeHttpsUrl(edition.cover_url)].filter(Boolean) as string[],
          raw: { isbnEdition: edition }
        }, "isbn");
        return NextResponse.json({
          ok: true,
          domain: parsed.hostname,
          domain_kind: domainKind,
          final_url: finalUrl,
          scraped: preview,
          isbn_edition: edition,
          preview
        });
      }
    }
    return NextResponse.json(
      { ok: false, error: "AbeBooks pages can't be scraped directly — paste the ISBN instead" },
      { status: 400 }
    );
  }

  // --- Generic scraping (all other domains) ---

  const meta = extractMeta(html);
  const jsonldNodes = extractJsonLdObjects(html);
  const jsonld = pickJsonLdCandidate(jsonldNodes);

  const typesLc = jsonLdType(jsonld).map((x) => x.toLowerCase());
  const bookish = looksLikeBookishJsonLd(typesLc);

  const jsonldTitleRaw =
    typeof jsonld?.name === "string" ? String(jsonld.name).trim() : typeof jsonld?.headline === "string" ? String(jsonld.headline).trim() : null;
  const jsonldTitle = jsonldTitleRaw ? stripTitleSuffix(jsonldTitleRaw, parsed.hostname) : null;
  const jsonldAuthors = bookish ? normalizeAuthors(jsonld?.author) : [];
  const jsonldPublisher = bookish ? normalizePublisher(jsonld?.publisher) : null;
  const jsonldPublishDate = bookish ? parseDateToIso(jsonld?.datePublished) : null;
  const jsonldDescription = bookish ? normalizeDescription(typeof jsonld?.description === "string" ? String(jsonld.description) : null, true) : null;
  const jsonldIsbn = typeof jsonld?.isbn === "string" ? String(jsonld.isbn).trim() : null;
  const jsonldSubjects = bookish
    ? uniqStrings([...normalizeKeywords(jsonld?.keywords), ...normalizeKeywords(jsonld?.about), ...normalizeKeywords(jsonld?.genre)])
    : [];
  const jsonldImages = normalizeImage(jsonld?.image);

  // Dimensions from JSON-LD (some stores include these)
  const jsonldDims = bookish && typeof jsonld?.bookEdition !== "undefined"
    ? { trim_width: null, trim_height: null, trim_unit: null as TrimUnit | null }
    : { trim_width: null, trim_height: null, trim_unit: null as TrimUnit | null };
  // Check numberOfPages from JSON-LD
  // Extract dimension string from JSON-LD if present
  const jsonldDimsStr = typeof jsonld?.size === "string" ? jsonld.size
    : typeof jsonld?.dimensions === "string" ? jsonld.dimensions : null;
  const jsonldParsedDims = jsonldDimsStr ? parseDimensions(jsonldDimsStr) : jsonldDims;

  const ogTitle = meta["og:title"] ? stripTitleSuffix(String(meta["og:title"]), parsed.hostname) : null;
  const ogDescription = normalizeDescription(
    (meta["og:description"] ?? meta["description"] ?? null) ? String(meta["og:description"] ?? meta["description"]) : null,
    bookish
  );
  const ogImage = meta["og:image:secure_url"] ?? meta["og:image"] ?? null;
  const twitterImage = meta["twitter:image"] ?? meta["twitter:image:src"] ?? null;

  const titleTagRaw = extractTitleTag(html);
  const titleTag = titleTagRaw ? stripTitleSuffix(titleTagRaw, parsed.hostname) : null;

  const isbnCandidates = uniqStrings([
    jsonldIsbn,
    meta["product:isbn"],
    meta["books:isbn"],
    meta["book:isbn"],
    meta["isbn"],
    ...extractLikelyIsbnsFromHtml(html)
  ]);
  const picked = pickBestIsbn(isbnCandidates);

  const covers = uniqStrings([...(jsonldImages ?? []), normalizeHttpsUrl(ogImage), normalizeHttpsUrl(twitterImage)].filter(Boolean) as string[]);

  let scraped = makeEmpty();
  
  // 1. JSON-LD (Priority 1)
  if (jsonld) {
    console.log("[scrape] Populating from JSON-LD");
    scraped = mergePreferBase(
      scraped,
      {
        title: jsonldTitle,
        authors: jsonldAuthors,
        publisher: jsonldPublisher,
        publish_date: jsonldPublishDate,
        description: jsonldDescription,
        subjects: jsonldSubjects,
        isbn10: picked.isbn10,
        isbn13: picked.isbn13,
        cover_candidates: covers,
        cover_url: covers[0] ?? null,
        trim_width: jsonldParsedDims.trim_width,
        trim_height: jsonldParsedDims.trim_height,
        trim_unit: jsonldParsedDims.trim_unit,
        raw: { jsonld, source: "jsonld" }
      },
      "jsonld"
    );
  }

  // 2. Open Graph (Priority 2)
  console.log("[scrape] Merging Open Graph");
  scraped = mergePreferBase(
    scraped,
    {
      title: ogTitle ? String(ogTitle).trim() : null,
      description: ogDescription ? String(ogDescription).trim() : null,
      cover_candidates: covers,
      cover_url: normalizeHttpsUrl(ogImage) ?? normalizeHttpsUrl(twitterImage) ?? null,
      raw: { og: meta }
    },
    "opengraph"
  );

  // 3. Standard Meta Tags (Priority 3)
  const metaDesc = normalizeDescription(meta["description"], bookish);
  const metaAuthor = meta["author"] ? [meta["author"]] : [];
  console.log("[scrape] Merging standard meta tags");
  scraped = mergePreferBase(
    scraped,
    {
      description: metaDesc,
      authors: metaAuthor,
      raw: { meta }
    },
    "meta"
  );

  // 4. HTML Title Tag (Priority 4)
  if (!scraped.title && titleTag) {
    console.log("[scrape] Falling back to HTML title tag");
    scraped.title = titleTag;
  }

  // 5. Minimal DOM Extraction (Last resort)
  // Only if we still have no title
  if (!scraped.title) {
    const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (h1Match) {
      const h1Title = decodeEntities(h1Match[1]!.replace(/<[^>]+>/g, "").trim());
      if (h1Title && h1Title.length < 200) {
        console.log("[scrape] Falling back to H1 for title");
        scraped.title = stripTitleSuffix(h1Title, parsed.hostname);
      }
    }
  }

  scraped.cover_candidates = uniqStrings(scraped.cover_candidates ?? []);
  scraped.authors = uniqStrings(scraped.authors ?? []);
  scraped.subjects = uniqStrings(scraped.subjects ?? []);

  // Validation: strip branding from title if it leaked through
  if (scraped.title) {
    scraped.title = stripTitleSuffix(scraped.title, parsed.hostname);
    if (scraped.title.length > 300) scraped.title = scraped.title.slice(0, 300);
  }

  // Optional enrichment: if we found an ISBN, prefer "authoritative" resolvers for metadata.
  const isbnForLookup = scraped.isbn13 ?? scraped.isbn10 ?? null;
  const isbnEdition = await tryIsbnEnrichment(req, isbnForLookup);

  let merged = scraped;
  if (isbnEdition && typeof isbnEdition === "object") {
    console.log(`[scrape] Enriching with ISBN metadata for ${isbnForLookup}`);
    const editionAsImport: Partial<ImportMetadata> = {
      title: typeof (isbnEdition as any).title === "string" ? String((isbnEdition as any).title) : null,
      authors: Array.isArray((isbnEdition as any).authors) ? (isbnEdition as any).authors : [],
      publisher: typeof (isbnEdition as any).publisher === "string" ? String((isbnEdition as any).publisher) : null,
      publish_date: typeof (isbnEdition as any).publish_date === "string" ? String((isbnEdition as any).publish_date) : null,
      description: typeof (isbnEdition as any).description === "string" ? String((isbnEdition as any).description) : null,
      subjects: Array.isArray((isbnEdition as any).subjects) ? (isbnEdition as any).subjects : [],
      isbn10: typeof (isbnEdition as any).isbn10 === "string" ? String((isbnEdition as any).isbn10) : null,
      isbn13: typeof (isbnEdition as any).isbn13 === "string" ? String((isbnEdition as any).isbn13) : null,
      cover_url: normalizeHttpsUrl((isbnEdition as any).cover_url),
      cover_candidates: [normalizeHttpsUrl((isbnEdition as any).cover_url), ...merged.cover_candidates].filter(Boolean) as string[],
      raw: { isbnEdition }
    };
    
    // Prefer edition metadata; fill any missing values from scrape.
    merged = mergePreferBase(makeEmpty(), editionAsImport, "isbn");
    merged = mergePreferBase(merged, scraped, "scrape");
    
    // Prefer the best available cover (edition first, then scrape).
    const allCovers = uniqStrings([
      normalizeHttpsUrl((isbnEdition as any).cover_url),
      ...scraped.cover_candidates
    ].filter(Boolean) as string[]);
    merged.cover_candidates = allCovers;
    merged.cover_url = allCovers[0] ?? null;
  }

  // Final validation for all candidates and the picked URL
  const validCandidates = (await Promise.all(
    merged.cover_candidates.map(url => validateCoverUrl(url))
  )).filter(Boolean) as string[];

  merged.cover_candidates = validCandidates;
  merged.cover_url = validCandidates[0] ?? null;

  return NextResponse.json({
    ok: true,
    domain: parsed.hostname,
    domain_kind: domainKind,
    final_url: finalUrl,
    scraped,
    isbn_edition: isbnEdition,
    preview: merged
  });
}
