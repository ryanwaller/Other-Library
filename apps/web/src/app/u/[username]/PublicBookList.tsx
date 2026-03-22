"use client";

import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from "react";
import Link from "next/link";
import { bookIdSlug } from "../../../lib/slug";
import AddToLibraryButton from "./AddToLibraryButton";
import CoverImage from "../../../components/CoverImage";
import ActiveFilterDisplay, { type FilterPair } from "../../../components/ActiveFilterDisplay";
import PagedBookList from "../../app/components/PagedBookList";
import DenseListRow from "../../app/components/DenseListRow";
import type { PublicBook, CatalogGroup } from "../../../lib/types";
import { supabase } from "../../../lib/supabaseClient";
import { DECADE_OPTIONS } from "../../../lib/decades";
import { parseMusicMetadata } from "../../../lib/music";
import { detailFilterLabel, type DetailFilterKey } from "../../../lib/detailFilters";
import { 
  effectiveTitleFor, 
  effectiveAuthorsFor, 
  effectiveSecondaryLineFor,
  effectivePublisherFor,
  groupKeyFor,
  titleSortKeyFor
} from "../../../lib/book";
import {
  coverSizesForGrid,
  DEFAULT_DESKTOP_GRID_DENSITY,
  DEFAULT_MOBILE_GRID_COLS,
  gridColumnsHint,
  gridTemplateColumns,
  isDesktopGridDensity,
  isMobileGridCols,
  legacyGridColsToDesktopDensity,
  type DesktopGridDensity,
  type MobileGridCols
} from "../../../lib/grid";
import { isWishlistMode, type LibraryMode } from "../../../lib/collection";

type SortMode = "latest" | "earliest" | "title_asc" | "title_desc";

type Props = {
  libraries: Array<{ id: number; name: string; sort_order?: number | null; kind?: "catalog" | "wishlist" | null }>;
  allBooks: PublicBook[]; // All visible books, unfiltered
  username: string;
  profileId: string;
  collectionMode: LibraryMode;
  signedMap: Record<string, string>;
  showLibraryBlocks: boolean;
  initialSearch?: string;
  initialFilters: Partial<Record<Exclude<DetailFilterKey, "q">, string>>;
};

type MemberPreview = { userId: string; username: string; avatarUrl: string | null };
type PublicLibrary = { id: number; name: string; sort_order?: number | null; memberPreviews?: MemberPreview[] };
const EXTRA_DETAIL_FILTER_KEYS: Exclude<
  DetailFilterKey,
  "q" | "author" | "tag" | "category" | "publisher" | "subject" | "designer" | "editor" | "material" | "group" | "decade"
>[] = [
  "publish_date",
  "release_date",
  "original_release_year",
  "format",
  "release_type",
  "pressing",
  "catalog_number",
  "barcode",
  "country",
  "discogs_id",
  "musicbrainz_id",
  "speed",
  "channels",
  "disc_count",
  "limited_edition",
  "reissue"
];

