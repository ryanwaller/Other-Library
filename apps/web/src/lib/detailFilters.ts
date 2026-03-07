export const DETAIL_FILTER_LABELS = {
  q: "Search",
  author: "Author",
  tag: "Tag",
  category: "Category",
  subject: "Subject",
  publisher: "Publisher",
  designer: "Designer",
  editor: "Editor",
  material: "Material",
  group: "Group",
  decade: "Decade",
  publish_date: "Publish date",
  release_date: "Release date",
  original_release_year: "Orig. release year",
  format: "Format",
  release_type: "Release type",
  pressing: "Pressing",
  catalog_number: "Catalog #",
  barcode: "Barcode",
  country: "Country",
  discogs_id: "Discogs ID",
  musicbrainz_id: "MusicBrainz ID",
  speed: "Speed",
  channels: "Channels",
  disc_count: "Disc count",
  limited_edition: "Limited edition",
  reissue: "Reissue"
} as const;

export type DetailFilterKey = keyof typeof DETAIL_FILTER_LABELS;

export const DETAIL_FILTER_KEYS = Object.keys(DETAIL_FILTER_LABELS) as DetailFilterKey[];

export function detailFilterHref(basePath: string, key: DetailFilterKey, value: string): string {
  const next = String(value ?? "").trim();
  if (!next) return basePath;
  return `${basePath}?${key}=${encodeURIComponent(next)}`;
}

export function detailFilterLabel(key: string): string | null {
  return (DETAIL_FILTER_LABELS as Record<string, string>)[key] ?? null;
}
