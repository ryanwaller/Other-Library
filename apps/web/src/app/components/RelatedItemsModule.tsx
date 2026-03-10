"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CoverCrop } from "../../components/CoverImage";
import CoverImage from "../../components/CoverImage";
import { parseMusicMetadata } from "../../lib/music";
import { bookIdSlug } from "../../lib/slug";
import { supabase } from "../../lib/supabaseClient";

export type RelatedItemsCandidate = {
  role: string;
  name: string;
  heading: string;
  mediaScope: "book" | "music" | "all";
  entityId?: string | null;
  entitySlug?: string | null;
};

type RelatedItemRow = {
  id: number;
  library_id?: number | null;
  resolved_cover_url?: string | null;
  visibility: "inherit" | "followers_only" | "public";
  object_type: string | null;
  title_override: string | null;
  authors_override?: string[] | null;
  designers_override?: string[] | null;
  music_metadata?: unknown;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: { title: string | null; cover_url: string | null; authors?: string[] | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
  book_entities?: Array<{ role: string; entity_id?: string | null; entity?: { id?: string | null; name?: string | null } | null }>;
};

function isUuid(input: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(input ?? "").trim());
}

function isRemoteUrl(input: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(input ?? "").trim());
}

function effectiveTitle(row: RelatedItemRow): string {
  return String(row.title_override ?? "").trim() || String(row.edition?.title ?? "").trim() || "(untitled)";
}

function coverStoragePath(row: RelatedItemRow): string | null {
  const coverMedia = (row.media ?? []).find((entry) => entry.kind === "cover")?.storage_path ?? null;
  if (coverMedia) return coverMedia;
  const firstMedia = (row.media ?? [])[0]?.storage_path ?? null;
  if (firstMedia) return firstMedia;
  const original = String(row.cover_original_url ?? "").trim();
  return original && !isRemoteUrl(original) ? original : null;
}

