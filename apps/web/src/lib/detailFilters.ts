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
  printer: "Printer",
  group: "Group",
  decade: "Decade",
  performer: "Performer",
  composer: "Composer",
  producer: "Producer",
  engineer: "Engineer",
  mastering: "Mastering",
  featured_artist: "Featured artist",
  arranger: "Arranger",
  conductor: "Conductor",
  orchestra: "Orchestra",
  art_direction: "Art direction",
  artwork: "Artwork",
  design: "Design",
  photography: "Photography",
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

const ROLE_TO_DETAIL_FILTER_KEY = {
  author: "author",
  tag: "tag",
  category: "category",
  subject: "subject",
  publisher: "publisher",
  designer: "designer",
  editor: "editor",
  material: "material",
  printer: "printer",
  performer: "performer",
  composer: "composer",
  producer: "producer",
  engineer: "engineer",
  mastering: "mastering",
  "featured artist": "featured_artist",
  arranger: "arranger",
  conductor: "conductor",
  orchestra: "orchestra",
  "art direction": "art_direction",
  artwork: "artwork",
  design: "design",
  photography: "photography"
} as const satisfies Record<string, DetailFilterKey>;

export function detailFilterHref(basePath: string, key: DetailFilterKey, value: string): string {
  const next = String(value ?? "").trim();
  if (!next) return basePath;
  return `${basePath}?${key}=${encodeURIComponent(next)}`;
}

export function detailFilterLabel(key: string): string | null {
  return (DETAIL_FILTER_LABELS as Record<string, string>)[key] ?? null;
}

export function roleToDetailFilterKey(role: string): DetailFilterKey | null {
  const normalized = String(role ?? "").trim().toLowerCase();
  return (ROLE_TO_DETAIL_FILTER_KEY as Record<string, DetailFilterKey>)[normalized] ?? null;
}
