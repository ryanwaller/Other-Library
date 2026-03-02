"use client";

import { useState, useMemo } from "react";
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

type SortMode = "latest" | "earliest" | "title_asc" | "title_desc";

function effectiveTitleFor(b: PublicBook): string {
  const e = b.edition;
  return (b.title_override ?? "").trim() || e?.title || "(untitled)";
}

function effectiveAuthorsFor(b: PublicBook): string[] {
  const override = (b.authors_override ?? []).filter(Boolean);
  if (override.length > 0) return override;
  return (b.edition?.authors ?? []).filter(Boolean);
}

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
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [gridCols, setGridCols] = useState<2 | 4 | 8>(4);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [sortOpen, setSortOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const displayGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = groups.map((g, idx) => ({ g, idx }));

    if (q) {
      result = result.filter(({ g }) => {
        const title = effectiveTitleFor(g.primary).toLowerCase();
        const authors = effectiveAuthorsFor(g.primary).join(" ").toLowerCase();
        return title.includes(q) || authors.includes(q);
      });
    }

    if (sortMode === "earliest") {
      result = result.slice().reverse();
    } else if (sortMode === "title_asc") {
      result = result.slice().sort((a, b) =>
        effectiveTitleFor(a.g.primary).localeCompare(effectiveTitleFor(b.g.primary))
      );
    } else if (sortMode === "title_desc") {
      result = result.slice().sort((a, b) =>
        effectiveTitleFor(b.g.primary).localeCompare(effectiveTitleFor(a.g.primary))
      );
    }

    return result.map(({ g }) => g);
  }, [groups, searchQuery, sortMode]);

  const containerStyle = useMemo((): React.CSSProperties => {
    if (viewMode === "list") {
      return { marginTop: 24, display: "flex", flexDirection: "column", gap: 8 };
    }
    return { marginTop: 24, display: "grid", gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 12 };
  }, [viewMode, gridCols]);

  return (
    <>
      <div className="row" style={{ marginTop: 2, alignItems: "baseline", gap: 12 }}>
        <button
          type="button"
          className={sortOpen ? "text-primary" : "muted"}
          onClick={() => setSortOpen((v) => !v)}
        >
          View by
        </button>
        <input
          className="om-inline-search-input"
          placeholder="Search books"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ minWidth: 0, flex: 1 }}
        />
      </div>

      {sortOpen && (
        <div className="om-filter-row" style={{ marginTop: 10, marginBottom: 4, gap: 10, alignItems: "center" }}>
          <select className="om-filter-control" value={viewMode} onChange={(e) => setViewMode(e.target.value as "grid" | "list")}>
            <option value="grid">grid</option>
            <option value="list">list</option>
          </select>
          {viewMode === "grid" && (
            <select className="om-filter-control" value={gridCols} onChange={(e) => setGridCols(Number(e.target.value) as 2 | 4 | 8)}>
              <option value={2}>2</option>
              <option value={4}>4</option>
              <option value={8}>8</option>
            </select>
          )}
          <select className="om-filter-control" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
            <option value="latest">latest</option>
            <option value="earliest">earliest</option>
            <option value="title_asc">title A-Z</option>
            <option value="title_desc">title Z-A</option>
          </select>
        </div>
      )}

      <PagedBookList
        items={displayGroups}
        viewMode={viewMode}
        gridCols={gridCols}
        searchQuery={searchQuery}
        containerStyle={containerStyle}
        renderItem={(g) => {
          const b = g.primary;
          const e = b.edition;
          const title = effectiveTitleFor(b);
          const authors = effectiveAuthorsFor(b);
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

          if (viewMode === "list") {
            return (
              <div key={b.id} className="om-book-card" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Link href={href} className="om-book-card-link" style={{ flexShrink: 0 }}>
                  <div className="om-cover-slot" style={{ width: 60, height: "auto" }}>
                    <CoverImage alt={title} src={imageSrc} cropData={cropData} style={{ width: "100%", height: "auto", display: "block" }} objectFit="contain" />
                  </div>
                </Link>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link href={href}>{title}</Link>
                  <div className="om-book-secondary">
                    {authors.length > 0
                      ? authors.map((a, idx) => (
                          <span key={a}>
                            <Link href={`/u/${username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                            {idx < authors.length - 1 ? <span>, </span> : null}
                          </span>
                        ))
                      : "—"}
                  </div>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <AddToLibraryButton
                    editionId={e?.id ?? null}
                    titleFallback={title}
                    authorsFallback={authors}
                    sourceOwnerId={profileId}
                    compact
                  />
                </div>
              </div>
            );
          }

          return (
            <div key={b.id} className="om-book-card">
              <div style={{ position: "relative" }}>
                <Link href={href} style={{ display: "block" }} className="om-book-card-link">
                  <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
                    <CoverImage alt={title} src={imageSrc} cropData={cropData} style={{ width: "100%", height: "auto", display: "block" }} objectFit="contain" />
                  </div>
                </Link>
                <div className="om-cover-add-btn" style={{ position: "absolute", top: 6, right: 6, zIndex: 1 }}>
                  <AddToLibraryButton
                    editionId={e?.id ?? null}
                    titleFallback={title}
                    authorsFallback={authors}
                    sourceOwnerId={profileId}
                    compact
                  />
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <Link href={href}>{title}</Link>
              </div>
              <div className="om-book-secondary">
                {authors.length > 0
                  ? authors.map((a, idx) => (
                      <span key={a}>
                        <Link href={`/u/${username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                        {idx < authors.length - 1 ? <span>, </span> : null}
                      </span>
                    ))
                  : "—"}
              </div>
            </div>
          );
        }}
      />
    </>
  );
}
