export const MUSIC_CONTRIBUTOR_ROLES = [
  "performer",
  "composer",
  "producer",
  "designer",
  "engineer",
  "mastering",
  "featured artist",
  "arranger",
  "conductor",
  "orchestra",
  "art direction",
  "artwork",
  "photography"
] as const;

export const MUSIC_FORMAT_OPTIONS = ["LP", '12"', '10"', '7"', "CD", "Cassette", "Box set", "Flexi disc"] as const;
export const MUSIC_RELEASE_TYPE_OPTIONS = ["Album", "EP", "Single", "Compilation", "Live", "Soundtrack", "Box set"] as const;
export const MUSIC_SPEED_OPTIONS = ["33⅓ RPM", "45 RPM", "78 RPM"] as const;
export const MUSIC_CHANNEL_OPTIONS = ["Stereo", "Mono", "Both", "Unknown"] as const;

export type MusicContributorRole = (typeof MUSIC_CONTRIBUTOR_ROLES)[number];
export type MusicFormatOption = (typeof MUSIC_FORMAT_OPTIONS)[number];
export type MusicReleaseTypeOption = (typeof MUSIC_RELEASE_TYPE_OPTIONS)[number];
export type MusicSpeedOption = (typeof MUSIC_SPEED_OPTIONS)[number];
export type MusicChannelOption = (typeof MUSIC_CHANNEL_OPTIONS)[number];

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
  release_type: string | null;
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
  reissue: boolean | null;
  channels: string | null;
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
    release_type: null,
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
    reissue: null,
    channels: null,
    packaging_type: null,
    track_count: null
  };
}

function normalizeOption<T extends readonly string[]>(value: string | null | undefined, options: T): T[number] | null {
  const next = String(value ?? "").trim().toLowerCase();
  if (!next) return null;
  const match = options.find((option) => option.toLowerCase() === next);
  return match ?? null;
}

export function normalizeMusicFormat(value: string | null | undefined): MusicFormatOption | null {
  const next = String(value ?? "").trim().toLowerCase();
  if (!next) return null;
  if (next === "box set" || next.includes("box set")) return "Box set";
  if (next.includes("flexi")) return "Flexi disc";
  if (next.includes("cassette")) return "Cassette";
  if (next === "cd" || next.includes("compact disc")) return "CD";
  if (next === '12"' || next.includes('12"')) return '12"';
  if (next === '10"' || next.includes('10"')) return '10"';
  if (next === '7"' || next.includes('7"')) return '7"';
  if (next === "lp" || next.includes(" lp") || next.startsWith("lp ") || next.includes("vinyl") || next.includes("album")) return "LP";
  return normalizeOption(value, MUSIC_FORMAT_OPTIONS);
}

export function normalizeMusicReleaseType(value: string | null | undefined): MusicReleaseTypeOption | null {
  const next = String(value ?? "").trim().toLowerCase();
  if (!next) return null;
  if (next === "box set" || next.includes("box set")) return "Box set";
  if (next.includes("soundtrack")) return "Soundtrack";
  if (next.includes("compilation")) return "Compilation";
  if (next.includes("live")) return "Live";
  if (next === "ep" || /\bep\b/.test(next)) return "EP";
  if (next.includes("single")) return "Single";
  if (next.includes("album")) return "Album";
  return normalizeOption(value, MUSIC_RELEASE_TYPE_OPTIONS);
}

export function normalizeMusicSpeed(value: string | null | undefined): MusicSpeedOption | null {
  const next = String(value ?? "").trim().toLowerCase();
  if (!next) return null;
  if (next.includes("33")) return "33⅓ RPM";
  if (next.includes("45")) return "45 RPM";
  if (next.includes("78")) return "78 RPM";
  return normalizeOption(value, MUSIC_SPEED_OPTIONS);
}

export function normalizeMusicChannels(value: string | null | undefined): MusicChannelOption | null {
  const next = String(value ?? "").trim().toLowerCase();
  if (!next) return null;
  if (next.includes("both")) return "Both";
  if (next.includes("stereo") && next.includes("mono")) return "Both";
  if (next.includes("stereo")) return "Stereo";
  if (next.includes("mono")) return "Mono";
  if (next.includes("unknown")) return "Unknown";
  return normalizeOption(value, MUSIC_CHANNEL_OPTIONS);
}

export function normalizeMusicReissue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const next = String(value ?? "").trim().toLowerCase();
  if (!next) return null;
  if (["yes", "true", "reissue", "repress", "remaster"].includes(next)) return true;
  if (["no", "false", "original"].includes(next)) return false;
  return null;
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
    format: normalizeMusicFormat(String(raw.format ?? "").trim()) ?? (String(raw.format ?? "").trim() || null),
    release_type: normalizeMusicReleaseType(String(raw.release_type ?? "").trim()) ?? (String(raw.release_type ?? "").trim() || null),
    edition_pressing: String(raw.edition_pressing ?? "").trim() || null,
    catalog_number: String(raw.catalog_number ?? "").trim() || null,
    barcode: String(raw.barcode ?? "").trim() || null,
    country: String(raw.country ?? "").trim() || null,
    genres: normalizeStrings(raw.genres),
    styles: normalizeStrings(raw.styles),
    tracklist,
    discogs_id: String(raw.discogs_id ?? "").trim() || null,
    musicbrainz_id: String(raw.musicbrainz_id ?? "").trim() || null,
    speed: normalizeMusicSpeed(String(raw.speed ?? "").trim()) ?? (String(raw.speed ?? "").trim() || null),
    disc_count: Number.isFinite(Number(raw.disc_count)) ? Number(raw.disc_count) : null,
    color_variant: String(raw.color_variant ?? "").trim() || null,
    limited_edition: typeof raw.limited_edition === "boolean" ? raw.limited_edition : null,
    reissue: normalizeMusicReissue(raw.reissue ?? raw.release_lineage),
    channels: normalizeMusicChannels(String(raw.channels ?? raw.audio_configuration ?? "").trim()) ?? (String(raw.channels ?? raw.audio_configuration ?? "").trim() || null),
    packaging_type: String(raw.packaging_type ?? "").trim() || null,
    track_count: Number.isFinite(Number(raw.track_count)) ? Number(raw.track_count) : tracklist.length || null
  } satisfies MusicMetadata;
}
