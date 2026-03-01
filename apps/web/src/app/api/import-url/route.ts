import { NextResponse, type NextRequest } from "next/server";

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
  sources: string[];
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
    const n = normalizeIsbn(c);
    if (n.length === 13 && isValidIsbn13(n)) isbn13 = isbn13 ?? n;
    if (n.length === 10 && isValidIsbn10(n)) isbn10 = isbn10 ?? n;
  }
  if (!isbn13 && isbn10) isbn13 = isbn10ToIsbn13(isbn10);
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
  const t = input.trim().replace(/\s+/g, " ");
  if (!t) return t;

  const host = hostname.toLowerCase().replace(/^www\./, "");
  const hostLabel = host.split(".")[0] ?? host;
  const hostWords = hostLabel.replace(/[^a-z0-9]+/g, " ").trim();

  const candidates = [
    { sep: " | ", preferLeft: true },
    { sep: " — ", preferLeft: true },
    { sep: " - ", preferLeft: true },
    { sep: " · ", preferLeft: true }
  ];

  for (const { sep } of candidates) {
    if (!t.includes(sep)) continue;
    const parts = t.split(sep).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const right = parts[parts.length - 1] ?? "";
    const rightLc = right.toLowerCase();
    const hostHit =
      (hostWords && rightLc.includes(hostWords)) ||
      (hostLabel && rightLc.includes(hostLabel)) ||
      rightLc.includes(host);
    const shortRight = right.length <= 28;
    if (hostHit || shortRight) return parts[0] ?? t;
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
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (!allowBoilerplate && looksLikeBoilerplateDescription(s)) return null;
  if (s.length > 2000) return s.slice(0, 2000);
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

  // Description: text block after the last <hr> near the bottom of the page
  const hrIdx = html.lastIndexOf("<hr");
  let description: string | null = null;
  if (hrIdx !== -1) {
    const afterHr = html.slice(hrIdx);
    // Try <p> first, then <div>
    const paraRe = /<(?:p|div)[^>]*>([\s\S]{20,2000}?)<\/(?:p|div)>/i.exec(afterHr);
    if (paraRe) {
      const cleaned = decodeEntities(paraRe[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (cleaned.length > 20) description = cleaned.slice(0, 2000);
    }
  }

  // Extract credited roles from description text
  const editors = extractRolesFromText(description, /[Ee]dited\s+by\s+([^.;\n]+)/);
  const designers = extractRolesFromText(description, /[Dd]esigned?\s+by\s+([^.;\n]+)/);
  const printers = extractRolesFromText(description, /[Pp]rinted\s+by\s+([^.;\n]+)/);

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
  return "generic";
}

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

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);

    const len = Number(res.headers.get("content-length") ?? "0");
    if (len && len > 2_000_000) throw new Error("Page too large");

    const txt = await res.text();
    const html = txt.length > 2_000_000 ? txt.slice(0, 2_000_000) : txt;
    return { html, finalUrl: res.url || url };
  } finally {
    clearTimeout(t);
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
    sources: [],
    raw: {}
  };
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

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ ok: false, error: "Only http/https URLs are supported." }, { status: 400 });
  }

  if (parsed.username || parsed.password) {
    return NextResponse.json({ ok: false, error: "URLs with credentials are not supported." }, { status: 400 });
  }

  if (isBlockedHostname(parsed.hostname)) {
    return NextResponse.json({ ok: false, error: "That host is not allowed." }, { status: 400 });
  }

  const domainKind = detectDomainKind(parsed.hostname);

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
      raw: { jsonld, jsonldNodesCount: jsonldNodes.length }
    },
    "jsonld"
  );
  scraped = mergePreferBase(
    scraped,
    {
      title: ogTitle ? String(ogTitle).trim() : null,
      description: ogDescription ? String(ogDescription).trim() : null,
      cover_candidates: uniqStrings([normalizeHttpsUrl(ogImage), normalizeHttpsUrl(twitterImage)].filter(Boolean) as string[]),
      cover_url: normalizeHttpsUrl(ogImage) ?? normalizeHttpsUrl(twitterImage) ?? null,
      raw: { meta }
    },
    "opengraph"
  );
  scraped = mergePreferBase(
    scraped,
    {
      title: titleTag,
      raw: { titleTag }
    },
    "html"
  );

  scraped.cover_candidates = uniqStrings(scraped.cover_candidates ?? []);
  scraped.authors = uniqStrings(scraped.authors ?? []);
  scraped.subjects = uniqStrings(scraped.subjects ?? []);

  // Optional enrichment: if we found an ISBN, prefer "authoritative" resolvers for metadata.
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
      cover_candidates: uniqStrings([normalizeHttpsUrl((isbnEdition as any).cover_url), ...merged.cover_candidates].filter(Boolean) as string[]),
      raw: { isbnEdition }
    };
    // Prefer edition metadata; fill any missing values from scrape.
    merged = mergePreferBase(makeEmpty(), editionAsImport, "isbn");
    merged = mergePreferBase(merged, scraped, "scrape");
    // Prefer the best available cover (edition first, then scrape).
    merged.cover_candidates = uniqStrings([
      normalizeHttpsUrl((isbnEdition as any).cover_url),
      ...scraped.cover_candidates
    ].filter(Boolean) as string[]);
    merged.cover_url = normalizeHttpsUrl((isbnEdition as any).cover_url) ?? scraped.cover_url ?? null;
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
