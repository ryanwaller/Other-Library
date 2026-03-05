"use client";

import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import Link from "next/link";
import { bookIdSlug } from "../../../lib/slug";
import AddToLibraryButton from "./AddToLibraryButton";
import CoverImage from "../../../components/CoverImage";
import ActiveFilterDisplay, { type FilterPair } from "../../../components/ActiveFilterDisplay";
import PagedBookList from "../../app/components/PagedBookList";
import type { PublicBook, CatalogGroup } from "../../../lib/types";
import { supabase } from "../../../lib/supabaseClient";
import { DECADE_OPTIONS } from "../../../lib/decades";
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
  initialFilters: { author?: string; tag?: string; category?: string; publisher?: string; decade?: string; subject?: string; designer?: string };
};

type MemberPreview = { userId: string; username: string; avatarUrl: string | null };
type PublicLibrary = { id: number; name: string; memberPreviews?: MemberPreview[] };

export default function PublicBookList({
  libraries,
  allBooks,
  username,
  signedMap,
  showLibraryBlocks: _showLibraryBlocks,
  initialFilters
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [gridCols, setGridCols] = useState<1 | 2 | 4 | 8>(4);
  const autoReducedGridColsRef = useRef<4 | 8 | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [sortOpen, setSortOpen] = useState(false);
  const [collapsedByLibraryId, setCollapsedByLibraryId] = useState<Record<number, boolean>>({});
  const [sharedBooks, setSharedBooks] = useState<PublicBook[]>([]);
  const [sharedLibraries, setSharedLibraries] = useState<PublicLibrary[]>([]);
  const [sharedSignedMap, setSharedSignedMap] = useState<Record<string, string>>({});
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setGridCols((prev) => {
        if (prev === 4 || prev === 8) {
          autoReducedGridColsRef.current = prev;
          return 2;
        }
        return prev;
      });
      return;
    }
    setGridCols((prev) => {
      const restore = autoReducedGridColsRef.current;
      if (restore && (prev === 1 || prev === 2)) {
        autoReducedGridColsRef.current = null;
        return restore;
      }
      return prev;
    });
  }, [isMobile]);

  // Use state for filters so we can clear them instantly
  const [activeFilters, setActiveFilters] = useState(initialFilters);
  useEffect(() => {
    setActiveFilters(initialFilters);
  }, [initialFilters]);

  function namesForRole(b: PublicBook, role: "tag" | "category" | "subject" | "designer"): string[] {
    if (role === "tag" || role === "category") {
      const fromTags = (b.book_tags ?? [])
        .map((bt) => bt?.tag)
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .filter((t) => t.kind === role)
        .map((t) => String(t.name ?? "").trim())
        .filter(Boolean);
      const fromEntities = (b.book_entities ?? [])
        .filter((row) => String(row?.role ?? "").trim() === role)
        .map((row) => String(row?.entity?.name ?? "").trim())
        .filter(Boolean);
      return Array.from(new Set([...fromTags, ...fromEntities]));
    }
    if (role === "subject") {
      const fromOverrides = (b.subjects_override ?? b.edition?.subjects ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
      const fromEntities = (b.book_entities ?? [])
        .filter((row) => String(row?.role ?? "").trim() === "subject")
        .map((row) => String(row?.entity?.name ?? "").trim())
        .filter(Boolean);
      return Array.from(new Set([...fromOverrides, ...fromEntities]));
    }
    const fromOverrides = (b.designers_override ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const fromEntities = (b.book_entities ?? [])
      .filter((row) => String(row?.role ?? "").trim() === "designer")
      .map((row) => String(row?.entity?.name ?? "").trim())
      .filter(Boolean);
    return Array.from(new Set([...fromOverrides, ...fromEntities]));
  }

  useEffect(() => {
    if (!supabase) {
      setAuthResolved(true);
      setSessionUserId(null);
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSessionUserId(data.session?.user?.id ?? null);
      setAuthResolved(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;
      setSessionUserId(next?.user?.id ?? null);
      setAuthResolved(true);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) return;
      if (!authResolved) return;
      if (!sessionUserId) {
        if (!alive) return;
        setSharedBooks([]);
        setSharedLibraries([]);
        setSharedSignedMap({});
        return;
      }
      const sess = await supabase.auth.getSession();
      const token = sess.data.session?.access_token ?? null;
      if (!token) {
        if (!alive) return;
        return;
      }
      const res = await fetch(`/api/public-profile/${encodeURIComponent(username)}/shared`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` }
      });
      const json = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok) return;
      const books = Array.isArray((json as any)?.books) ? ((json as any).books as PublicBook[]) : [];
      const libs = Array.isArray((json as any)?.libraries)
        ? (((json as any).libraries as any[]).map((l) => ({
            id: Number(l.id),
            name: String(l.name ?? ""),
            memberPreviews: Array.isArray(l.member_previews)
              ? (l.member_previews as any[])
                  .map((m) => ({
                    userId: String(m.user_id ?? ""),
                    username: String(m.username ?? ""),
                    avatarUrl: m.avatar_url ? String(m.avatar_url) : null
                  }))
                  .filter((m) => !!m.userId && !!m.username)
              : []
          })))
        : [];
      const signed = ((json as any)?.signed_map ?? {}) as Record<string, string>;
      setSharedBooks(books);
      setSharedLibraries(libs.filter((l) => Number.isFinite(l.id) && l.id > 0));
      setSharedSignedMap(signed && typeof signed === "object" ? signed : {});
    })();
    return () => {
      alive = false;
    };
  }, [username, authResolved, sessionUserId]);

  const mergedAllBooks = useMemo(() => {
    const byId = new Map<number, PublicBook>();
    for (const b of allBooks) byId.set(Number(b.id), b);
    for (const b of sharedBooks) byId.set(Number(b.id), b);
    return Array.from(byId.values());
  }, [allBooks, sharedBooks]);

  const combinedSignedMap = useMemo(() => ({ ...sharedSignedMap, ...signedMap }), [sharedSignedMap, signedMap]);

  function setFilterAndUrl(key: "author" | "tag" | "category" | "publisher" | "decade" | "subject" | "designer", value?: string) {
    const next = { ...activeFilters };
    if (value && value.trim()) {
      (next as any)[key] = value;
    } else {
      delete (next as any)[key];
    }
    setActiveFilters(next);
    const params = new URLSearchParams(window.location.search);
    if (value && value.trim()) params.set(key, value);
    else params.delete(key);
    window.history.replaceState({}, "", `/u/${username}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const filteredGroups = useMemo(() => {
    // 1. Filter books based on activeFilters and searchQuery
    const filtered = mergedAllBooks.filter((b) => {
      if (activeFilters.author) {
        const authors = effectiveAuthorsFor(b).map(s => String(s).toLowerCase());
        if (!authors.includes(activeFilters.author.toLowerCase())) return false;
      }
      if (activeFilters.publisher) {
        const pub = b.publisher_override || b.edition?.publisher;
        if (String(pub ?? "").toLowerCase() !== activeFilters.publisher.toLowerCase()) return false;
      }
      if (activeFilters.category) {
        const categories = namesForRole(b, "category").map((n) => n.toLowerCase());
        if (!categories.includes(activeFilters.category.toLowerCase())) return false;
      }
      if (activeFilters.subject) {
        const subjects = namesForRole(b, "subject").map((n) => n.toLowerCase());
        if (!subjects.includes(activeFilters.subject.toLowerCase())) return false;
      }
      if (activeFilters.designer) {
        const designers = namesForRole(b, "designer").map((n) => n.toLowerCase());
        if (!designers.includes(activeFilters.designer.toLowerCase())) return false;
      }
      if (activeFilters.decade) {
        const decade = String(b.decade ?? "").toLowerCase();
        if (decade !== activeFilters.decade.toLowerCase()) return false;
      }
      if (activeFilters.tag) {
        const tags = namesForRole(b, "tag").map((n) => n.toLowerCase());
        if (!tags.includes(activeFilters.tag.toLowerCase())) return false;
      }
      
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const title = effectiveTitleFor(b).toLowerCase();
        const authors = effectiveAuthorsFor(b).join(" ").toLowerCase();
        const subjects = namesForRole(b, "subject").join(" ").toLowerCase();
        const pub = (b.publisher_override || b.edition?.publisher || "").toLowerCase();
        const tags = namesForRole(b, "tag").join(" ").toLowerCase();
        const categories = namesForRole(b, "category").join(" ").toLowerCase();
        const designers = namesForRole(b, "designer").join(" ").toLowerCase();
        const decades = String(b.decade ?? "").toLowerCase();
        if (!title.includes(q) && !authors.includes(q) && !subjects.includes(q) && !pub.includes(q) && !tags.includes(q) && !categories.includes(q) && !designers.includes(q) && !decades.includes(q)) return false;
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

      const tagNames = Array.from(new Set(sorted.flatMap((copy) => namesForRole(copy, "tag"))));
      const categoryNames = Array.from(new Set(sorted.flatMap((copy) => namesForRole(copy, "category"))));

      return { 
        key, 
        libraryId: primary.library_id, 
        primary, 
        copies: sorted,
        copiesCount: sorted.length,
        tagNames,
        categoryNames,
        filterAuthors: effectiveAuthorsFor(primary),
        filterSubjects: namesForRole(primary, "subject"),
        filterPublishers: [primary.publisher_override || primary.edition?.publisher || ""],
        filterDesigners: namesForRole(primary, "designer"),
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
  }, [mergedAllBooks, activeFilters, searchQuery, sortMode]);

  const effectiveCols = isMobile ? Math.min(gridCols, 2) : gridCols;

  const containerStyle = useMemo((): React.CSSProperties => {
    if (viewMode === "list") {
      return { display: "flex", flexDirection: "column", gap: "var(--space-8)" };
    }
    return { display: "grid", gridTemplateColumns: `repeat(${effectiveCols}, 1fr)`, gap: "var(--space-md)" };
  }, [viewMode, effectiveCols]);

  const hasActiveFilters = Object.values(activeFilters).some(Boolean);
  const availableCategories = useMemo(
    () =>
      Array.from(
        new Set(
          mergedAllBooks
            .flatMap((b) => namesForRole(b, "category"))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [mergedAllBooks]
  );
  const availableTags = useMemo(
    () =>
      Array.from(
        new Set(
          mergedAllBooks
            .flatMap((b) => namesForRole(b, "tag"))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [mergedAllBooks]
  );
  const availableDecades = useMemo(() => {
    const present = new Set(
      mergedAllBooks
        .map((b) => String(b.decade ?? "").trim())
        .filter(Boolean)
    );
    return DECADE_OPTIONS.filter((d) => present.has(d));
  }, [mergedAllBooks]);
  const effectiveLibraries = useMemo<PublicLibrary[]>(() => {
    const merged = [...libraries, ...sharedLibraries];
    const byId = new Map<number, PublicLibrary>();
    for (const l of merged) {
      const id = Number(l.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const existing = byId.get(id);
      byId.set(id, {
        id,
        name: String(l.name ?? `Catalog ${id}`),
        memberPreviews: (l as any).memberPreviews ?? existing?.memberPreviews ?? []
      });
    }
    if (byId.size > 0) return Array.from(byId.values());
    const ids = Array.from(new Set(filteredGroups.map((g) => g.libraryId))).filter((id) => Number.isFinite(id) && id > 0);
    return ids.map((id) => ({ id, name: `Catalog ${id}`, memberPreviews: [] }));
  }, [libraries, sharedLibraries, filteredGroups]);

  const showLibraryBlocks = useMemo(() => {
    const DEFAULT_LIBRARY_NAME = "Your catalog";
    return effectiveLibraries.length > 1 || (effectiveLibraries.length === 1 && effectiveLibraries[0]?.name !== DEFAULT_LIBRARY_NAME);
  }, [effectiveLibraries]);

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
          return combinedSignedMap[cover.storage_path] ?? null;
        })
        .find(Boolean) ?? e?.cover_url ?? null;
    const cropData = g.copies.find((c) => c.cover_crop)?.cover_crop ?? null;
    const originalSrc =
      g.copies
        .map((c) => (c.cover_original_url ? combinedSignedMap[c.cover_original_url] : null))
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
                        <span className="text-muted">{a}</span>
                      ) : (
                        <button 
                          onClick={() => setFilterAndUrl("author", a)}
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
                    <span className="text-muted">{a}</span>
                  ) : (
                    <button 
                      onClick={() => setFilterAndUrl("author", a)}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="toolbar" style={{ flexDirection: "column", gap: "var(--space-sm)", marginBottom: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", margin: 0 }}>
          <div className="om-stat-line" style={{ margin: 0 }}>
            <span className="om-stat-pair">
              <span className="text-muted">Catalogs</span>
              <span>{effectiveLibraries.length}</span>
            </span>
            <span className="om-stat-pair">
              <span className="text-muted">Books</span>
              <span>{filteredGroups.length}</span>
            </span>
          </div>
          <div className="row text-muted" style={{ gap: "var(--space-10)", justifyContent: "flex-end", margin: 0 }}>
            <ActiveFilterDisplay
              pairs={(() => {
                const pairs: FilterPair[] = [];
                if (activeFilters.category) pairs.push({ label: "Category", value: activeFilters.category, key: "category", onClear: () => setFilterAndUrl("category") });
                if (activeFilters.tag) pairs.push({ label: "Tag", value: activeFilters.tag, key: "tag", onClear: () => setFilterAndUrl("tag") });
                if (activeFilters.author) pairs.push({ label: "Author", value: activeFilters.author, key: "author", onClear: () => setFilterAndUrl("author") });
                if (activeFilters.subject) pairs.push({ label: "Subject", value: activeFilters.subject, key: "subject", onClear: () => setFilterAndUrl("subject") });
                if (activeFilters.designer) pairs.push({ label: "Designer", value: activeFilters.designer, key: "designer", onClear: () => setFilterAndUrl("designer") });
                if (activeFilters.publisher) pairs.push({ label: "Publisher", value: activeFilters.publisher, key: "publisher", onClear: () => setFilterAndUrl("publisher") });
                if (activeFilters.decade) pairs.push({ label: "Decade", value: activeFilters.decade, key: "decade", onClear: () => setFilterAndUrl("decade") });
                return pairs;
              })()}
              onClearAll={() => {
                setActiveFilters({});
                window.history.replaceState({}, "", `/u/${username}`);
              }}
            />
          </div>
        </div>

        <div className="row" style={{ width: "100%", margin: 0, alignItems: "baseline", gap: "var(--space-md)", flexWrap: "nowrap" }}>
          <button
            type="button"
            className={sortOpen ? "text-primary" : "text-muted"}
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
              <option value="list">list</option>
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
            <select className="om-filter-control" value={activeFilters.category ?? ""} onChange={(e) => setFilterAndUrl("category", e.target.value || undefined)}>
              <option value="">category</option>
              {availableCategories.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select className="om-filter-control" value={activeFilters.tag ?? ""} onChange={(e) => setFilterAndUrl("tag", e.target.value || undefined)}>
              <option value="">tags</option>
              {availableTags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select className="om-filter-control" value={activeFilters.decade ?? ""} onChange={(e) => setFilterAndUrl("decade", e.target.value || undefined)}>
              <option value="">decade</option>
              {(availableDecades.length > 0 ? availableDecades : DECADE_OPTIONS).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div style={{ height: "var(--catalog-top-gap)" }} />

      {showLibraryBlocks ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {effectiveLibraries
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
              <div className="card" style={{ marginTop: idx === 0 ? 0 : "var(--space-14)" }}>
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
                      <div className="row" style={{ alignItems: "center", gap: "var(--space-sm)", minWidth: 0, flexShrink: 1 }}>
                        <button onClick={toggle} style={{ padding: 0, border: "none", background: "transparent", font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}>
                          {lib.name}
                        </button>
                        {(lib.memberPreviews ?? []).length > 0 ? (
                          <span className="om-member-stack" aria-label="Shared catalog members">
                            {(lib.memberPreviews ?? []).slice(0, 6).map((m) => (
                              <Link key={m.userId} href={`/u/${m.username}`} aria-label={`Open ${m.username}'s profile`} title={m.username}>
                                {m.avatarUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img alt={m.username} src={m.avatarUrl} className="om-member-stack-avatar" />
                                ) : (
                                  <span className="om-member-stack-avatar" />
                                )}
                              </Link>
                            ))}
                            {(lib.memberPreviews ?? []).length > 6 ? (
                              <span className="om-member-stack-overflow" title={`${(lib.memberPreviews ?? []).length - 6} more members`}>
                                +{(lib.memberPreviews ?? []).length - 6}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
                      <span className="text-muted" style={{ marginLeft: "var(--space-md)", whiteSpace: "nowrap", paddingBottom: 9, borderBottom: "1px solid transparent" }}>
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
