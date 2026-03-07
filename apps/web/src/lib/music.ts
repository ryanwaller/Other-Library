export const MUSIC_CONTRIBUTOR_ROLES = [
  "performer",
  "composer",
  "producer",
  "engineer",
  "mastering",
  "featured artist",
  "arranger",
  "conductor",
  "orchestra",
  "artwork",
  "design",
  "photography"
] as const;

export type MusicContributorRole = (typeof MUSIC_CONTRIBUTOR_ROLES)[number];

export type MusicTrack = {
  position: string | null;
  title: string;
  duration: string | null;
  type: string | null;
};

export type MusicMetadata = {
  primary_artist: string | null;
  label: string | null;
  release_date: string | null;
  original_release_year: string | null;
  format: string | null;
  edition_pressing: string | null;
  catalog_number: string | null;
  barcode: string | null;
  country: string | null;
  genres: string[];
  styles: string[];
  tracklist: MusicTrack[];
  discogs_id: string | null;
  musicbrainz_id: string | null;
  speed: string | null;
  disc_count: number | null;
  color_variant: string | null;
  limited_edition: boolean | null;
  release_lineage: string | null;
  audio_configuration: string | null;
  packaging_type: string | null;
  track_count: number | null;
};

export function musicDisplayGenres(input: Pick<MusicMetadata, "genres" | "styles"> | null | undefined): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...(input.genres ?? []), ...(input.styles ?? [])]) {
    const next = String(value ?? "").trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

export function formatMusicTrackLine(track: Pick<MusicTrack, "position" | "title" | "duration">): string {
  return [track.position, track.title, track.duration].filter(Boolean).join(" ");
}

export function emptyMusicMetadata(): MusicMetadata {
  return {
    primary_artist: null,
    label: null,
    release_date: null,
    original_release_year: null,
    format: null,
    edition_pressing: null,
    catalog_number: null,
    barcode: null,
    country: null,
    genres: [],
    styles: [],
    tracklist: [],
    discogs_id: null,
    musicbrainz_id: null,
    speed: null,
    disc_count: null,
    color_variant: null,
    limited_edition: null,
    release_lineage: null,
    audio_configuration: null,
    packaging_type: null,
    track_count: null
  };
}

function normalizeStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const next = String(value ?? "").trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

export function parseMusicMetadata(input: unknown): MusicMetadata | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const base = emptyMusicMetadata();
  const tracklist = Array.isArray(raw.tracklist)
    ? raw.tracklist
        .map((track) => {
          if (!track || typeof track !== "object") return null;
          const row = track as Record<string, unknown>;
          const title = String(row.title ?? "").trim();
          if (!title) return null;
          return {
            position: String(row.position ?? "").trim() || null,
            title,
            duration: String(row.duration ?? "").trim() || null,
            type: String(row.type ?? "").trim() || null
          };
        })
        .filter(Boolean) as MusicTrack[]
    : [];
  return {
    primary_artist: String(raw.primary_artist ?? "").trim() || null,
    label: String(raw.label ?? "").trim() || null,
    release_date: String(raw.release_date ?? "").trim() || null,
    original_release_year: String(raw.original_release_year ?? "").trim() || null,
    format: String(raw.format ?? "").trim() || null,
    edition_pressing: String(raw.edition_pressing ?? "").trim() || null,
    catalog_number: String(raw.catalog_number ?? "").trim() || null,
    barcode: String(raw.barcode ?? "").trim() || null,
    country: String(raw.country ?? "").trim() || null,
    genres: normalizeStrings(raw.genres),
    styles: normalizeStrings(raw.styles),
    tracklist,
    discogs_id: String(raw.discogs_id ?? "").trim() || null,
    musicbrainz_id: String(raw.musicbrainz_id ?? "").trim() || null,
    speed: String(raw.speed ?? "").trim() || null,
    disc_count: Number.isFinite(Number(raw.disc_count)) ? Number(raw.disc_count) : null,
    color_variant: String(raw.color_variant ?? "").trim() || null,
    limited_edition: typeof raw.limited_edition === "boolean" ? raw.limited_edition : null,
    release_lineage: String(raw.release_lineage ?? "").trim() || null,
    audio_configuration: String(raw.audio_configuration ?? "").trim() || null,
    packaging_type: String(raw.packaging_type ?? "").trim() || null,
    track_count: Number.isFinite(Number(raw.track_count)) ? Number(raw.track_count) : tracklist.length || null
  } satisfies MusicMetadata;
}
