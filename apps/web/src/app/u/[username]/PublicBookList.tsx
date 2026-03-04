"use client";

import { useState, useMemo, useEffect, Fragment } from "react";
import Link from "next/link";
import { bookIdSlug } from "../../../lib/slug";
import AddToLibraryButton from "./AddToLibraryButton";
import CoverImage from "../../../components/CoverImage";
import ActiveFilterDisplay, { type FilterPair } from "../../../components/ActiveFilterDisplay";
import PagedBookList from "../../app/components/PagedBookList";
import type { PublicBook, CatalogGroup } from "../../../lib/types";
import { 
  effectiveTitleFor, 
  effectiveAuthorsFor, 
  groupKeyFor 
} from "../../../lib/book";

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

export default function PublicBookList({
  libraries,
  allBooks,
  username,
  signedMap,
  showLibraryBlocks,
  initialFilters
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [gridCols, setGridCols] = useState<1 | 2 | 4 | 8>(4);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [sortOpen, setSortOpen] = useState(false);
  const [collapsedByLibraryId, setCollapsedByLibraryId] = useState<Record<number, boolean>>({});

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    setGridCols((prev) => (prev > 2 ? 2 : prev));
  }, [isMobile]);

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
      const sorted = copies.slice().sort((a, b) => b.id - a.id); // Default stable sort
      const primary = sorted.slice().sort((a, b) => {
        const score = (x: PublicBook) => {
          let s = 0;
          if (x.media.some(m => m.kind === 'cover')) s += 1000;
          if (x.edition?.cover_url) s += 150;
          return s;
        };
        return score(b) - score(a);
      })[0]!;

      return { 
        key, 
        libraryId: primary.library_id, 
        primary, 
        copies: sorted,
        copiesCount: sorted.length,
        tagNames: [], // Not populated in this view currently
        categoryNames: [],
        filterAuthors: effectiveAuthorsFor(primary),
        filterSubjects: (primary.subjects_override ?? primary.edition?.subjects ?? []) as string[],
        filterPublishers: [primary.publisher_override || primary.edition?.publisher || ""],
        filterDesigners: (primary.designers_override ?? []) as string[],
        filterGroups: [primary.group_label || ""],
        filterDecades: [primary.decade || ""],
        title: effectiveTitleFor(primary),
        visibility: primary.visibility,
        effectiveVisibility: primary.visibility === "inherit" ? "public" : primary.visibility as any,
        latestCreatedAt: 0,
        earliestCreatedAt: 0
      };
    });

    // 3. Sort groups
    if (sortMode === "latest") {
      groups.sort((a, b) => b.primary.id - a.primary.id);
    } else if (sortMode === "earliest") {
      groups.sort((a, b) => a.primary.id - b.primary.id);
    } else if (sortMode === "title_asc") {
      groups.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortMode === "title_desc") {
      groups.sort((a, b) => b.title.localeCompare(a.title));
    }

    return groups;
  }, [allBooks, activeFilters, searchQuery, sortMode]);

  const effectiveCols = isMobile ? Math.min(gridCols, 2) : gridCols;

  const containerStyle = useMemo((): React.CSSProperties => {
    if (viewMode === "list") {
      return { display: "flex", flexDirection: "column", gap: "var(--space-8)" };
    }
    return { display: "grid", gridTemplateColumns: `repeat(${effectiveCols}, 1fr)`, gap: "var(--space-md)" };
  }, [viewMode, effectiveCols]);

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
        <div key={g.key} className="card" style={{ display: "flex", gap: "var(--space-md)", alignItems: "start" }}>
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
        <div style={{ marginTop: "var(--space-14)" }}>
          <Link href={href} style={{ color: "inherit" }}><span className="om-book-title">{title}</span></Link>
        </div>
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
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      {/* Header Lockup */}
      <div className="row" style={{ justifyContent: "space-between", margin: 0 }}>
        <div className="row" style={{ gap: "var(--space-10)", flexWrap: "wrap", alignItems: "center", margin: 0 }}>
          <span className="muted">Catalogs</span>
          <span>{libraries.length}</span>
          <span className="muted">Books</span>
          <span>{filteredGroups.length}</span>
        </div>
        <div className="row muted" style={{ gap: "var(--space-10)", justifyContent: "flex-end", margin: 0 }}>
          <ActiveFilterDisplay
            pairs={(() => {
              const pairs: FilterPair[] = [];
              if (activeFilters.category) pairs.push({ label: "Category", value: activeFilters.category, key: "category", onClear: () => {
                const next = { ...activeFilters }; delete next.category; setActiveFilters(next);
                const params = new URLSearchParams(window.location.search); params.delete("category");
                window.history.replaceState({}, "", `/u/${username}${params.toString() ? `?${params.toString()}` : ""}`);
              }});
              if (activeFilters.tag) pairs.push({ label: "Tag", value: activeFilters.tag, key: "tag", onClear: () => {
                const next = { ...activeFilters }; delete next.tag; setActiveFilters(next);
                const params = new URLSearchParams(window.location.search); params.delete("tag");
                window.history.replaceState({}, "", `/u/${username}${params.toString() ? `?${params.toString()}` : ""}`);
              }});
              if (activeFilters.author) pairs.push({ label: "Author", value: activeFilters.author, key: "author", onClear: () => {
                const next = { ...activeFilters }; delete next.author; setActiveFilters(next);
                const params = new URLSearchParams(window.location.search); params.delete("author");
                window.history.replaceState({}, "", `/u/${username}${params.toString() ? `?${params.toString()}` : ""}`);
              }});
              if (activeFilters.subject) pairs.push({ label: "Subject", value: activeFilters.subject, key: "subject", onClear: () => {
                const next = { ...activeFilters }; delete next.subject; setActiveFilters(next);
                const params = new URLSearchParams(window.location.search); params.delete("subject");
                window.history.replaceState({}, "", `/u/${username}${params.toString() ? `?${params.toString()}` : ""}`);
              }});
              if (activeFilters.publisher) pairs.push({ label: "Publisher", value: activeFilters.publisher, key: "publisher", onClear: () => {
                const next = { ...activeFilters }; delete next.publisher; setActiveFilters(next);
                const params = new URLSearchParams(window.location.search); params.delete("publisher");
                window.history.replaceState({}, "", `/u/${username}${params.toString() ? `?${params.toString()}` : ""}`);
              }});
              return pairs;
            })()}
            onClearAll={() => {
              setActiveFilters({});
              window.history.replaceState({}, "", `/u/${username}`);
            }}
          />
        </div>
      </div>

      <div className="row" style={{ margin: 0, alignItems: "baseline", gap: "var(--space-md)" }}>
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
        <div className="om-filter-row" style={{ marginTop: "var(--space-10)", marginBottom: 4, gap: "var(--space-10)", alignItems: "center" }}>
          <select className="om-filter-control" value={viewMode} onChange={(e) => setViewMode(e.target.value as "grid" | "list")}>
            <option value="grid">grid</option>
            {isMobile && <option value="list">list</option>}
          </select>
          {viewMode === "grid" && (
            <select className="om-filter-control" value={gridCols} onChange={(e) => setGridCols(Number(e.target.value) as 1 | 2 | 4 | 8)}>
              {isMobile && <option value={1}>1</option>}
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
        <div style={{ display: "flex", flexDirection: "column" }}>
          {libraries
            .filter(lib => filteredGroups.some(g => g.libraryId === lib.id))
            .map((lib, idx) => {
            const libGroups = filteredGroups.filter(g => g.libraryId === lib.id);
            const collapsed = !!collapsedByLibraryId[lib.id];
            const toggle = () => setCollapsedByLibraryId(prev => {
              const next = { ...prev };
              if (next[lib.id]) delete next[lib.id]; else next[lib.id] = true;
              return next;
            });
            return (
              <Fragment key={lib.id}>
              {idx > 0 && <hr className="om-hr" />}
              <div className="card" style={{ marginTop: idx === 0 ? 0 : 14 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "nowrap" }}>
                  <div className="row" style={{ gap: "var(--space-10)", flex: 1, alignItems: "baseline", flexWrap: "nowrap", minWidth: 0 }}>
                    <button
                      onClick={toggle}
                      aria-label={collapsed ? "Expand catalog" : "Collapse catalog"}
                      style={{ padding: 0, width: 16, minWidth: 16, display: "inline-flex", justifyContent: "center", alignItems: "center", border: "none", background: "transparent", cursor: "pointer", transform: "translateY(-2px)" }}
                    >
                      <span className="om-catalog-caret" data-collapsed={collapsed ? "true" : "false"} aria-hidden="true" />
                    </button>
                    <div className="row" style={{ flex: 1, justifyContent: "space-between", alignItems: "baseline", minWidth: 0 }}>
                      <button onClick={toggle} style={{ padding: "0 0 9px", border: "none", borderBottom: "1px solid transparent", background: "transparent", font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}>
                        {lib.name}
                      </button>
                      <span className="muted" style={{ marginLeft: "var(--space-md)", whiteSpace: "nowrap", paddingBottom: 9, borderBottom: "1px solid transparent" }}>
                        {libGroups.length}&nbsp;&nbsp;book{libGroups.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                </div>
                {!collapsed && (
                  <PagedBookList
                    items={libGroups}
                    viewMode={viewMode}
                    gridCols={gridCols}
                    searchQuery={searchQuery}
                    containerStyle={containerStyle}
                    renderItem={renderBook}
                  />
                )}
              </div>
              </Fragment>
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
