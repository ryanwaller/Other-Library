import type { PublicBook } from "./types";

export function normalizeKeyPart(input: string): string {
  return (input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function effectiveTitleFor(b: PublicBook): string {
  const e = b.edition;
  return (b.title_override ?? "").trim() || e?.title || "(untitled)";
}

export function effectiveAuthorsFor(b: PublicBook): string[] {
  const editors = (b.editors_override ?? []).filter(Boolean);
  if (b.authors_override !== null && b.authors_override !== undefined) {
    const override = (b.authors_override ?? []).filter(Boolean);
    if (override.length > 0) return override;
    return editors;
  }
  const editionAuthors = (b.edition?.authors ?? []).filter(Boolean);
  if (editionAuthors.length > 0) return editionAuthors;
  return editors;
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
  const fromTags = (it.book_tags ?? [])
    .map((bt) => bt.tag)
    .filter(Boolean)
    .map((t) => ({ name: (t as any).name as string, kind: (t as any).kind as "tag" | "category" }))
    .filter((t) => t.name && (t.kind === "tag" || t.kind === "category"));
  const fromEntities = (it.book_entities ?? [])
    .filter((be: any) => {
      const role = String(be?.role ?? "").toLowerCase();
      return role === "tag" || role === "category";
    })
    .map((be: any) => {
      const role = String(be?.role ?? "").toLowerCase() as "tag" | "category";
      const name = String(be?.entity?.name ?? "").trim();
      return { name, kind: role };
    })
    .filter((t: { name: string; kind: "tag" | "category" }) => t.name.length > 0);
  const seen = new Set<string>();
  const out: Array<{ name: string; kind: "tag" | "category" }> = [];
  for (const t of [...fromTags, ...fromEntities]) {
    const key = `${t.kind}:${t.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
