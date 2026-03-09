"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CoverCrop } from "../../components/CoverImage";
import CoverImage from "../../components/CoverImage";
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
  visibility: "inherit" | "followers_only" | "public";
  object_type: string | null;
  title_override: string | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: { title: string | null; cover_url: string | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
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

      const resolvedEntityIds = new Map<string, string | null>();

      for (const candidate of dedupedCandidates) {
        const cacheKey = `${candidate.role}:${candidate.entityId ?? ""}:${candidate.entitySlug ?? ""}:${candidate.name.toLowerCase()}`;
        let entityId = resolvedEntityIds.get(cacheKey) ?? null;
        if (!entityId) {
          entityId = await resolveEntityId(candidate);
          resolvedEntityIds.set(cacheKey, entityId);
        }
        if (!entityId) continue;

        let query = supabase
          .from("user_books")
          .select(
            "id,visibility,object_type,title_override,cover_original_url,cover_crop,edition:editions(title,cover_url),media:user_book_media(kind,storage_path),book_entities!inner(role,entity_id)"
          )
          .eq("owner_id", ownerId)
          .neq("id", currentUserBookId)
          .eq("book_entities.role", candidate.role)
          .eq("book_entities.entity_id", entityId)
          .order("created_at", { ascending: false })
          .limit(64);

        if (hrefMode === "public") {
          if (publicProfileVisibility === "public") query = query.neq("visibility", "followers_only");
          else query = query.eq("visibility", "public");
        }

        const result = await query;
        if (result.error) continue;

        const matchedRows = ((result.data ?? []) as unknown as RelatedItemRow[]).filter((row) => matchesMediaScope(row, candidate.mediaScope));
        if (matchedRows.length < 3) continue;

        const displayRows = matchedRows.slice(0, 4);
        const paths = Array.from(
          new Set(
            displayRows
              .map((row) => coverStoragePath(row))
              .filter((value): value is string => Boolean(value))
          )
        );

        let nextSignedMap: Record<string, string> = {};
        if (paths.length > 0) {
          const signed = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 30);
          for (const row of signed.data ?? []) {
            if (row.path && row.signedUrl) nextSignedMap[row.path] = row.signedUrl;
          }
        }

        if (!alive) return;
        setHeading(candidate.heading);
        setRows(displayRows);
        setSignedMap(nextSignedMap);
        return;
      }

      if (!alive) return;
      setHeading(null);
      setRows([]);
      setSignedMap({});
    }

    void load();

    return () => {
      alive = false;
    };
  }, [currentUserBookId, dedupedCandidates, hrefMode, ownerId, publicProfileVisibility]);

  if (!heading || rows.length < 3) return null;

  return (
    <>
      <hr className="divider" />
      <div style={{ marginTop: "var(--space-lg)" }}>
        <div>{heading}</div>
        <div className="om-images-grid" style={{ marginTop: "var(--space-14)" }}>
          {rows.map((row) => {
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
      </div>
    </>
  );
}
