"use client";

import { useState, useMemo, useEffect } from "react";
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
  allBooks: PublicBook[]; // All visible books, unfiltered
  username: string;
  profileId: string;
  signedMap: Record<string, string>;
  showLibraryBlocks: boolean;
  initialFilters: { author?: string; subject?: string; tag?: string; category?: string; publisher?: string };
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

function groupKeyFor(b: PublicBook): string {
  const eId = b.edition?.id ?? null;
  if (eId) return `e:${eId}`;
  const title = normalizeKeyPart(effectiveTitleFor(b));
  const authors = effectiveAuthorsFor(b)
    .map((a) => normalizeKeyPart(a))
    .filter(Boolean)
    .join("|");
  return `m:${title}|${authors}`;
}

export default function PublicBookList({
  libraries,
  allBooks,
  username,
  profileId,
  signedMap,
  showLibraryBlocks,
  initialFilters
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [gridCols, setGridCols] = useState<2 | 4 | 8>(4);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [sortOpen, setSortOpen] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Use state for filters so we can clear them instantly
  const [activeFilters, setActiveFilters] = useState(initialFilters);

  const filteredGroups = useMemo(() => {
    // 1. Filter books based on activeFilters and searchQuery
    const filtered = allBooks.filter((b) => {
      if (activeFilters.author) {
        const authors = effectiveAuthorsFor(b).map(s => String(s).toLowerCase());
        if (!authors.includes(activeFilters.author.toLowerCase())) return false;
      }
      if (activeFilters.subject) {
        const subjects = (b.subjects_override ?? b.edition?.subjects ?? []).map(s => String(s).toLowerCase());
        if (!subjects.includes(activeFilters.subject.toLowerCase())) return false;
      }
      if (activeFilters.publisher) {
        const pub = b.publisher_override || b.edition?.publisher;
        if (String(pub ?? "").toLowerCase() !== activeFilters.publisher.toLowerCase()) return false;
      }
      
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const title = effectiveTitleFor(b).toLowerCase();
        const authors = effectiveAuthorsFor(b).join(" ").toLowerCase();
        const subjects = (b.subjects_override ?? b.edition?.subjects ?? []).join(" ").toLowerCase();
        const pub = (b.publisher_override || b.edition?.publisher || "").toLowerCase();
        if (!title.includes(q) && !authors.includes(q) && !subjects.includes(q) && !pub.includes(q)) return false;
      }
      return true;
    });

    // 2. Group the filtered books
    const byKey = new Map<string, PublicBook[]>();
    for (const b of filtered) {
      const key = groupKeyFor(b);
      const cur = byKey.get(key);
      if (!cur) byKey.set(key, [b]);
      else cur.push(b);
    }

    const groups: CatalogGroup[] = Array.from(byKey.entries()).map(([key, copies]) => {
      const primary = copies.slice().sort((a, b) => {
        const score = (x: PublicBook) => {
          let s = 0;
          if (x.media.some(m => m.kind === 'cover')) s += 1000;
          if (x.edition?.cover_url) s += 150;
          return s;
        };
        return score(b) - score(a);
      })[0]!;
      return { key, libraryId: primary.library_id, primary, copies };
    });

    // 3. Sort groups
    if (sortMode === "latest") {
      groups.sort((a, b) => b.primary.id - a.primary.id);
    } else if (sortMode === "earliest") {
      groups.sort((a, b) => a.primary.id - b.primary.id);
    } else if (sortMode === "title_asc") {
      groups.sort((a, b) => effectiveTitleFor(a.primary).localeCompare(effectiveTitleFor(b.primary)));
    } else if (sortMode === "title_desc") {
      groups.sort((a, b) => effectiveTitleFor(b.primary).localeCompare(effectiveTitleFor(a.primary)));
    }

    return groups;
  }, [allBooks, activeFilters, searchQuery, sortMode]);

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

    const truncatedAuthors = isMobile && authors.length > 2
      ? [...authors.slice(0, 2), "+ more"]
      : authors;
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
              {truncatedAuthors.length > 0
                ? truncatedAuthors.map((a, idx) => (
                    <span key={a}>
                      {isMobile && a === "+ more" ? (
                        <span className="muted">{a}</span>
                      ) : (
                        <button 
                          onClick={() => setActiveFilters({ author: a })}
                          className="om-filter-link"
                          style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}
                        >
                          {a}
                        </button>
                      )}
                      {idx < truncatedAuthors.length - 1 ? <span>, </span> : null}
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
          {truncatedAuthors.length > 0
            ? truncatedAuthors.map((a, idx) => (
                <span key={a}>
                  {isMobile && a === "+ more" ? (
                    <span className="muted">{a}</span>
                  ) : (
                    <button 
                      onClick={() => setActiveFilters({ author: a })}
                      className="om-filter-link"
                      style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}
                    >
                      {a}
                    </button>
                  )}
                  {idx < truncatedAuthors.length - 1 ? <span>, </span> : null}
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
          <span>{libraries.length}</span>
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
              })()}<button 
                onClick={() => {
                  setActiveFilters({});
                  window.history.replaceState({}, "", `/u/${username}`);
                }}
                className="om-clear-filter-btn"
              >clear</button>
            </>
          ) : null}
        </div>
      </div>

      <div className="row" style={{ width: "100%", margin: 0, alignItems: "baseline", gap: 12 }}>
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
              {!isMobile && (
                <>
                  <option value={4}>4</option>
                  <option value={8}>8</option>
                </>
              )}
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
