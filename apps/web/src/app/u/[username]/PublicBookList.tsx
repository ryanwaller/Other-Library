"use client";

import Link from "next/link";
import { bookIdSlug } from "../../../lib/slug";
import AddToLibraryButton from "./AddToLibraryButton";
import CoverImage, { type CoverCrop } from "../../../components/CoverImage";
import PagedBookList from "../../app/components/PagedBookList";

type PublicBook = {
  id: number;
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  title_override: string | null;
  authors_override: string[] | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: { id: number; isbn13: string | null; title: string | null; authors: string[] | null; cover_url: string | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

type CatalogGroup = {
  key: string;
  libraryId: number;
  primary: PublicBook;
  copies: PublicBook[];
};

export default function PublicBookList({
  groups,
  username,
  profileId,
  signedMap
}: {
  groups: CatalogGroup[];
  username: string;
  profileId: string;
  signedMap: Record<string, string>;
}) {
  function effectiveTitleFor(b: PublicBook): string {
    const e = b.edition;
    return (b.title_override ?? "").trim() || e?.title || "(untitled)";
  }

  function effectiveAuthorsFor(b: PublicBook): string[] {
    const override = (b.authors_override ?? []).filter(Boolean);
    if (override.length > 0) return override;
    return (b.edition?.authors ?? []).filter(Boolean);
  }

  return (
    <PagedBookList
      items={groups}
      viewMode="grid"
      gridCols={4} // Default for public view
      containerStyle={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}
      renderItem={(g) => {
        const b = g.primary;
        const e = b.edition;
        const title = effectiveTitleFor(b);
        const effectiveAuthors = effectiveAuthorsFor(b);
        const coverUrl =
          g.copies
            .map((c) => {
              const cover = (c.media ?? []).find((m) => m.kind === "cover");
              if (!cover) return null;
              return signedMap[cover.storage_path] ?? null;
            })
            .find(Boolean) ?? e?.cover_url ?? null;
        const cropData = b.cover_crop ?? null;
        const imageSrc = cropData && b.cover_original_url ? (signedMap[b.cover_original_url] ?? coverUrl) : coverUrl;
        const href = `/u/${username}/b/${bookIdSlug(b.id, title)}`;
        return (
          <div key={b.id} className="om-book-card">
            <div className="row" style={{ justifyContent: "flex-end", alignItems: "center" }}>
              <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "nowrap" }}>
                <AddToLibraryButton
                  editionId={e?.id ?? null}
                  titleFallback={title}
                  authorsFallback={effectiveAuthors}
                  sourceOwnerId={profileId}
                  compact
                />
              </div>
            </div>
            <Link href={href} style={{ display: "block", marginTop: 6 }} className="om-book-card-link">
              <div className="om-cover-slot" style={{ width: "100%", aspectRatio: "2 / 3" }}>
                <CoverImage alt={title} src={imageSrc} cropData={cropData} style={{ width: "100%", height: "100%", display: "block" }} />
              </div>
            </Link>
            <div style={{ marginTop: 8 }}>
              <Link href={href}>{title}</Link>
            </div>
            <div className="om-book-secondary">
              {effectiveAuthors.length > 0 ? (
                effectiveAuthors.map((a, idx) => (
                  <span key={a}>
                    <Link href={`/u/${username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                    {idx < effectiveAuthors.length - 1 ? <span>, </span> : null}
                  </span>
                ))
              ) : "—"}
            </div>
          </div>
        );
      }}
    />
  );
}
