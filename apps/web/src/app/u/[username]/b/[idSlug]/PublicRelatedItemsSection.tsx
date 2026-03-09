"use client";

import Link from "next/link";
import { useState } from "react";
import CoverImage, { type CoverCrop } from "../../../../../components/CoverImage";
import { getServerSupabase } from "../../../../../lib/supabaseServer";
import { bookIdSlug } from "../../../../../lib/slug";
import { MUSIC_CONTRIBUTOR_ROLES, parseMusicMetadata, type MusicMetadata } from "../../../../../lib/music";

type PublicBookLike = {
  id: number;
  owner_id: string;
  visibility: "inherit" | "followers_only" | "public";
  object_type: string | null;
  title_override: string | null;
  authors_override: string[] | null;
  designers_override: string[] | null;
  music_metadata?: MusicMetadata | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: {
    id?: number | null;
    title: string | null;
    authors: string[] | null;
    cover_url: string | null;
  } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
  book_entities?: Array<{ role: string; entity: { id?: string | null; name?: string | null; slug?: string | null } | null }> | null;
};

type Candidate = {
  role: string;
  name: string;
  heading: string;
  mediaScope: "book" | "music" | "all";
};

function normalizeName(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueNames(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = String(value ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function isRemoteUrl(input: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(input ?? "").trim());
}

function effectiveTitle(row: PublicBookLike): string {
  return String(row.title_override ?? "").trim() || String(row.edition?.title ?? "").trim() || "(untitled)";
}

function coverStoragePath(row: PublicBookLike): string | null {
  const coverMedia = (row.media ?? []).find((entry) => entry.kind === "cover")?.storage_path ?? null;
  if (coverMedia) return coverMedia;
  const firstMedia = (row.media ?? [])[0]?.storage_path ?? null;
  if (firstMedia) return firstMedia;
  const original = String(row.cover_original_url ?? "").trim();
  return original && !isRemoteUrl(original) ? original : null;
}

function coverSrc(row: PublicBookLike, signedMap: Record<string, string>): string | null {
  const original = String(row.cover_original_url ?? "").trim();
  if (original) {
    if (isRemoteUrl(original)) return original;
    if (signedMap[original]) return signedMap[original];
  }
  const storagePath = coverStoragePath(row);
  if (storagePath && signedMap[storagePath]) return signedMap[storagePath];
  const editionCover = String(row.edition?.cover_url ?? "").trim();
  return editionCover || null;
}

function isVisibleToPublic(row: PublicBookLike, profileVisibility: "public" | "followers_only" | null | undefined): boolean {
  if (row.visibility === "public") return true;
  if (row.visibility === "followers_only") return false;
  return profileVisibility === "public";
}

function matchesMediaScope(row: PublicBookLike, mediaScope: Candidate["mediaScope"]): boolean {
  const objectType = String(row.object_type ?? "").trim().toLowerCase();
  if (mediaScope === "book") return objectType !== "music";
  if (mediaScope === "music") return objectType === "music";
  return true;
}

function rowMatchesCandidate(row: PublicBookLike, candidate: Candidate): boolean {
  if (!matchesMediaScope(row, candidate.mediaScope)) return false;
  const target = normalizeName(candidate.name);
  if (!target) return false;

  if (candidate.role === "author") {
    return uniqueNames([...(row.authors_override ?? []), ...((row.edition?.authors ?? []) as string[])]).some((name) => normalizeName(name) === target);
  }

  if (candidate.role === "designer") {
    const entityNames = (row.book_entities ?? [])
      .filter((entry) => {
        const role = String(entry?.role ?? "").trim().toLowerCase();
        return role === "designer" || role === "design";
      })
      .map((entry) => entry.entity?.name ?? null);
    return uniqueNames([...(row.designers_override ?? []), ...entityNames]).some((name) => normalizeName(name) === target);
  }

  const music = parseMusicMetadata(row.music_metadata);
  if (candidate.role === "performer" && normalizeName(music?.primary_artist) === target) return true;
  return (row.book_entities ?? []).some((entry) => {
    const role = String(entry?.role ?? "").trim().toLowerCase();
    return role === candidate.role && normalizeName(entry?.entity?.name) === target;
  });
}

function deriveCandidates(book: PublicBookLike): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: Candidate) => {
    const key = `${candidate.role}:${candidate.name.toLowerCase()}`;
    if (!candidate.name.trim() || seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const authorEntityNames = (book.book_entities ?? [])
    .filter((entry) => String(entry?.role ?? "").trim().toLowerCase() === "author")
    .map((entry) => String(entry?.entity?.name ?? "").trim())
    .filter(Boolean);
  const authorNames = authorEntityNames.length > 0 ? authorEntityNames : uniqueNames([...(book.authors_override ?? []), ...((book.edition?.authors ?? []) as string[])]);
  for (const name of authorNames) {
    push({ role: "author", name, heading: `Other books by ${name}`, mediaScope: "book" });
  }

  const music = parseMusicMetadata(book.music_metadata);
  const primaryArtist = String(music?.primary_artist ?? "").trim();
  if (primaryArtist) {
    push({ role: "performer", name: primaryArtist, heading: `Other records by ${primaryArtist}`, mediaScope: "music" });
  }
  for (const role of MUSIC_CONTRIBUTOR_ROLES.filter((role) => !["designer", "art direction", "artwork", "photography"].includes(role))) {
    const names = (book.book_entities ?? [])
      .filter((entry) => String(entry?.role ?? "").trim().toLowerCase() === role)
      .map((entry) => String(entry?.entity?.name ?? "").trim())
      .filter(Boolean);
    for (const name of names) {
      push({ role, name, heading: `Other records by ${name}`, mediaScope: "music" });
    }
  }

  const designerEntityNames = (book.book_entities ?? [])
    .filter((entry) => {
      const role = String(entry?.role ?? "").trim().toLowerCase();
      return role === "designer" || role === "design";
    })
    .map((entry) => String(entry?.entity?.name ?? "").trim())
    .filter(Boolean);
  const designerNames = designerEntityNames.length > 0 ? designerEntityNames : uniqueNames(book.designers_override ?? []);
  for (const name of designerNames) {
    push({ role: "designer", name, heading: `Other items designed by ${name}`, mediaScope: "all" });
  }

  return candidates;
}

export default async function PublicRelatedItemsSection({
  profileId,
  profileUsername,
  profileVisibility,
  book
}: {
  profileId: string;
  profileUsername: string;
  profileVisibility: "public" | "followers_only" | null | undefined;
  book: PublicBookLike;
}) {
  const supabase = getServerSupabase();
  if (!supabase) return null;

  const candidates = deriveCandidates(book);
  if (candidates.length === 0) return null;

  const booksRes = await supabase
    .from("user_books")
    .select("id,owner_id,visibility,object_type,title_override,authors_override,designers_override,music_metadata,cover_original_url,cover_crop,edition:editions(id,title,authors,cover_url),media:user_book_media(kind,storage_path),book_entities:book_entities(role,entity:entities(id,name,slug))")
    .eq("owner_id", profileId)
    .neq("id", book.id)
    .order("created_at", { ascending: false })
    .limit(1000);

  const allBooks = ((booksRes.data ?? []) as unknown as PublicBookLike[]).filter((row) => isVisibleToPublic(row, profileVisibility));

  let heading: string | null = null;
  let relatedRows: PublicBookLike[] = [];
  for (const candidate of candidates) {
    const matches = allBooks.filter((row) => rowMatchesCandidate(row, candidate));
    if (matches.length < 3) continue;
    heading = candidate.heading;
    relatedRows = matches.slice(0, 4);
    break;
  }

  if (!heading || relatedRows.length < 3) return null;

  const mediaPaths = Array.from(
    new Set(
      relatedRows
        .map((row) => coverStoragePath(row))
        .filter((value): value is string => Boolean(value))
    )
  );
  const signedMap: Record<string, string> = {};
  if (mediaPaths.length > 0) {
    const signed = await supabase.storage.from("user-book-media").createSignedUrls(mediaPaths, 60 * 30);
    for (const row of signed.data ?? []) {
      if (row.path && row.signedUrl) signedMap[row.path] = row.signedUrl;
    }
  }

  return <PublicRelatedItemsGrid heading={heading} profileUsername={profileUsername} relatedRows={relatedRows} signedMap={signedMap} />;
}

function PublicRelatedItemsGrid({
  heading,
  profileUsername,
  relatedRows,
  signedMap
}: {
  heading: string;
  profileUsername: string;
  relatedRows: PublicBookLike[];
  signedMap: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? relatedRows : relatedRows.slice(0, 4);
  const showPager = relatedRows.length > 4;

  return (
    <>
      <hr className="divider" />
      <div style={{ marginTop: "var(--space-lg)" }}>
        <div>{heading}</div>
        <div className="om-related-items-grid" style={{ marginTop: "var(--space-14)" }}>
          {visibleRows.map((row) => {
            const title = effectiveTitle(row);
            const href = `/u/${encodeURIComponent(profileUsername)}/b/${bookIdSlug(row.id, title)}`;
            return (
              <div key={row.id}>
                <Link href={href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                  <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
                    <CoverImage alt={title} src={coverSrc(row, signedMap)} cropData={row.cover_crop} style={{ display: "block", width: "100%", height: "auto" }} objectFit="contain" />
                  </div>
                </Link>
                <div style={{ marginTop: "var(--space-sm)" }}>
                  <Link href={href} style={{ color: "inherit", textDecoration: "none" }}>
                    <span className="om-book-title">{title}</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
        {showPager ? (
          <div className="row" style={{ marginTop: "var(--space-md)", justifyContent: "center" }}>
            <button className="text-muted" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "See less" : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