function coverSrc(row: RelatedItemRow, signedMap: Record<string, string>): string | null {
  const resolved = String(row.resolved_cover_url ?? "").trim();
  if (resolved) return resolved;
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

function matchesMediaScope(row: RelatedItemRow, scope: RelatedItemsCandidate["mediaScope"]): boolean {
  const objectType = String(row.object_type ?? "").trim().toLowerCase();
  if (scope === "book") return objectType !== "music";
  if (scope === "music") return objectType === "music";
  return true;
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function includesName(values: Array<string | null | undefined>, target: string): boolean {
  const normalizedTarget = normalizeName(target);
  if (!normalizedTarget) return false;
  return values.some((value) => normalizeName(value) === normalizedTarget);
}

function rowMatchesCandidate(row: RelatedItemRow, candidate: RelatedItemsCandidate, entityId: string | null): boolean {
  if (!matchesMediaScope(row, candidate.mediaScope)) return false;

  if (entityId) {
    const hasEntityMatch = (row.book_entities ?? []).some((entry) => {
      const role = String(entry?.role ?? "").trim().toLowerCase();
      const rowEntityId = String(entry?.entity_id ?? entry?.entity?.id ?? "").trim();
      return role === candidate.role && rowEntityId === entityId;
    });
    if (hasEntityMatch) return true;
  }

  if (candidate.role === "author") {
    return includesName([...(row.authors_override ?? []), ...((row.edition?.authors ?? []) as string[])], candidate.name);
  }

  if (candidate.role === "designer") {
    return includesName(
      [
        ...(row.designers_override ?? []),
        ...((row.book_entities ?? [])
          .filter((entry) => {
            const role = String(entry?.role ?? "").trim().toLowerCase();
            return role === "designer" || role === "design";
          })
          .map((entry) => entry.entity?.name ?? null))
      ],
      candidate.name
    );
  }

  const music = parseMusicMetadata(row.music_metadata);
  if (candidate.mediaScope === "music") {
    if (candidate.role === "performer" && includesName([music?.primary_artist ?? null], candidate.name)) return true;
    return (row.book_entities ?? []).some((entry) => {
      const role = String(entry?.role ?? "").trim().toLowerCase();
      return role === candidate.role && normalizeName(entry?.entity?.name ?? "") === normalizeName(candidate.name);
    });
  }

  return false;
}

async function resolveEntityId(candidate: RelatedItemsCandidate): Promise<string | null> {
  const directId = String(candidate.entityId ?? "").trim();
  if (isUuid(directId)) return directId;
  if (!supabase) return null;

  const slug = String(candidate.entitySlug ?? "").trim().toLowerCase();
  if (slug) {
    const slugRes = await supabase.from("entities").select("id").eq("slug", slug).maybeSingle();
    const slugId = String((slugRes.data as any)?.id ?? "").trim();
    if (isUuid(slugId)) return slugId;
  }

  const name = String(candidate.name ?? "").trim();
  if (!name) return null;
  const nameRes = await supabase.from("entities").select("id").ilike("name", name).limit(1).maybeSingle();
  const nameId = String((nameRes.data as any)?.id ?? "").trim();
  return isUuid(nameId) ? nameId : null;
}

export default function RelatedItemsModule({
  ownerId,
  currentUserBookId,
  candidates,
  hrefMode,
  username,
  publicProfileVisibility
}: {
  ownerId: string | null | undefined;
  currentUserBookId: number;
  candidates: RelatedItemsCandidate[];
  hrefMode: "owner" | "public";
  username?: string | null;
  publicProfileVisibility?: "public" | "followers_only" | null;
}) {
  const [heading, setHeading] = useState<string | null>(null);
  const [rows, setRows] = useState<RelatedItemRow[]>([]);
  const [signedMap, setSignedMap] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);

  const dedupedCandidates = useMemo(() => {
    const seen = new Set<string>();
    const out: RelatedItemsCandidate[] = [];
    for (const candidate of candidates) {
      const role = String(candidate.role ?? "").trim().toLowerCase();
      const name = String(candidate.name ?? "").trim();
      const headingValue = String(candidate.heading ?? "").trim();
      if (!role || !name || !headingValue) continue;
      const key = `${role}:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...candidate, role, name, heading: headingValue });
    }
    return out;
  }, [candidates]);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!supabase || !ownerId || !currentUserBookId || dedupedCandidates.length === 0) {
        if (!alive) return;
        setHeading(null);
        setRows([]);
        setSignedMap({});
        return;
      }

      if (hrefMode === "owner") {
        const sessionRes = await supabase.auth.getSession();
        const token = sessionRes.data.session?.access_token ?? null;
        if (!token) {
          if (!alive) return;
          setHeading(null);
          setRows([]);
          setSignedMap({});
          setExpanded(false);
          return;
        }

        const res = await fetch(`/api/books/${currentUserBookId}/related`, {
          headers: { authorization: `Bearer ${token}` }
        });
        const payload = res.ok ? await res.json() : null;
        if (!alive) return;
        setHeading(typeof payload?.heading === "string" ? payload.heading : null);
        setRows(Array.isArray(payload?.rows) ? (payload.rows as RelatedItemRow[]) : []);
        setSignedMap({});
        setExpanded(false);
        return;
      }

      const resolvedEntityIds = new Map<string, string | null>();

      for (const candidate of dedupedCandidates) {
        const cacheKey = `${candidate.role}:${candidate.entityId ?? ""}:${candidate.entitySlug ?? ""}:${candidate.name.toLowerCase()}`;
        let entityId = resolvedEntityIds.get(cacheKey) ?? null;
        if (!entityId) {
          entityId = await resolveEntityId(candidate);
          resolvedEntityIds.set(cacheKey, entityId);
        }

        let matchedRows: RelatedItemRow[] = [];
        let nextSignedMap: Record<string, string> = {};

        {
          const BOOK_SELECT = "id,library_id,visibility,object_type,title_override,authors_override,designers_override,music_metadata,cover_original_url,cover_crop,edition:editions(title,cover_url,authors),media:user_book_media(kind,storage_path),book_entities(role,entity_id,entity:entities(id,name))";

          let candidateBookIds: number[] | null = null;
          if (entityId) {
            // Pre-filter via book_entities to avoid full catalog scan
            const entityBooksRes = await supabase
              .from("book_entities")
              .select("user_book_id")
              .eq("entity_id", entityId);
            if (!entityBooksRes.error) {
              candidateBookIds = ((entityBooksRes.data ?? []) as any[])
                .map((r) => Number(r.user_book_id))
                .filter((n) => Number.isFinite(n) && n > 0 && n !== currentUserBookId);
            }
          }

          let result;
          if (candidateBookIds !== null) {
            if (candidateBookIds.length === 0) continue;
            let query = supabase
              .from("user_books")
              .select(BOOK_SELECT)
              .eq("owner_id", ownerId)
              .in("id", candidateBookIds)
              .order("created_at", { ascending: false })
              .limit(100);
            if (hrefMode === "public") {
              if (publicProfileVisibility === "public") query = query.neq("visibility", "followers_only");
              else query = query.eq("visibility", "public");
            }
            result = await query;
          } else {
            let query = supabase
              .from("user_books")
              .select(BOOK_SELECT)
              .eq("owner_id", ownerId)
              .neq("id", currentUserBookId)
              .order("created_at", { ascending: false })
              .limit(500);
            if (hrefMode === "public") {
              if (publicProfileVisibility === "public") query = query.neq("visibility", "followers_only");
              else query = query.eq("visibility", "public");
            }
            result = await query;
          }

          if (result.error) continue;

          const allRows = (result.data ?? []) as unknown as RelatedItemRow[];
          matchedRows = allRows.filter((row) => rowMatchesCandidate(row, candidate, entityId));
        }
        if (matchedRows.length < 1) continue;

        const paths = Array.from(
          new Set(
            matchedRows
              .map((row) => coverStoragePath(row))
              .filter((value): value is string => Boolean(value))
          )
        );

        if (paths.length > 0) {
          const signed = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 30);
          for (const row of signed.data ?? []) {
            if (row.path && row.signedUrl) nextSignedMap[row.path] = row.signedUrl;
          }
        }

        if (!alive) return;
        setHeading(candidate.heading);
        setRows(matchedRows);
        setSignedMap(nextSignedMap);
        setExpanded(false);
        return;
      }

      if (!alive) return;
      setHeading(null);
      setRows([]);
      setSignedMap({});
      setExpanded(false);
    }

    void load();

    return () => {
      alive = false;
    };
  }, [currentUserBookId, dedupedCandidates, hrefMode, ownerId, publicProfileVisibility]);

  if (!heading || rows.length < 1) return null;
  const visibleRows = expanded ? rows : rows.slice(0, 4);
  const showPager = rows.length > 4;

  return (
    <>
      <hr className="divider" />
      <div style={{ marginTop: "var(--space-lg)" }}>
        <div>{heading}</div>
        <div className="om-related-items-grid" style={{ marginTop: "var(--space-14)" }}>
          {visibleRows.map((row) => {
            const title = effectiveTitle(row);
            const href =
              hrefMode === "public" && username
                ? `/u/${encodeURIComponent(username)}/b/${bookIdSlug(row.id, title)}`
                : `/app/books/${row.id}`;
            const src = coverSrc(row, signedMap);
            return (
              <div key={row.id}>
                <Link href={href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                  <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
                    <CoverImage alt={title} src={src} cropData={row.cover_crop} style={{ display: "block", width: "100%", height: "auto" }} objectFit="contain" />
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