function uniqCaseInsensitive(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const normalized = String(raw ?? "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function formatAddedDate(value: unknown): string | null {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return null;
  const now = Date.now();
  const diffDays = Math.floor((now - timestamp) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

export default function PublicBookList({
  libraries,
  allBooks,
  username,
  profileId,
  collectionMode,
  signedMap,
  showLibraryBlocks: _showLibraryBlocks,
  initialSearch,
  initialFilters
}: Props) {
  const PUBLIC_VIEW_MODE_KEY = "om_public_viewMode";
  const PUBLIC_DESKTOP_GRID_DENSITY_KEY = "om_public_desktopGridDensity";
  const PUBLIC_MOBILE_GRID_COLS_KEY = "om_public_mobileGridCols";
  const PUBLIC_SORT_MODE_KEY = "om_public_sortMode";
  const [searchQuery, setSearchQuery] = useState(initialSearch ?? "");
  const [queryFilter, setQueryFilter] = useState(initialSearch ?? "");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [desktopGridDensity, setDesktopGridDensity] = useState<DesktopGridDensity>(DEFAULT_DESKTOP_GRID_DENSITY);
  const [mobileGridCols, setMobileGridCols] = useState<MobileGridCols>(DEFAULT_MOBILE_GRID_COLS);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [sortOpen, setSortOpen] = useState(false);
  const [collapsedByLibraryId, setCollapsedByLibraryId] = useState<Record<number, boolean>>({});
  const [sharedBooks, setSharedBooks] = useState<PublicBook[]>([]);
  const [sharedLibraries, setSharedLibraries] = useState<PublicLibrary[]>([]);
  const [sharedSignedMap, setSharedSignedMap] = useState<Record<string, string>>({});
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const wishlistMode = isWishlistMode(collectionMode);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Sticky band
  const controlsBandRef = useRef<HTMLDivElement | null>(null);
  const controlsBandTopRef = useRef(0);
  const lastScrollYRef = useRef(0);
  const wasControlsPinnedOpenRef = useRef(false);
  const [controlsDocked, setControlsDocked] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [controlsBandHeight, setControlsBandHeight] = useState(0);
  const [controlsBandFrame, setControlsBandFrame] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  const controlsFixed = controlsDocked;
  const controlsPinnedOpen = sortOpen;

  const measureControlsBand = useCallback(() => {
    if (typeof window === "undefined" || !controlsBandRef.current) return;
    const rect = controlsBandRef.current.getBoundingClientRect();
    const container = controlsBandRef.current.closest(".container");
    if (container instanceof HTMLElement) {
      const containerRect = container.getBoundingClientRect();
      setControlsBandFrame({ left: containerRect.left, width: containerRect.width });
    } else {
      setControlsBandFrame({ left: rect.left, width: rect.width });
    }
    if (!controlsDocked) controlsBandTopRef.current = rect.top + window.scrollY;
    setControlsBandHeight(rect.height);
  }, [controlsDocked]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.requestAnimationFrame(measureControlsBand);
    const handleResize = () => window.requestAnimationFrame(measureControlsBand);
    window.addEventListener("resize", handleResize);
    return () => { window.cancelAnimationFrame(id); window.removeEventListener("resize", handleResize); };
  }, [measureControlsBand]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.requestAnimationFrame(measureControlsBand);
    return () => window.cancelAnimationFrame(id);
  }, [measureControlsBand, isMobile, sortOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    lastScrollYRef.current = window.scrollY;
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const stickyStart = Math.max(controlsBandTopRef.current - 8, 0);
      if (isMobile) {
        setControlsDocked(y > stickyStart);
        setControlsVisible(true);
        lastScrollYRef.current = y;
        return;
      }
      const lastY = lastScrollYRef.current;
      const isNearTop = y <= stickyStart;
      const scrollingDown = y > lastY + 2;
      const scrollingUp = y < lastY - 2;
      if (isNearTop) {
        setControlsDocked(false);
        setControlsVisible(true);
      } else {
        setControlsDocked(true);
        if (controlsPinnedOpen) setControlsVisible(true);
        else if (scrollingDown) setControlsVisible(false);
        else if (scrollingUp) setControlsVisible(true);
      }
      lastScrollYRef.current = y;
    };
    const onScroll = () => { if (ticking) return; ticking = true; window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [controlsPinnedOpen, isMobile]);

  useEffect(() => {
    const wasPinnedOpen = wasControlsPinnedOpenRef.current;
    if (controlsPinnedOpen) setControlsVisible(true);
    else if (wasPinnedOpen && controlsDocked) setControlsVisible(true);
    wasControlsPinnedOpenRef.current = controlsPinnedOpen;
  }, [controlsDocked, controlsPinnedOpen]);

  useEffect(() => {
    try {
      const vm = window.localStorage.getItem(PUBLIC_VIEW_MODE_KEY);
      const legacyGc = window.localStorage.getItem("om_public_gridCols");
      const density = window.localStorage.getItem(PUBLIC_DESKTOP_GRID_DENSITY_KEY);
      const mobileCols = window.localStorage.getItem(PUBLIC_MOBILE_GRID_COLS_KEY);
      const sm = window.localStorage.getItem(PUBLIC_SORT_MODE_KEY);
      if (vm === "grid" || vm === "list") setViewMode(vm);
      if (isDesktopGridDensity(density)) setDesktopGridDensity(density);
      else {
        const migrated = legacyGridColsToDesktopDensity(legacyGc);
        if (migrated) setDesktopGridDensity(migrated);
      }
      if (isMobileGridCols(mobileCols)) setMobileGridCols(Number(mobileCols) as MobileGridCols);
      else if (legacyGc === "1" || legacyGc === "2" || legacyGc === "3") setMobileGridCols(Number(legacyGc) as MobileGridCols);
      if (sm === "latest" || sm === "earliest" || sm === "title_asc" || sm === "title_desc") setSortMode(sm);
    } catch {
      // ignore
    }
  }, [PUBLIC_DESKTOP_GRID_DENSITY_KEY, PUBLIC_MOBILE_GRID_COLS_KEY, PUBLIC_SORT_MODE_KEY, PUBLIC_VIEW_MODE_KEY]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PUBLIC_VIEW_MODE_KEY, viewMode);
      window.localStorage.setItem(PUBLIC_DESKTOP_GRID_DENSITY_KEY, desktopGridDensity);
      window.localStorage.setItem(PUBLIC_MOBILE_GRID_COLS_KEY, String(mobileGridCols));
      window.localStorage.setItem(PUBLIC_SORT_MODE_KEY, sortMode);
    } catch {
      // ignore
    }
  }, [PUBLIC_DESKTOP_GRID_DENSITY_KEY, PUBLIC_MOBILE_GRID_COLS_KEY, PUBLIC_SORT_MODE_KEY, PUBLIC_VIEW_MODE_KEY, desktopGridDensity, mobileGridCols, sortMode, viewMode]);

  // Use state for filters so we can clear them instantly
  const [activeFilters, setActiveFilters] = useState(initialFilters);
  useEffect(() => {
    setActiveFilters(initialFilters);
  }, [initialFilters]);

  useEffect(() => {
    setSearchQuery(initialSearch ?? "");
    setQueryFilter(initialSearch ?? "");
  }, [initialSearch]);

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
      return uniqCaseInsensitive([...fromTags, ...fromEntities]);
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
      if (wishlistMode) {
        if (!alive) return;
        setSharedBooks([]);
        setSharedLibraries([]);
        setSharedSignedMap({});
        return;
      }
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
            sort_order: Number.isFinite(Number(l.sort_order)) ? Number(l.sort_order) : null,
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
  }, [username, authResolved, sessionUserId, wishlistMode]);

  const mergedAllBooks = useMemo(() => {
    const byId = new Map<number, PublicBook>();
    for (const b of allBooks) byId.set(Number(b.id), b);
    for (const b of sharedBooks) byId.set(Number(b.id), b);
    return Array.from(byId.values());
  }, [allBooks, sharedBooks]);
  const sharedBookIds = useMemo(() => {
    return new Set(sharedBooks.map((b) => Number(b.id)).filter((id) => Number.isFinite(id) && id > 0));
  }, [sharedBooks]);

  const combinedSignedMap = useMemo(() => ({ ...sharedSignedMap, ...signedMap }), [sharedSignedMap, signedMap]);

  const replaceUrl = useCallback((mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(window.location.search);
    mutate(params);
    if (wishlistMode) params.set("mode", "wishlist");
    else params.delete("mode");
    window.history.replaceState({}, "", `/u/${username}${params.toString() ? `?${params.toString()}` : ""}`);
  }, [username, wishlistMode]);

  const setCollectionMode = useCallback((nextMode: LibraryMode) => {
    const params = new URLSearchParams(window.location.search);
    if (nextMode === "wishlist") params.set("mode", "wishlist");
    else params.delete("mode");
    window.location.assign(`/u/${username}${params.toString() ? `?${params.toString()}` : ""}`);
  }, [username]);

  function setFilterAndUrl(key: Exclude<DetailFilterKey, "q">, value?: string) {
    const next = { ...activeFilters } as Partial<Record<Exclude<DetailFilterKey, "q">, string>>;
    if (value && value.trim()) {
      next[key] = value;
    } else {
      delete next[key];
    }
    setActiveFilters(next);
    replaceUrl((params) => {
      if (value && value.trim()) params.set(key, value);
      else params.delete(key);
    });
  }

  const filteredGroups = useMemo(() => {
    // 1. Filter books based on activeFilters and searchQuery
    const filtered = mergedAllBooks.filter((b) => {
      if (activeFilters.author) {
        const authors = effectiveAuthorsFor(b).map(s => String(s).toLowerCase());
        if (!authors.includes(activeFilters.author.toLowerCase())) return false;
      }
      if (activeFilters.publisher) {
        const pub = effectivePublisherFor(b);
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
      const music = parseMusicMetadata((b as any).music_metadata);
      if (activeFilters.publish_date) {
        const publishDate = String(b.publish_date_override ?? b.edition?.publish_date ?? "").trim().toLowerCase();
        if (publishDate !== activeFilters.publish_date.toLowerCase()) return false;
      }
      if (activeFilters.release_date) {
        if (String(music?.release_date ?? "").trim().toLowerCase() !== activeFilters.release_date.toLowerCase()) return false;
      }
      if (activeFilters.original_release_year) {
        if (String(music?.original_release_year ?? "").trim().toLowerCase() !== activeFilters.original_release_year.toLowerCase()) return false;
      }
      if (activeFilters.format) {
        if (String(music?.format ?? "").trim().toLowerCase() !== activeFilters.format.toLowerCase()) return false;
      }
      if (activeFilters.release_type) {
        if (String(music?.release_type ?? "").trim().toLowerCase() !== activeFilters.release_type.toLowerCase()) return false;
      }
      if (activeFilters.pressing) {
        if (String(music?.edition_pressing ?? "").trim().toLowerCase() !== activeFilters.pressing.toLowerCase()) return false;
      }
      if (activeFilters.catalog_number) {
        if (String(music?.catalog_number ?? "").trim().toLowerCase() !== activeFilters.catalog_number.toLowerCase()) return false;
      }
      if (activeFilters.barcode) {
        if (String(music?.barcode ?? "").trim().toLowerCase() !== activeFilters.barcode.toLowerCase()) return false;
      }
      if (activeFilters.country) {
        if (String(music?.country ?? "").trim().toLowerCase() !== activeFilters.country.toLowerCase()) return false;
      }
      if (activeFilters.discogs_id) {
        if (String(music?.discogs_id ?? "").trim().toLowerCase() !== activeFilters.discogs_id.toLowerCase()) return false;
      }
      if (activeFilters.musicbrainz_id) {
        if (String(music?.musicbrainz_id ?? "").trim().toLowerCase() !== activeFilters.musicbrainz_id.toLowerCase()) return false;
      }
      if (activeFilters.speed) {
        if (String(music?.speed ?? "").trim().toLowerCase() !== activeFilters.speed.toLowerCase()) return false;
      }
      if (activeFilters.channels) {
        if (String(music?.channels ?? "").trim().toLowerCase() !== activeFilters.channels.toLowerCase()) return false;
      }
      if (activeFilters.disc_count) {
        if (String(music?.disc_count ?? "").trim().toLowerCase() !== activeFilters.disc_count.toLowerCase()) return false;
      }
      if (activeFilters.limited_edition) {
        const limitedEditionValue = music?.limited_edition == null ? "" : music.limited_edition ? "yes" : "no";
        if (limitedEditionValue !== activeFilters.limited_edition.toLowerCase()) return false;
      }
      if (activeFilters.reissue) {
        const reissueValue = music?.reissue == null ? "" : music.reissue ? "reissue" : "original release";
        if (reissueValue !== activeFilters.reissue.toLowerCase()) return false;
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
        const contributors = (b.book_entities ?? []).map((row) => String(row?.entity?.name ?? "")).join(" ").toLowerCase();
        const musicParts = [
          music?.label,
          music?.format,
          music?.release_type,
          music?.edition_pressing,
          music?.catalog_number,
          music?.barcode,
          music?.country,
          music?.discogs_id,
          music?.musicbrainz_id,
          music?.speed,
          music?.channels,
          music?.color_variant,
          music?.reissue == null ? null : music?.reissue ? "reissue" : "original release",
          music?.packaging_type,
          ...(music?.genres ?? []),
          ...(music?.styles ?? []),
          ...(music?.tracklist ?? []).map((track) => `${track.position ?? ""} ${track.title} ${track.duration ?? ""}`.trim())
        ].filter(Boolean).join(" ").toLowerCase();
        if (!title.includes(q) && !authors.includes(q) && !subjects.includes(q) && !pub.includes(q) && !tags.includes(q) && !categories.includes(q) && !designers.includes(q) && !decades.includes(q) && !contributors.includes(q) && !musicParts.includes(q)) return false;
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
        filterPublishers: Array.from(
          new Set(
            sorted
              .map((copy) => effectivePublisherFor(copy))
              .filter((value) => String(value ?? "").trim().length > 0)
          )
        ),
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
      groups.sort((a, b) =>
        titleSortKeyFor(a.primary).localeCompare(titleSortKeyFor(b.primary), undefined, {
          numeric: true,
          sensitivity: "base"
        })
      );
    } else if (sortMode === "title_desc") {
      groups.sort((a, b) =>
        titleSortKeyFor(b.primary).localeCompare(titleSortKeyFor(a.primary), undefined, {
          numeric: true,
          sensitivity: "base"
        })
      );
    }

    return groups;
  }, [mergedAllBooks, activeFilters, searchQuery, sortMode]);

  const effectiveCols = gridColumnsHint(isMobile, mobileGridCols, desktopGridDensity);

  const coverSizes = useMemo(() => {
    if (viewMode === "list") return "60px";
    return coverSizesForGrid(isMobile, mobileGridCols, desktopGridDensity);
  }, [viewMode, isMobile, mobileGridCols, desktopGridDensity]);

  const containerStyle = useMemo((): React.CSSProperties => {
    if (viewMode === "list") {
      return { display: "flex", flexDirection: "column", gap: 0 };
    }
    return {
      display: "grid",
      gridTemplateColumns: gridTemplateColumns(isMobile, mobileGridCols, desktopGridDensity),
      gap: "var(--space-md)"
    };
  }, [viewMode, isMobile, mobileGridCols, desktopGridDensity]);

  const hasActiveFilters = Object.values(activeFilters).some(Boolean);
  const availableCategories = useMemo(
    () =>
      uniqCaseInsensitive(
        mergedAllBooks
          .flatMap((b) => namesForRole(b, "category"))
          .filter(Boolean)
      ).sort((a, b) => a.localeCompare(b)),
    [mergedAllBooks]
  );
  const availableTags = useMemo(
    () =>
      uniqCaseInsensitive(
        mergedAllBooks
          .flatMap((b) => namesForRole(b, "tag"))
          .filter(Boolean)
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
        sort_order: l.sort_order ?? existing?.sort_order ?? null,
        memberPreviews: (l as any).memberPreviews ?? existing?.memberPreviews ?? []
      });
    }
    if (byId.size > 0) {
      return Array.from(byId.values()).sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));
    }
    const ids = Array.from(new Set(filteredGroups.map((g) => g.libraryId))).filter((id) => Number.isFinite(id) && id > 0);
    return ids.map((id) => ({ id, name: `Catalog ${id}`, memberPreviews: [] }));
  }, [libraries, sharedLibraries, filteredGroups]);

  const showLibraryBlocks = useMemo(() => {
    const DEFAULT_LIBRARY_NAME = wishlistMode ? "Wishlist" : "Your catalog";
    return effectiveLibraries.length > 1 || (effectiveLibraries.length === 1 && effectiveLibraries[0]?.name !== DEFAULT_LIBRARY_NAME);
  }, [effectiveLibraries, wishlistMode]);

  const renderBook = (g: CatalogGroup) => {
    const b = g.primary;
    const e = b.edition;
    const title = effectiveTitleFor(b);
    const authors = effectiveAuthorsFor(b);
    const secondary = effectiveSecondaryLineFor(b);

    const truncatedAuthors =
      secondary.mode === "authors"
        ? effectiveCols >= 8 && secondary.values.length > 1
          ? [secondary.values[0], "+ more"]
          : isMobile && secondary.values.length > 2
            ? [...secondary.values.slice(0, 2), "+ more"]
            : secondary.values
        : secondary.values;

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
    const href = sharedBookIds.has(Number(b.id)) && !!sessionUserId ? `/app/books/${b.id}` : `/u/${username}/b/${bookIdSlug(b.id, title)}`;
    const roundedCoverStyle = wishlistMode ? { width: "100%", height: "auto", display: "block", borderRadius: 28, overflow: "hidden" } : { width: "100%", height: "auto", display: "block" };
    if (viewMode === "list") {
      return (
        <DenseListRow
          key={g.key}
          item={b}
          href={href}
          coverUrl={coverUrl}
          originalSrc={originalSrc}
          cropData={cropData}
          roundedCover={wishlistMode}
          utilityLabel={formatAddedDate((b as any).created_at)}
          trailingAction={
            <AddToLibraryButton
              editionId={e?.id ?? null}
              titleFallback={title}
              authorsFallback={authors}
              publisherFallback={effectivePublisherFor(b)}
              publishDateFallback={String(b.publish_date_override ?? e?.publish_date ?? "").trim() || null}
              sourceBookId={Number(b.id)}
              sourceOwnerId={profileId}
              compact
            />
          }
        />
      );
    }

    return (
      <div key={g.key} className="om-book-card" style={{ position: "relative" }}>
        <Link href={href} className="om-book-card-link" style={{ display: "block" }}>
          <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
            <CoverImage alt={title} src={originalSrc ?? coverUrl} cropData={cropData} style={roundedCoverStyle} objectFit="contain" sizes={coverSizes} />
          </div>
        </Link>
        <div className="om-cover-add-btn" style={{ position: "absolute", top: 6, right: 6, zIndex: 1 }}>
          <AddToLibraryButton
            editionId={e?.id ?? null}
            titleFallback={title}
            authorsFallback={authors}
            publisherFallback={effectivePublisherFor(b)}
            publishDateFallback={String(b.publish_date_override ?? e?.publish_date ?? "").trim() || null}
            sourceBookId={Number(b.id)}
            sourceOwnerId={profileId}
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
                  {secondary.mode === "plain" || a === "+ more" ? (
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
            : null}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {controlsFixed ? <div aria-hidden style={{ height: controlsBandHeight }} /> : null}
      <div
        ref={controlsBandRef}
        className="om-smart-sticky-band"
        style={
          controlsFixed && controlsBandFrame.width > 0
            ? { left: `${controlsBandFrame.left}px`, width: `${controlsBandFrame.width}px` }
            : undefined
        }
        data-docked={controlsDocked ? "true" : "false"}
        data-visible={!controlsDocked || controlsVisible ? "true" : "false"}
        data-fixed={controlsFixed ? "true" : "false"}
      >
      <div className="toolbar" style={{ flexDirection: "column", gap: "var(--space-sm)", marginBottom: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", margin: 0 }}>
          <div className="om-stat-line" style={{ margin: 0 }}>
            <span className="om-stat-pair">
              <span>{wishlistMode ? "Wishlist" : "Catalog"}</span>
            </span>
            <span className="om-stat-pair">
              <span className="text-muted">Items</span>
              <span>{filteredGroups.length}</span>
            </span>
          </div>
          <div className="row text-muted" style={{ gap: "var(--space-10)", justifyContent: "flex-end", margin: 0 }}>
            <ActiveFilterDisplay
              pairs={(() => {
                const pairs: FilterPair[] = [];
                if (queryFilter.trim()) {
                  pairs.push({ label: "Search", value: queryFilter.trim(), key: "q", onClear: () => {
                    replaceUrl((params) => params.delete("q"));
                    setQueryFilter("");
                    setSearchQuery("");
                  } });
                }
                if (activeFilters.category) pairs.push({ label: "Category", value: activeFilters.category, key: "category", onClear: () => setFilterAndUrl("category") });
                if (activeFilters.tag) pairs.push({ label: "Tag", value: activeFilters.tag, key: "tag", onClear: () => setFilterAndUrl("tag") });
                if (activeFilters.author) pairs.push({ label: "Author", value: activeFilters.author, key: "author", onClear: () => setFilterAndUrl("author") });
                if (activeFilters.subject) pairs.push({ label: "Subject", value: activeFilters.subject, key: "subject", onClear: () => setFilterAndUrl("subject") });
                if (activeFilters.designer) pairs.push({ label: "Designer", value: activeFilters.designer, key: "designer", onClear: () => setFilterAndUrl("designer") });
                if (activeFilters.publisher) pairs.push({ label: "Publisher", value: activeFilters.publisher, key: "publisher", onClear: () => setFilterAndUrl("publisher") });
                if (activeFilters.decade) pairs.push({ label: "Decade", value: activeFilters.decade, key: "decade", onClear: () => setFilterAndUrl("decade") });
                for (const key of EXTRA_DETAIL_FILTER_KEYS) {
                  const value = activeFilters[key];
                  if (!value) continue;
                  const label = detailFilterLabel(key);
                  if (!label) continue;
                  pairs.push({ label, value, key, onClear: () => setFilterAndUrl(key) });
                }
                return pairs;
              })()}
              onClearAll={() => {
                setActiveFilters({});
                setQueryFilter("");
                setSearchQuery("");
                replaceUrl((params) => {
                  Array.from(params.keys()).forEach((key) => {
                    if (key !== "mode") params.delete(key);
                  });
                });
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
            placeholder={wishlistMode ? "Search wishlist" : "Search books"}
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
              <select
                className="om-filter-control"
                value={isMobile ? String(mobileGridCols) : desktopGridDensity}
                onChange={(e) => {
                  if (isMobile) setMobileGridCols(Number(e.target.value) as MobileGridCols);
                  else setDesktopGridDensity(e.target.value as DesktopGridDensity);
                }}
              >
                {isMobile ? (
                  <>
                    <option value={3}>small</option>
                    <option value={2}>medium</option>
                    <option value={1}>large</option>
                  </>
                ) : (
                  <>
                    <option value="small">small</option>
                    <option value="medium">medium</option>
                    <option value="large">large</option>
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
            {(availableCategories.length > 0 || !!(activeFilters.category ?? "").trim()) && (
              <select className="om-filter-control" value={activeFilters.category ?? ""} onChange={(e) => setFilterAndUrl("category", e.target.value || undefined)}>
                <option value="">category</option>
                {availableCategories.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            {(availableTags.length > 0 || !!(activeFilters.tag ?? "").trim()) && (
              <select className="om-filter-control" value={activeFilters.tag ?? ""} onChange={(e) => setFilterAndUrl("tag", e.target.value || undefined)}>
                <option value="">tags</option>
                {availableTags.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
            {(availableDecades.length > 0 || !!(activeFilters.decade ?? "").trim()) && (
              <select className="om-filter-control" value={activeFilters.decade ?? ""} onChange={(e) => setFilterAndUrl("decade", e.target.value || undefined)}>
                <option value="">decade</option>
                {availableDecades.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
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
                        {libGroups.length}&nbsp;&nbsp;item{libGroups.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                </div>
                {!collapsed && (
                  <PagedBookList
                    items={libGroups}
                    viewMode={viewMode}
                    gridCols={effectiveCols}
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
          gridCols={effectiveCols}
          searchQuery={searchQuery}
          containerStyle={containerStyle}
          renderItem={renderBook}
        />
      )}
    </div>
  );
}
