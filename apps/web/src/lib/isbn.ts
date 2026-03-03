export function normalizeIsbn(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^0-9X]/g, "");
}

export function looksLikeIsbn(input: string): boolean {
  const n = normalizeIsbn(input);
  return n.length === 10 || n.length === 13;
}

export function tryParseUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    // allow "www.example.com/..."
    if (raw.startsWith("www.")) {
      try {
        return new URL(`https://${raw}`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseTitleAndAuthor(input: string): { title: string; author: string | null } {
  const s = input.trim().replace(/\s+/g, " ");
  if (!s) return { title: "", author: null };
  const by = s.split(/\s+by\s+/i);
  if (by.length === 2 && by[0] && by[1]) return { title: by[0].trim(), author: by[1].trim() || null };
  const dash = s.split(" - ");
  if (dash.length === 2 && dash[0] && dash[1]) return { title: dash[0].trim(), author: dash[1].trim() || null };
  const slash = s.split(" / ");
  if (slash.length === 2 && slash[0] && slash[1]) return { title: slash[0].trim(), author: slash[1].trim() || null };
  return { title: s, author: null };
}
