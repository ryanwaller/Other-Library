import type { PublicBook } from "./types";
import { parseMusicMetadata } from "./music";
import { formatIssueDisplay, isMagazineObject } from "./magazine";

export type DenseListFields = {
  primaryTitle: string;
  primarySubtitle: string | null;
  secondary: string | null;
  tertiary: string | null;
  mobileSecondary: string | null;
};

export function normalizeKeyPart(input: string): string {
  return (input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function effectiveTitleFor(b: PublicBook): string {
  const e = b.edition;
  return (b.title_override ?? "").trim() || e?.title || "(untitled)";
}

export function titleSortKeyFor(b: PublicBook): string {
  const title = normalizeKeyPart(effectiveTitleFor(b));
  if (!isMagazineObject(b.object_type)) return title;

  const volume = normalizeKeyPart(String(b.issue_volume ?? ""));
  const issueNumber = normalizeKeyPart(String(b.issue_number ?? ""));
  const season = normalizeKeyPart(String(b.issue_season ?? ""));
  const year = normalizeKeyPart(String(b.issue_year ?? ""));

  return [title, volume && `vol ${volume}`, issueNumber && `issue ${issueNumber}`, season, year]
    .filter(Boolean)
    .join(" | ");
}

export function effectiveAuthorsFor(b: PublicBook): string[] {
  if ((b.object_type ?? "").trim() === "music") {
    const music = parseMusicMetadata(b.music_metadata);
    const primaryArtist = (music?.primary_artist ?? "").trim();
    if (primaryArtist) return [primaryArtist];
  }
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

export function effectiveSecondaryLineFor(b: PublicBook): { mode: "authors" | "plain"; values: string[] } {
  if (isMagazineObject(b.object_type)) {
    const subtitle = String(b.subtitle_override ?? "").trim();
    const issue = formatIssueDisplay(b);
    const values = [subtitle, issue].filter(Boolean);
    return { mode: "plain", values };
  }
  return { mode: "authors", values: effectiveAuthorsFor(b) };
}

export function effectiveSubjectsFor(b: PublicBook): string[] {
  if (b.subjects_override !== null && b.subjects_override !== undefined) {
    return (b.subjects_override ?? []).filter(Boolean);
  }
  return (b.edition?.subjects ?? []).filter(Boolean);
}

export function effectivePublisherFor(b: PublicBook): string {
  if ((b.object_type ?? "").trim() === "music") {
    const music = parseMusicMetadata(b.music_metadata);
    const label = (music?.label ?? "").trim();
    if (label) return label;
  }
  const o = (b.publisher_override ?? "").trim();
  if (o) return o;
  return (b.edition?.publisher ?? "").trim();
}

function firstYearFrom(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
  return match ? match[1] : null;
}

export function effectiveYearFor(b: PublicBook): string | null {
  return (
    firstYearFrom(b.issue_year) ??
    firstYearFrom(b.publish_date_override) ??
    firstYearFrom(b.edition?.publish_date) ??
    null
  );
}

export function effectiveDateLabelFor(b: PublicBook): string | null {
  const rawPublishDate = String(b.publish_date_override ?? b.edition?.publish_date ?? "").trim();
  if (rawPublishDate) return rawPublishDate;
  const issue = formatIssueDisplay(b);
  if (issue) return issue;
  return effectiveYearFor(b);
}

function joinClean(values: Array<string | null | undefined>): string | null {
  const cleaned = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(", ") : null;
}

export function denseListFieldsFor(b: PublicBook): DenseListFields {
  const title = effectiveTitleFor(b);
  const subtitle = String(b.subtitle_override ?? "").trim() || null;

  if (isMagazineObject(b.object_type)) {
    const issueLine = formatIssueDisplay(b) || null;
    const yearLine = effectiveYearFor(b);
    return {
      primaryTitle: title,
      primarySubtitle: subtitle,
      secondary: issueLine,
      tertiary: yearLine,
      mobileSecondary: joinClean([issueLine, yearLine])
    };
  }

  if (String(b.object_type ?? "").trim() === "music") {
    const music = parseMusicMetadata(b.music_metadata);
    const artist = joinClean(effectiveAuthorsFor(b));
    const tertiary = joinClean([effectiveYearFor(b), music?.label ?? effectivePublisherFor(b), music?.format]);
    return {
      primaryTitle: title,
      primarySubtitle: subtitle,
      secondary: artist,
      tertiary,
      mobileSecondary: artist ?? tertiary
    };
  }

  const secondary = joinClean(effectiveAuthorsFor(b));
  const publisher = String(effectivePublisherFor(b) ?? "").trim() || null;
  const tertiary = joinClean([publisher, effectiveYearFor(b)]);

  return {
    primaryTitle: title,
    primarySubtitle: subtitle,
    secondary,
    tertiary,
    mobileSecondary: secondary ?? tertiary
  };
}

export function groupKeyFor(b: PublicBook): string {
  const eId = b.edition?.id ?? null;
  if (eId) return `e:${eId}`;
  if (isMagazineObject(b.object_type)) {
    return `mag:${b.id}`;
  }
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
