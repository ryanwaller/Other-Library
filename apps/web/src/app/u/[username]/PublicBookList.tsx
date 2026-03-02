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
  subjects_override: string[] | null;
  publisher_override: string | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: { 
    id: number; 
    isbn13: string | null; 
    title: string | null; 
    authors: string[] | null; 
    cover_url: string | null;
    subjects: string[] | null;
    publisher: string | null;
    publish_date: string | null;
    description: string | null;
  } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

type CatalogGroup = { key: string; libraryId: number; primary: PublicBook; copies: PublicBook[] };

type SortMode = "latest" | "earliest" | "title_asc" | "title_desc";

type Props = {
  libraries: Array<{ id: number; name: string }>;
  groups: CatalogGroup[];
  username: string;
  profileId: string;
  signedMap: Record<string, string>;
  showLibraryBlocks: boolean;
  activeFilters: { author?: string; subject?: string; tag?: string; category?: string; publisher?: string };
  totalLibrariesCount: number;
};

function normalizeKeyPart(input: string): string {
  return (input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

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
  libraries,
  groups,
  username,
  profileId,
  signedMap,
  showLibraryBlocks,
  activeFilters,
  totalLibrariesCount
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [gridCols, setGridCols] = useState<2 | 4 | 8>(4);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [sortOpen, setSortOpen] = useState(false);

  const filteredGroups = useMemo(() => {
    let result = groups.slice();

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(({ primary: b }) => {
        const title = effectiveTitleFor(b).toLowerCase();
        const authors = effectiveAuthorsFor(b).join(" ").toLowerCase();
        return title.includes(q) || authors.includes(q);
      });
    }

    if (sortMode === "latest") {
      result.sort((a, b) => b.primary.id - a.primary.id);
    } else if (sortMode === "earliest") {
      result.sort((a, b) => a.primary.id - b.primary.id);
    } else if (sortMode === "title_asc") {
      result.sort((a, b) => effectiveTitleFor(a.primary).localeCompare(effectiveTitleFor(b.primary)));
    } else if (sortMode === "title_desc") {
      result.sort((a, b) => effectiveTitleFor(b.primary).localeCompare(effectiveTitleFor(a.primary)));
    }

    return result;
  }, [groups, searchQuery, sortMode]);

  const containerStyle = useMemo((): React.CSSProperties => {
    if (viewMode === "list") {
      return { display: "flex", flexDirection: "column", gap: 8 };
    }
    return { display: "grid", gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 12 };
  }, [viewMode, gridCols]);

  const hasActiveFilters = Object.values(activeFilters).some(Boolean);

  const renderBook = (g: CatalogGroup) => {
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
    const cropData = g.copies.find((c) => c.cover_crop)?.cover_crop ?? null;
    const originalSrc =
      g.copies
        .map((c) => (c.cover_original_url ? signedMap[c.cover_original_url] : null))
        .find(Boolean) ?? null;
    const href = `/u/${username}/b/${bookIdSlug(b.id, title)}`;

    if (viewMode === "list") {
      return (
        <div key={g.key} className="card" style={{ display: "flex", gap: 12, alignItems: "start" }}>
          <Link href={href} style={{ display: "block" }} className="om-book-card-link">
            <div className="om-cover-slot" style={{ width: 60, height: "auto" }}>
              <CoverImage alt={title} src={originalSrc ?? coverUrl} cropData={cropData} style={{ width: "100%", height: "auto", display: "block" }} objectFit="contain" />
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
          <div style={{ marginLeft: "auto" }}>
            <AddToLibraryButton editionId={e?.id ?? null} titleFallback={title} authorsFallback={authors} compact />
          </div>
        </div>
      );
    }

    return (
      <div key={g.key} className="om-book-card" style={{ position: "relative" }}>
        <Link href={href} className="om-book-card-link" style={{ display: "block" }}>
          <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
            <CoverImage alt={title} src={originalSrc ?? coverUrl} cropData={cropData} style={{ width: "100%", height: "auto", display: "block" }} objectFit="contain" />
          </div>
        </Link>
        <div className="om-cover-add-btn" style={{ position: "absolute", top: 6, right: 6, zIndex: 1 }}>
          <AddToLibraryButton
            editionId={e?.id ?? null}
            titleFallback={title}
            authorsFallback={authors}
            compact
          />
        </div>
        <div style={{ marginTop: 10 }} className="book-title">
          <Link href={href}>{title}</Link>
        </div>
        <div className="book-author muted">
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
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      {/* Header Lockup */}
      <div className="row" style={{ justifyContent: "space-between", margin: 0 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center", margin: 0 }}>
          <span className="muted">Catalogs</span>
          <span>{totalLibrariesCount}</span>
          <span className="muted">Books</span>
          <span>{filteredGroups.length}</span>
        </div>
        <div className="row muted" style={{ gap: 10, justifyContent: "flex-end", margin: 0 }}>
          {hasActiveFilters ? (
            <>
              {(() => {
                const pairs: Array<{ label: string; value: string }> = [];
                if (activeFilters.category) pairs.push({ label: "Category", value: activeFilters.category });
                if (activeFilters.tag) pairs.push({ label: "Tag", value: activeFilters.tag });
                if (activeFilters.author) pairs.push({ label: "Author", value: activeFilters.author });
                if (activeFilters.subject) pairs.push({ label: "Subject", value: activeFilters.subject });
                if (activeFilters.publisher) pairs.push({ label: "Publisher", value: activeFilters.publisher });
                return pairs.length ? (
                  <span style={{ display: "inline-flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                    {pairs.map((p) => (
                      <span key={`${p.label}:${p.value}`} className="row" style={{ gap: 12, alignItems: "baseline" }}>
                        <span className="muted">{p.label}</span>
                        <span style={{ color: "var(--fg)" }}>{p.value}</span>
                      </span>
                    ))}
                  </span>
                ) : null;

                })()}<Link href={`/u/${username}`} className="om-clear-filter-btn">clear</Link>

            </>
          ) : null}
        </div>
      </div>

      <div className="row" style={{ margin: 0, alignItems: "baseline", gap: 12 }}>
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

      <div style={{ marginTop: 32 }} />

      {showLibraryBlocks ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {libraries.map((lib) => {
            const libGroups = filteredGroups.filter(g => g.libraryId === lib.id);
            if (libGroups.length === 0) return null;
            return (
              <div key={lib.id}>
                <div style={{ marginBottom: 10 }}>{lib.name}</div>
                <PagedBookList
                  items={libGroups}
                  viewMode={viewMode}
                  gridCols={gridCols}
                  searchQuery={searchQuery}
                  containerStyle={containerStyle}
                  renderItem={renderBook}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <PagedBookList
          items={filteredGroups}
          viewMode={viewMode}
          gridCols={gridCols}
          searchQuery={searchQuery}
          containerStyle={containerStyle}
          renderItem={renderBook}
        />
      )}
    </div>
  );
}
