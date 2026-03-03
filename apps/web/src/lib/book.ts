import type { PublicBook } from "./types";

export function normalizeKeyPart(input: string): string {
  return (input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function effectiveTitleFor(b: PublicBook): string {
  const e = b.edition;
  return (b.title_override ?? "").trim() || e?.title || "(untitled)";
}

export function effectiveAuthorsFor(b: PublicBook): string[] {
  const override = (b.authors_override ?? []).filter(Boolean);
  if (override.length > 0) return override;
  return (b.edition?.authors ?? []).filter(Boolean);
}

export function effectiveSubjectsFor(b: PublicBook): string[] {
  if (b.subjects_override !== null && b.subjects_override !== undefined) {
    return (b.subjects_override ?? []).filter(Boolean);
  }
  return (b.edition?.subjects ?? []).filter(Boolean);
}

export function effectivePublisherFor(b: PublicBook): string {
  const o = (b.publisher_override ?? "").trim();
  if (o) return o;
  return (b.edition?.publisher ?? "").trim();
}

export function groupKeyFor(b: PublicBook): string {
  const eId = b.edition?.id ?? null;
  if (eId) return `e:${eId}`;
  const title = normalizeKeyPart(effectiveTitleFor(b));
  const authors = effectiveAuthorsFor(b)
    .map((a) => normalizeKeyPart(a))
    .filter(Boolean)
    .join("|");
  return `m:${title}|${authors}`;
}

export function tagsFor(it: PublicBook & { book_tags?: any[] }): Array<{ name: string; kind: "tag" | "category" }> {
  return (it.book_tags ?? [])
    .map((bt) => bt.tag)
    .filter(Boolean)
    .map((t) => ({ name: (t as any).name as string, kind: (t as any).kind as "tag" | "category" }))
    .filter((t) => t.name && (t.kind === "tag" || t.kind === "category"));
}
