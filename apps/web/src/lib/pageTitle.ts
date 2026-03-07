export const SITE_TITLE = "Other Library";
const TITLE_SEPARATOR = " – ";

type QueryInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined | null>;

function readQueryValue(input: QueryInput, key: string): string | null {
  if (input instanceof URLSearchParams) {
    const value = input.get(key);
    return typeof value === "string" ? value : null;
  }
  const raw = input[key];
  if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0] : null;
  return typeof raw === "string" ? raw : null;
}

function decodeQueryValue(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

export function normalizeTitleContext(context?: string | null): string | null {
  const trimmed = String(context ?? "").trim();
  return trimmed || null;
}

export function formatPageTitle(context?: string | null): string {
  const normalized = normalizeTitleContext(context);
  return normalized ? `${SITE_TITLE}${TITLE_SEPARATOR}${normalized}` : SITE_TITLE;
}

export function facetLabelForRole(role: string): string {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "featured artist") return "Featured artist";
  if (normalized === "art direction") return "Art direction";
  if (normalized === "tag") return "Tag";
  if (normalized === "subject") return "Subject";
  if (normalized === "category") return "Category";
  if (normalized === "author") return "Author";
  if (normalized === "editor") return "Editor";
  if (normalized === "designer") return "Designer";
  if (normalized === "publisher") return "Publisher";
  if (normalized === "performer") return "Performer";
  if (normalized === "composer") return "Composer";
  if (normalized === "producer") return "Producer";
  if (normalized === "engineer") return "Engineer";
  if (normalized === "mastering") return "Mastering";
  if (normalized === "arranger") return "Arranger";
  if (normalized === "conductor") return "Conductor";
  if (normalized === "orchestra") return "Orchestra";
  if (normalized === "artwork") return "Artwork";
  if (normalized === "design") return "Design";
  if (normalized === "photography") return "Photography";
  if (normalized === "material") return "Material";
  if (normalized === "printer") return "Printer";
  if (normalized === "decade") return "Decade";
  return normalized
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function contextFromFilterParams(input: QueryInput, fallbackContext: string): string {
  const filterKeys: Array<[string, string]> = [
    ["category", "Category"],
    ["tag", "Tag"],
    ["subject", "Subject"],
    ["author", "Author"],
    ["editor", "Editor"],
    ["designer", "Designer"],
    ["publisher", "Publisher"],
    ["material", "Material"],
    ["printer", "Printer"],
    ["performer", "Performer"],
    ["composer", "Composer"],
    ["producer", "Producer"],
    ["engineer", "Engineer"],
    ["mastering", "Mastering"],
    ["arranger", "Arranger"],
    ["conductor", "Conductor"],
    ["orchestra", "Orchestra"],
    ["artwork", "Artwork"],
    ["design", "Design"],
    ["photography", "Photography"],
    ["decade", "Decade"]
  ];

  for (const [key, label] of filterKeys) {
    const value = decodeQueryValue(readQueryValue(input, key));
    if (value) return `${label}: ${value}`;
  }

  const query = decodeQueryValue(readQueryValue(input, "q"));
  if (query) return "Search";

  return fallbackContext;
}
