export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 80) || "book";
}

export function bookIdSlug(id: number, title: string | null | undefined): string {
  const t = (title ?? "").trim();
  return `${id}-${slugify(t || "book")}`;
}

