"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabaseClient";
import SignInCard from "../components/SignInCard";
import BulkBar from "./components/BulkBar";
import LibraryBlock from "./components/LibraryBlock";
import BookCard from "./components/BookCard";
import HomepageSkeleton from "./components/HomepageSkeleton";
import { useBookScanner } from "../../hooks/useBookScanner";
import usePageTitle from "../../hooks/usePageTitle";
import dynamic from "next/dynamic";
import ActiveFilterDisplay, { type FilterPair } from "../../components/ActiveFilterDisplay";
import type { CatalogItem, CatalogGroup } from "../../lib/types";
import { 
  normalizeKeyPart, 
  effectiveTitleFor, 
  effectiveAuthorsFor, 
  effectiveSubjectsFor, 
  effectivePublisherFor, 
  groupKeyFor,
  tagsFor
} from "../../lib/book";
import {
  normalizeIsbn,
  looksLikeIsbn,
  tryParseUrl,
  parseTitleAndAuthor
} from "../../lib/isbn";
import { DECADE_OPTIONS } from "../../lib/decades";
import { saveBookNavContext } from "../../lib/bookNav";
import { parseMusicMetadata, type MusicMetadata, type MusicContributorRole } from "../../lib/music";
import { contextFromFilterParams } from "../../lib/pageTitle";
import { DETAIL_FILTER_KEYS, detailFilterLabel, type DetailFilterKey } from "../../lib/detailFilters";

const BookScannerModal = dynamic(() => import("../../components/BookScannerModal"), { ssr: false });

type EditionMetadata = {
  isbn10?: string | null;
  isbn13?: string | null;
  title?: string | null;
  authors?: string[];
  publisher?: string | null;
  publish_date?: string | null;
  description?: string | null;
  subjects?: string[];
  cover_url?: string | null;
  raw?: Record<string, unknown>;
};

function looksLikeBarcode(input: string): boolean {
  const digits = input.trim().replace(/\D/g, "");
  return /^\d{12,14}$/.test(digits);
}

type SearchCandidate = {
  source: "openlibrary" | "googleBooks" | "discogs";
  object_type?: "book" | "music" | null;
  source_type?: string | null;
  source_url?: string | null;
  external_source_ids?: Record<string, string | null> | null;
  music_metadata?: MusicMetadata | null;
  contributor_entities?: Partial<Record<MusicContributorRole, string[]>> | null;
  title: string | null;
  authors: string[];
  publisher: string | null;
  publish_date: string | null;
  publish_year: number | null;
  description: string | null;
  subjects: string[];
  isbn10: string | null;
  isbn13: string | null;
  cover_url: string | null;
  cover_candidates?: string[];
};

type LibrarySummary = {
  id: number;
  name: string;
  created_at: string;
  sort_order?: number | null;
  owner_id?: string | null;
  myRole?: "owner" | "editor";
  memberPreviews?: Array<{ userId: string; username: string; avatarUrl: string | null }>;
};

type CatalogMemberView = {
  id: string;
  catalog_id: number;
  user_id: string;
  role: "owner" | "editor";
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  profile: { id: string; username: string; display_name: string | null; avatar_path: string | null; email: string | null } | null;
  avatar_url: string | null;
};

type CatalogHomeCachePayload = {
  ts: number;
  libraries: LibrarySummary[];
  books: any[];
};

function isStoragePath(value: string): boolean {
  const v = (value ?? "").trim();
  if (!v) return false;
  return !/^https?:\/\//i.test(v) && !/^data:/i.test(v);
}

function proxyExternalImageUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("blob:")) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  return `/api/image-proxy?url=${encodeURIComponent(trimmed)}`;
}

function toStoragePathCandidate(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  const normalizedInput = trimmed.startsWith("/") ? trimmed.replace(/^\/+/, "") : trimmed;
  const bucketPath = withoutStoragePathPrefix(normalizedInput);
  if (bucketPath) return bucketPath;

  if (isStoragePath(normalizedInput)) return normalizeStoragePath(normalizedInput);
  return null;
}

function withoutStoragePathPrefix(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const marker = "user-book-media/";
  if (trimmed.startsWith("public/") && trimmed.includes(marker)) {
    const idx = trimmed.indexOf(marker);
    return normalizeStoragePath(trimmed.slice(idx + marker.length));
  }
  if (trimmed.includes(`/${marker}`)) {
    const idx = trimmed.indexOf(`/${marker}`);
    return normalizeStoragePath(trimmed.slice(idx + `/${marker}`.length));
  }
  if (trimmed.includes(marker)) {
    const idx = trimmed.indexOf(marker);
    return normalizeStoragePath(trimmed.slice(idx + marker.length));
  }
  try {
    const url = new URL(trimmed);
    const { pathname } = url;
    if (pathname.includes(marker)) {
      const idx = pathname.indexOf(marker);
      return normalizeStoragePath(pathname.slice(idx + marker.length));
    }
  } catch {
    // ignore
  }
  return null;
}

function normalizeStoragePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutLeadingSlash = trimmed.replace(/^\/+/, "");
  return isStoragePath(withoutLeadingSlash) ? withoutLeadingSlash : null;
}

function toDisplayCoverUrl(mediaUrlsByPath: Record<string, string>, client: any, path?: string | null): string | null {
  if (typeof path !== "string") return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (!isStoragePath(trimmed)) return proxyExternalImageUrl(trimmed);

  const normalized = toStoragePathCandidate(trimmed);
  if (!normalized) return null;
  const direct = mediaUrlsByPath[normalized] ?? mediaUrlsByPath[`/${normalized}`];
  if (direct) return direct;
  if (!client) return null;
  const publicUrl = client.storage.from("user-book-media").getPublicUrl(normalized).data?.publicUrl;
  return publicUrl ?? null;
}

const HOMEPAGE_CACHE_KEY = "om_homepage_home_cache_v1";
const HOMEPAGE_CACHE_TTL_MS = 120_000;

function loadHomepageCache(): CatalogHomeCachePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HOMEPAGE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogHomeCachePayload;
    if (!parsed || !Array.isArray(parsed.libraries) || !Array.isArray(parsed.books) || typeof parsed.ts !== "number") return null;
    if (!Number.isFinite(parsed.ts) || Date.now() - parsed.ts > HOMEPAGE_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveHomepageCache(payload: CatalogHomeCachePayload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HOMEPAGE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore cache write failures
  }
}

function parseCsvToObjects(text: string): Array<Record<string, string>> {
  const src = (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] ?? "";
    const next = src[i + 1] ?? "";
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((v) => (v ?? "").trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((v) => (v ?? "").trim() !== "")) rows.push(row);

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => (h ?? "").trim());
  const out: Array<Record<string, string>> = [];
  for (const r of rows.slice(1)) {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i] ?? "";
      if (!key) continue;
      obj[key] = (r[i] ?? "").trim();
    }
    out.push(obj);
  }
  return out;
}

function splitListField(input: string): string[] {
  const raw = (input ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[;,]/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function parseAuthorsInput(input: string): string[] {
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function parseStructuredNotes(notes: string | null): {
  data: Record<string, string>;
  remainingNotes: string | null;
} {
  if (!notes) return { data: {}, remainingNotes: null };

  const pairs = notes.split(";");
  const data: Record<string, string> = {};
  const unmapped: string[] = [];

  const mappings: Record<string, string> = {
    objecttype: "object_type",
    "object type": "object_type",
    subject: "subjects_override",
    subjects: "subjects_override",
    decade: "decade",
    design: "designers_override",
    "art direction": "designers_override",
    designer: "designers_override",
    designers: "designers_override",
    production: "materials_override",
    tags: "subjects_override",
    tag: "subjects_override",
    editor: "editors_override",
    editors: "editors_override",
    printer: "printer_override",
    materials: "materials_override",
    material: "materials_override",
    pages: "pages",
    publisher: "publisher_override"
  };

  for (const p of pairs) {
    const trimmedPair = p.trim();
    if (!trimmedPair) continue;

    const colonIdx = trimmedPair.indexOf(":");
    if (colonIdx === -1) {
      unmapped.push(trimmedPair);
      continue;
    }

    const key = trimmedPair.slice(0, colonIdx).trim();
    const value = trimmedPair.slice(colonIdx + 1).trim();
    const lowerKey = key.toLowerCase();

    if (lowerKey === "id") {
      unmapped.push(trimmedPair);
      continue;
    }

    if (value && mappings[lowerKey]) {
      const targetKey = mappings[lowerKey];
      if (data[targetKey]) {
        data[targetKey] += `, ${value}`;
      } else {
        data[targetKey] = value;
      }
    } else {
      unmapped.push(trimmedPair);
    }
  }

  const remaining = unmapped.join("; ").trim();
  return {
    data,
    remainingNotes: remaining || null
  };
}

function AppShell({
  session,
  filterTag,
  filterAuthor,
  filterSubject,
  filterPublisher,
  filterDesigner,
  filterEditor,
  filterMaterial,
  filterPrinter,
  filterPerformer,
  filterComposer,
  filterProducer,
  filterEngineer,
  filterMastering,
  filterFeaturedArtist,
  filterArranger,
  filterConductor,
  filterOrchestra,
  filterArtDirection,
  filterArtwork,
  filterDesign,
  filterPhotography,
  filterGroup,
  filterDecade,
  filterCategory,
  openCsvPicker,
  openAddPanel
}: {
  session: Session;
  filterTag: string | null;
  filterAuthor: string | null;
  filterSubject: string | null;
  filterPublisher: string | null;
  filterDesigner: string | null;
  filterEditor: string | null;
  filterMaterial: string | null;
  filterPrinter: string | null;
  filterPerformer: string | null;
  filterComposer: string | null;
  filterProducer: string | null;
  filterEngineer: string | null;
  filterMastering: string | null;
  filterFeaturedArtist: string | null;
  filterArranger: string | null;
  filterConductor: string | null;
  filterOrchestra: string | null;
  filterArtDirection: string | null;
  filterArtwork: string | null;
  filterDesign: string | null;
  filterPhotography: string | null;
  filterGroup: string | null;
  filterDecade: string | null;
  filterCategory: string | null;
  openCsvPicker: boolean;
  openAddPanel: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tagButtonRef = useRef<HTMLButtonElement | null>(null);
  const categoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const tagMenuRef = useRef<HTMLDivElement | null>(null);
  const categoryMenuRef = useRef<HTMLDivElement | null>(null);
  const userId = session.user.id;
  const [profile, setProfile] = useState<{ username: string; visibility: string; avatar_path: string | null } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [debugLibrariesSource, setDebugLibrariesSource] = useState<string>("libs:init");
  const [debugBooksSource, setDebugBooksSource] = useState<string>("books:init");
  const [debugLastError, setDebugLastError] = useState<string>("");
  const { scannerOpen, openScanner, closeScanner } = useBookScanner();
  const [showScan, setShowScan] = useState(false);
  useEffect(() => {
    setShowScan(navigator.maxTouchPoints > 0 && window.isSecureContext);
  }, []);
  const [addInput, setAddInput] = useState("");
  const [addInputFocused, setAddInputFocused] = useState(false);
  const [addState, setAddState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [addUrlPreview, setAddUrlPreview] = useState<{
    title: string | null;
    authors: string[];
    publisher: string | null;
    publish_date: string | null;
    description: string | null;
    subjects: string[];
    isbn10: string | null;
    isbn13: string | null;
    cover_url: string | null;
    object_type?: "book" | "music" | null;
    source_type?: string | null;
    source_url?: string | null;
    external_source_ids?: Record<string, string | null> | null;
    music_metadata?: MusicMetadata | null;
    contributor_entities?: Partial<Record<MusicContributorRole, string[]>> | null;
    sources: string[];
  } | null>(null);
  const [addPreviewCoverFailed, setAddPreviewCoverFailed] = useState(false);
  const [addUrlMeta, setAddUrlMeta] = useState<{ final_url: string | null; domain: string | null; domain_kind: string | null }>({
    final_url: null,
    domain: null,
    domain_kind: null
  });
  const [addSearchResults, setAddSearchResults] = useState<
    SearchCandidate[]
  >([]);
  const [addSearchState, setAddSearchState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const addSearchPageSize = 8;
  const [addSearchLimit, setAddSearchLimit] = useState(addSearchPageSize);
  const [addPreviewLibraryId, setAddPreviewLibraryId] = useState<number | null>(null);
  const [addSearchLibraryIds, setAddSearchLibraryIds] = useState<Record<number, number>>({});

  useEffect(() => {
    setAddSearchLimit(addSearchPageSize);
  }, [addSearchResults]);

  function clearFilter(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    const qs = params.toString();
    router.push(`/app${qs ? `?${qs}` : ""}`);
  }

  function clearAllFilters() {
    setTagMode("all");
    setCategoryMode("all");
    setVisibilityMode("all");
    setSearchQuery("");
    try {
      router.replace("/app");
    } catch {
      if (typeof window !== "undefined") window.location.assign("/app");
    }
  }
  type CsvImportRow = {
    title: string;
    isbn: string | null;
    authors: string[];
    publisher: string | null;
    publish_date: string | null;
    description: string | null;
    category: string | null;
    tags: string[];
    notes: string | null;
    group_label: string | null;
    object_type: string | null;
    copies: number;
  };
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<CsvImportRow[]>([]);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const csvAutoOpenDoneRef = useRef(false);
  const [csvApplyOverrides, setCsvApplyOverrides] = useState(false);
  const [csvImportState, setCsvImportState] = useState<{ busy: boolean; error: string | null; message: string | null; done: number; total: number }>({
    busy: false,
    error: null,
    message: null,
    done: 0,
    total: 0
  });
  const [pendingCoverByBookId, setPendingCoverByBookId] = useState<Record<number, File | undefined>>({});
  const [coverUploadStateByBookId, setCoverUploadStateByBookId] = useState<
    Record<number, { busy: boolean; error: string | null; message: string | null } | undefined>
  >({});
  const [coverInputKeyByBookId, setCoverInputKeyByBookId] = useState<Record<number, number>>({});

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [mediaUrlsByPath, setMediaUrlsByPath] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [gridCols, setGridCols] = useState<1 | 2 | 4 | 8>(4);
  const [sortMode, setSortMode] = useState<"custom" | "latest" | "earliest" | "title_asc" | "title_desc">("custom");
  const [categoryMode, setCategoryMode] = useState<string>("all");
  const [visibilityMode, setVisibilityMode] = useState<"all" | "public" | "private">("all");
  const [tagMode, setTagMode] = useState<string>("all");
  const [tagSearch, setTagSearch] = useState<string>("");
  const memberPreviewHydratingRef = useRef(false);
  const sharedRevealDoneRef = useRef(false);
  const librariesRequestSeqRef = useRef(0);
  const booksRequestSeqRef = useRef(0);
  const [tagMenu, setTagMenu] = useState<{ open: boolean; top: number; left: number; minWidth: number }>({
    open: false,
    top: 0,
    left: 0,
    minWidth: 260
  });
  const [categorySearch, setCategorySearch] = useState<string>("");
  const [categoryMenu, setCategoryMenu] = useState<{ open: boolean; top: number; left: number; minWidth: number }>({
    open: false,
    top: 0,
    left: 0,
    minWidth: 260
  });
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [deleteStateByBookId, setDeleteStateByBookId] = useState<Record<number, { busy: boolean; error: string | null; message: string | null } | undefined>>(
    {}
  );

  const [libraries, setLibraries] = useState<LibrarySummary[]>([]);
  const [showSharedLibraries, setShowSharedLibraries] = useState(false);
  const [addLibraryId, setAddLibraryId] = useState<number | null>(null);
  const [editingLibraryId, setEditingLibraryId] = useState<number | null>(null);
  const [rearrangingLibraryId, setRearrangingLibraryId] = useState<number | null>(null);
  const [draggedItemKey, setDraggedItemKey] = useState<string | null>(null);
  const [draggedItemLibId, setDraggedItemLibId] = useState<number | null>(null);
  const [dragOverItemKey, setDragOverItemKey] = useState<string | null>(null);
  const [backupItems, setBackupItems] = useState<CatalogItem[] | null>(null);
  const scrollIntervalRef = useRef<any>(null);

  function handleDragStart(e: React.DragEvent, key: string, libraryId: number) {
    setDraggedItemKey(key);
    setDraggedItemLibId(libraryId);
    setBackupItems([...items]);
    e.dataTransfer.effectAllowed = "move";
    
    // Create a ghost image that is slightly larger
    const target = e.currentTarget as HTMLElement;
    if (target) {
      target.style.opacity = "0.99"; // force a layer
    }
  }

  function handleDragOver(e: React.DragEvent, key: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    // Auto-scroll logic
    const threshold = 100;
    const speed = 15;
    if (e.clientY < threshold) {
      if (!scrollIntervalRef.current) {
        scrollIntervalRef.current = setInterval(() => window.scrollBy(0, -speed), 16);
      }
    } else if (e.clientY > window.innerHeight - threshold) {
      if (!scrollIntervalRef.current) {
        scrollIntervalRef.current = setInterval(() => window.scrollBy(0, speed), 16);
      }
    } else {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    }
  }

  function handleDragEnter(e: React.DragEvent, targetKey: string, targetLibId: number) {
    e.preventDefault();
    if (!draggedItemKey || draggedItemKey === targetKey || targetLibId !== draggedItemLibId) return;
    setDragOverItemKey(targetKey);

    // Live reorder logic (Optimistic)
    const libId = targetLibId;
    const groups = displayGroupsByLibraryId[libId] ?? [];
    const sourceIdx = groups.findIndex(g => g.key === draggedItemKey);
    const targetIdx = groups.findIndex(g => g.key === targetKey);
    
    if (sourceIdx === -1 || targetIdx === -1) return;

    // Calculate new temporary sort_order for the source group items
    let newOrder: number;
    if (targetIdx === 0) {
      newOrder = (groups[0].sortOrder ?? 0) - 1000;
    } else if (targetIdx === groups.length - 1 && sourceIdx < targetIdx) {
      newOrder = (groups[groups.length - 1].sortOrder ?? 0) + 1000;
    } else {
      // If moving "down", we want to insert AFTER the target. 
      // If moving "up", we want to insert BEFORE.
      if (targetIdx > sourceIdx) {
        // Moving down: insert after target
        const afterTarget = groups[targetIdx + 1];
        newOrder = ((groups[targetIdx].sortOrder ?? 0) + (afterTarget?.sortOrder ?? (groups[targetIdx].sortOrder ?? 0) + 2000)) / 2;
      } else {
        // Moving up: insert before target
        const beforeTarget = groups[targetIdx - 1];
        newOrder = ((beforeTarget?.sortOrder ?? (groups[targetIdx].sortOrder ?? 0) - 2000) + (groups[targetIdx].sortOrder ?? 0)) / 2;
      }
    }

    const sourceGroup = groups[sourceIdx];
    setItems(prev => prev.map(item => {
      if (sourceGroup.copies.some(c => c.id === item.id)) {
        return { ...item, sort_order: newOrder };
      }
      return item;
    }));
  }

  function handleDragEnd() {
    setDraggedItemKey(null);
    setDraggedItemLibId(null);
    setDragOverItemKey(null);
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  }

  // Mobile Touch Handlers
  function handleTouchStart(e: React.TouchEvent, key: string, libraryId: number) {
    if (rearrangingLibraryId !== libraryId) return;
    setDraggedItemKey(key);
    setDraggedItemLibId(libraryId);
    setBackupItems([...items]);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!draggedItemKey || !draggedItemLibId) return;
    const touch = e.touches[0];
    
    // Find all items in the current rearranging library
    const itemsEls = document.querySelectorAll(`[data-reorder-lib-id="${draggedItemLibId}"]`);
    let nearestKey = null;
    let minDistance = Infinity;

    for (let i = 0; i < itemsEls.length; i++) {
      const el = itemsEls[i] as HTMLElement;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.sqrt(Math.pow(touch.clientX - centerX, 2) + Math.pow(touch.clientY - centerY, 2));
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestKey = el.getAttribute("data-reorder-key");
      }
    }

    if (nearestKey && nearestKey !== draggedItemKey) {
      // Trigger reorder logic
      const libId = draggedItemLibId;
      const groups = displayGroupsByLibraryId[libId] ?? [];
      const sourceIdx = groups.findIndex(g => g.key === draggedItemKey);
      const targetIdx = groups.findIndex(g => g.key === nearestKey);
      
      if (sourceIdx !== -1 && targetIdx !== -1) {
        setDragOverItemKey(nearestKey);
        
        let newOrder: number;
        if (targetIdx === 0) {
          newOrder = (groups[0].sortOrder ?? 0) - 1000;
        } else if (targetIdx === groups.length - 1 && sourceIdx < targetIdx) {
          newOrder = (groups[groups.length - 1].sortOrder ?? 0) + 1000;
        } else {
          if (targetIdx > sourceIdx) {
            const afterTarget = groups[targetIdx + 1];
            newOrder = ((groups[targetIdx].sortOrder ?? 0) + (afterTarget?.sortOrder ?? (groups[targetIdx].sortOrder ?? 0) + 2000)) / 2;
          } else {
            const beforeTarget = groups[targetIdx - 1];
            newOrder = ((beforeTarget?.sortOrder ?? (groups[targetIdx].sortOrder ?? 0) - 2000) + (groups[targetIdx].sortOrder ?? 0)) / 2;
          }
        }

        const sourceGroup = groups[sourceIdx];
        setItems(prev => prev.map(item => {
          if (sourceGroup.copies.some(c => c.id === item.id)) {
            return { ...item, sort_order: newOrder };
          }
          return item;
        }));
      }
    }

    // Auto-scroll logic for touch
    const threshold = 80;
    const speed = 12;
    if (touch.clientY < threshold) {
      if (!scrollIntervalRef.current) {
        scrollIntervalRef.current = setInterval(() => window.scrollBy(0, -speed), 16);
      }
    } else if (touch.clientY > window.innerHeight - threshold) {
      if (!scrollIntervalRef.current) {
        scrollIntervalRef.current = setInterval(() => window.scrollBy(0, speed), 16);
      }
    } else {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    }
  }

  async function handleTouchEnd(e: React.TouchEvent) {
    if (!draggedItemKey || !draggedItemLibId) return;
    // Reuse drop logic
    await handleDrop(null as any, draggedItemKey, draggedItemLibId);
  }

  async function handleDrop(e: React.DragEvent, targetKey: string, targetLibId: number) {
    e.preventDefault();
    const finalItems = [...items];
    const sourceKey = draggedItemKey;
    const libId = draggedItemLibId;
    handleDragEnd();

    if (!sourceKey || !libId || !supabase) return;

    // Persist the final state of the dragged items
    const sourceGroupItems = finalItems.filter(item => 
      item.library_id === libId && 
      displayGroups.find(g => g.key === sourceKey)?.copies.some(c => c.id === item.id)
    );
    
    if (sourceGroupItems.length === 0) return;
    
    const finalSortOrder = sourceGroupItems[0].sort_order;
    const ids = sourceGroupItems.map(it => it.id);

    try {
      const { error } = await supabase.from("user_books").update({ sort_order: finalSortOrder }).in("id", ids);
      if (error) throw error;
    } catch (err: any) {
      console.error("Failed to persist new order", err);
      if (backupItems) setItems(backupItems);
      window.alert("Failed to save new order. Reverting.");
    } finally {
      setBackupItems(null);
    }
  }
  const [libraryNameDraft, setLibraryNameDraft] = useState("");
  const [newLibraryName, setNewLibraryName] = useState("");
  const [newLibraryFocused, setNewLibraryFocused] = useState(false);
  const [libraryState, setLibraryState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  useEffect(() => {
    const fallbackId = addLibraryId ?? libraries[0]?.id ?? null;
    setAddPreviewLibraryId((prev) => (prev && libraries.some((l) => l.id === prev) ? prev : fallbackId));
  }, [addLibraryId, libraries]);

  useEffect(() => {
    const fallbackId = addLibraryId ?? libraries[0]?.id ?? null;
    if (!fallbackId) {
      setAddSearchLibraryIds({});
      return;
    }
    setAddSearchLibraryIds((prev) => {
      const next: Record<number, number> = {};
      for (let i = 0; i < addSearchResults.length; i += 1) {
        const current = prev[i];
        next[i] = current && libraries.some((l) => l.id === current) ? current : fallbackId;
      }
      return next;
    });
  }, [addSearchResults, addLibraryId, libraries]);
  const [membersByCatalogId, setMembersByCatalogId] = useState<
    Record<
      number,
      {
        busy: boolean;
        error: string | null;
        members: CatalogMemberView[];
        inviteInput: string;
        inviteBusy: boolean;
      }
    >
  >({});
  const [membersEditorCatalogId, setMembersEditorCatalogId] = useState<number | null>(null);

  const [bulkMode, setBulkMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  function exitEditMode() {
    setBulkMode(false);
    setReorderMode(false);
    setBulkSelectedKeys({});
    setBulkState({ busy: false, error: null, message: null });
    setMembersEditorCatalogId(null);
  }

  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<Record<string, true | undefined>>({});
  const [bulkCategoryName, setBulkCategoryName] = useState("");
  const [bulkState, setBulkState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [reorderMode, setReorderMode] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  const autoReducedGridColsRef = useRef<4 | 8 | null>(null);
  const [collapsedByLibraryId, setCollapsedByLibraryId] = useState<Record<number, true | undefined>>({});
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [showInitialSkeleton, setShowInitialSkeleton] = useState(() => {
    return true;
  });

  const [stagedCsvData, setStagedCsvData] = useState<string | null>(null);
  const [stagedCsvFilename, setStagedCsvFilename] = useState<string | null>(null);

  useEffect(() => {
    const data = window.sessionStorage.getItem("om_staged_csv_data");
    const filename = window.sessionStorage.getItem("om_staged_csv_filename");
    if (data && filename) {
      setStagedCsvData(data);
      setStagedCsvFilename(filename);
      setAddOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!openAddPanel) return;
    setAddOpen(true);
  }, [openAddPanel]);

  useEffect(() => {
    if (!openCsvPicker || !initialLoadDone) return;
    if (csvAutoOpenDoneRef.current) return;
    csvAutoOpenDoneRef.current = true;
    setAddOpen(true);
    window.setTimeout(() => {
      csvInputRef.current?.click();
    }, 40);
  }, [openCsvPicker, initialLoadDone]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const update = () => setIsMobile(!!mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("om_collapsedLibraries");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const next: Record<number, true> = {};
        for (const v of parsed) {
          const id = Number(v);
          if (Number.isFinite(id) && id > 0) next[id] = true;
        }
        setCollapsedByLibraryId(next);
        return;
      }
      if (parsed && typeof parsed === "object") {
        const next: Record<number, true> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
          if (!v) continue;
          const id = Number(k);
          if (Number.isFinite(id) && id > 0) next[id] = true;
        }
        setCollapsedByLibraryId(next);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const ids = Object.keys(collapsedByLibraryId)
        .map((k) => Number(k))
        .filter((n) => Number.isFinite(n) && n > 0 && collapsedByLibraryId[n]);
      window.localStorage.setItem("om_collapsedLibraries", JSON.stringify(ids));
    } catch {
      // ignore
    }
  }, [collapsedByLibraryId]);

  useEffect(() => {
    const validIds = new Set((libraries ?? []).map((l) => l.id));
    setCollapsedByLibraryId((prev) => {
      const next: Record<number, true> = {};
      let changed = false;
      for (const [k, v] of Object.entries(prev)) {
        const id = Number(k);
        if (!v) continue;
        if (!validIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = true;
      }
      return changed ? next : prev;
    });
  }, [libraries]);

  useEffect(() => {
    try {
      const vm = window.localStorage.getItem("om_viewMode");
      const gc = window.localStorage.getItem("om_gridCols");
      const sm = window.localStorage.getItem("om_sortMode");
      const q = (searchParams.get("q") ?? "").trim();
      window.localStorage.removeItem("om_categoryMode");
      window.localStorage.removeItem("om_tagMode");
      window.localStorage.removeItem("om_visibilityMode");
      if (vm === "grid" || vm === "list") setViewMode(vm);
      if (gc === "1" || gc === "2" || gc === "4" || gc === "8") setGridCols(Number(gc) as any);
      if (sm === "custom" || sm === "latest" || sm === "earliest" || sm === "title_asc" || sm === "title_desc") setSortMode(sm);
      setSearchQuery(q);
    } catch {
      // ignore
    }
  }, [searchParams]);

  useEffect(() => {
    try {
      window.localStorage.setItem("om_viewMode", viewMode);
      window.localStorage.setItem("om_gridCols", String(gridCols));
      window.localStorage.setItem("om_sortMode", sortMode);
    } catch {
      // ignore
    }
  }, [viewMode, gridCols, sortMode]);

  useEffect(() => {
    const normalized = (filterCategory ?? "").trim();
    if (!normalized) return;
    setCategoryMode(normalized);
  }, [filterCategory]);

  useEffect(() => {
    const normalized = (filterTag ?? "").trim();
    if (!normalized) return;
    setTagMode(normalized);
  }, [filterTag]);

  useEffect(() => {
    if (!showSharedLibraries) return;
    if (!libraries.some((l) => l.myRole === "editor")) return;
    const timer = window.setTimeout(() => {
      void refreshLibraryMemberPreviewsFromApi();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [showSharedLibraries, libraries]);

  function normalizeLibrariesDeterministically(list: LibrarySummary[]): LibrarySummary[] {
    const byId = new Map<number, LibrarySummary>();
    for (const l of list) {
      const id = Number(l.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      byId.set(id, {
        id,
        name: String(l.name ?? `Catalog ${id}`),
        created_at: String(l.created_at ?? new Date(0).toISOString()),
        sort_order: l.sort_order != null && Number.isFinite(Number(l.sort_order)) ? Number(l.sort_order) : null,
        owner_id: l.owner_id ? String(l.owner_id) : null,
        myRole: l.myRole === "editor" ? "editor" : "owner",
        memberPreviews: Array.isArray(l.memberPreviews) ? l.memberPreviews : []
      });
    }
    return Array.from(byId.values()).sort((a, b) => {
      const aOrder = a.sort_order != null ? Number(a.sort_order) : null;
      const bOrder = b.sort_order != null ? Number(b.sort_order) : null;
      if (aOrder !== null && bOrder !== null) return aOrder - bOrder;
      if (aOrder !== null) return -1;
      if (bOrder !== null) return 1;
      const aTs = Date.parse(String(a.created_at ?? ""));
      const bTs = Date.parse(String(b.created_at ?? ""));
      if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return aTs - bTs;
      return Number(a.id) - Number(b.id);
    });
  }

  async function hydrateFromHomepageCache(cached: CatalogHomeCachePayload, requestSeq?: number) {
    if (!cached) return;
    const cachedList = normalizeLibrariesDeterministically(cached.libraries);
    if (cachedList.length === 0 && cached.books.length === 0) return;
    setLibraries(cachedList);
    setDebugLibrariesSource("libs:cache");
    setBooksLoading(false);
    applyLibrarySelection(cachedList);
    if (!sharedRevealDoneRef.current) {
      setShowSharedLibraries(false);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          setShowSharedLibraries(true);
          sharedRevealDoneRef.current = true;
        });
      } else {
        setShowSharedLibraries(true);
        sharedRevealDoneRef.current = true;
      }
    } else {
      setShowSharedLibraries(true);
    }
    if (Array.isArray(cached.books) && cached.books.length > 0) {
      setDebugBooksSource("books:cache");
      await applyBooksFromServer(cached.books, "books:cache", requestSeq);
    }
  }

  useEffect(() => {
    const onReset = () => {
      setTagMode("all");
      setCategoryMode("all");
      setVisibilityMode("all");
      setSearchQuery("");
      router.push("/app");
    };
    window.addEventListener("om:home-reset-filters", onReset);
    return () => window.removeEventListener("om:home-reset-filters", onReset);
  }, [router]);

  function storeBookNavContext(libraryId: number, orderedBookIds: number[]) {
    const bookIds = orderedBookIds.filter((id) => Number.isFinite(id) && id > 0);
    if (bookIds.length === 0) return;
    saveBookNavContext({
      bookIds,
      libraryId,
      source: "app-home",
      ts: Date.now()
    });
  }

  async function applyBooksFromServer(serverRows: any[], source: string, requestSeq?: number) {
    const client = supabase;
    if (!client) return;
    if (typeof requestSeq === "number" && booksRequestSeqRef.current !== requestSeq) return;
    const normalizedRows = (serverRows ?? []).map((r: any) => ({
      ...r,
      media: Array.isArray(r?.media) ? r.media : [],
      book_tags: Array.isArray(r?.book_tags) ? r.book_tags : [],
      edition: r?.edition ?? null
    }));
    if (typeof requestSeq === "number" && booksRequestSeqRef.current !== requestSeq) return;
    setDebugBooksSource(source);
    setItems(normalizedRows as any);
    const serverPaths = Array.from(
      new Set([
        ...normalizedRows
          .flatMap((r) => (Array.isArray(r.media) ? r.media : []))
          .map((m: any) => toStoragePathCandidate(typeof m?.storage_path === "string" ? m.storage_path : "") ?? "")
          .filter(Boolean),
        ...normalizedRows
          .map((r: any) => toStoragePathCandidate(r?.cover_original_url) ?? "")
          .filter(Boolean),
        ...normalizedRows
          .map((r: any) => toStoragePathCandidate(r?.edition?.cover_url) ?? "")
          .filter(Boolean),
        ...normalizedRows
          .map((r: any) => toStoragePathCandidate(r?.cover_crop?.storage_path ?? "") ?? "")
          .filter(Boolean),
      ])
    );
    const serverMissing = serverPaths.filter((p) => !mediaUrlsByPath[p]);
    if (serverMissing.length > 0) {
      void (async () => {
        const signedServer = await client.storage.from("user-book-media").createSignedUrls(serverMissing, 60 * 60);
        if (typeof requestSeq === "number" && booksRequestSeqRef.current !== requestSeq) return;
        if (!signedServer.error && signedServer.data) {
          const nextMap: Record<string, string> = {};
          for (const s of signedServer.data) if (s.path && s.signedUrl) nextMap[s.path] = s.signedUrl;
          setMediaUrlsByPath((prev) => ({ ...prev, ...nextMap }));
        }
      })();
    }
  }

  async function fetchBooksDirectFromClient(
    libraryIds: number[],
    requestSeq?: number
  ): Promise<{ ok: true; rows: any[]; source: string } | { ok: false; reason: string }> {
    if (!supabase) return { ok: false, reason: "client_not_ready" };
    const ids = Array.from(new Set(libraryIds.filter((n) => Number.isFinite(n) && n > 0)));
    if (ids.length === 0) return { ok: false, reason: "no_library_ids" };

    const fallbackSelects = [
      "id,library_id,created_at,visibility,sort_order,title_override,authors_override,editors_override,subjects_override,publisher_override,designers_override,group_label,object_type,decade,source_type,source_url,external_source_ids,music_metadata,edition:editions(id,isbn13,title,authors,publisher,cover_url,publish_date),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,entity:entities(id,name,slug))",
      "id,library_id,created_at,visibility,sort_order,title_override,authors_override,editors_override,subjects_override,publisher_override,designers_override,group_label,object_type,decade,source_type,source_url,external_source_ids,music_metadata,edition:editions(id,isbn13,title,authors,publisher,cover_url,publish_date),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))",
      "id,library_id,created_at,visibility,sort_order,title_override,authors_override,editors_override,subjects_override,publisher_override,designers_override,group_label,object_type,decade,source_type,source_url,external_source_ids,music_metadata,edition:editions(id,isbn13,title,authors,subjects,publisher,cover_url,publish_date),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))",
      "*"
    ];

    let lastError: unknown = null;
    for (let i = 0; i < fallbackSelects.length; i += 1) {
      const select = fallbackSelects[i];
      const res = await supabase
        .from("user_books")
        .select(select)
        .in("library_id", ids)
        .order("created_at", { ascending: false })
        .limit(1200);
      if (!res.error) {
        if (requestSeq != null && booksRequestSeqRef.current !== requestSeq) {
          return { ok: false, reason: "stale_request" };
        }
        const normalized = (res.data ?? []).map((r: any) => ({
          ...r,
          media: Array.isArray((r as any)?.media) ? (r as any).media : [],
          book_tags: Array.isArray((r as any)?.book_tags) ? (r as any).book_tags : [],
          edition: (r as any)?.edition ?? null
        }));
        return {
          ok: true,
          rows: normalized as any[],
          source: `books:client-fallback-${
            i === 0 ? "rich" : i === 1 ? "semi" : i === 2 ? "minimal" : "raw"
          }`
        };
      }
      lastError = res.error;
    }

    return { ok: false, reason: (lastError as any)?.message ?? "client_fallback_failed" };
  }

  async function refreshAllBooks(targetLibraryIds?: number[], options?: { fastFirst?: boolean; skipSecondApiCall?: boolean }) {
    if (!supabase) return;
    const requestSeq = booksRequestSeqRef.current + 1;
    booksRequestSeqRef.current = requestSeq;
    const isStale = () => booksRequestSeqRef.current !== requestSeq;
    setBooksLoading(true);
    const ids = Array.from(new Set((targetLibraryIds ?? libraries.map((l) => l.id)).filter((n) => Number.isFinite(n) && n > 0)));
    const idsQuery = ids.length > 0 ? `catalog_ids=${encodeURIComponent(ids.join(","))}` : "";
    const endpoint = idsQuery ? `/api/catalog/home?${idsQuery}` : "/api/catalog/home";
    const liteEndpoint = idsQuery ? `/api/catalog/home?${idsQuery}&lite=1` : "/api/catalog/home?lite=1";
    try {
      if (options?.fastFirst) {
        const liteHome = await catalogApi<{ ok: true; books: any[] }>(liteEndpoint, { method: "GET" });
        if (Array.isArray(liteHome.books)) {
          await applyBooksFromServer(liteHome.books as any[], ids.length > 0 ? "books:server-home-lite" : "books:server-home-lite-noids", requestSeq);
          if (options.skipSecondApiCall && liteHome.books.length > 0) {
            return;
          }
          if (!isStale()) setBooksLoading(false);
        }
      }
      const serverHome = await catalogApi<{ ok: true; catalogs?: LibrarySummary[]; books: any[] }>(endpoint, { method: "GET" });
      if (isStale()) return;
      if (!ids.length && Array.isArray(serverHome.catalogs)) {
        const normalizedCatalogs = normalizeLibrariesDeterministically(serverHome.catalogs as LibrarySummary[]);
        if (normalizedCatalogs.length > 0) {
          setDebugLibrariesSource("libs:api-home");
          setLibraries(normalizedCatalogs);
          applyLibrarySelection(normalizedCatalogs);
        }
      }
      if (Array.isArray(serverHome.books) && serverHome.books.length > 0) {
        await applyBooksFromServer(serverHome.books as any[], ids.length > 0 ? "books:server-home" : "books:server-home-noids", requestSeq);
        return;
      }
      if (Array.isArray(serverHome.books) && serverHome.books.length === 0 && ids.length > 0) {
        const fallback = await fetchBooksDirectFromClient(ids, requestSeq);
        if (fallback.ok && !isStale()) {
          setDebugBooksSource(fallback.source);
          await applyBooksFromServer(fallback.rows, "books:client-fallback");
          return;
        }
        if (!fallback.ok) {
          setDebugLastError(fallback.reason);
        }
      }
      if (Array.isArray(serverHome.books) && serverHome.books.length === 0 && ids.length === 0 && supabase) {
        const ownerFallback = await supabase
          .from("user_books")
          .select(
            "id,library_id,created_at,visibility,title_override,authors_override,editors_override,subjects_override,publisher_override,designers_override,group_label,object_type,decade,source_type,source_url,external_source_ids,music_metadata,cover_original_url,cover_crop,notes,edition_id,edition:editions(id,isbn13,title,authors,publisher,cover_url,publish_date,description,subjects),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,entity:entities(id,name,slug))"
          )
          .eq("owner_id", userId)
          .order("created_at", { ascending: false })
          .limit(1200);
        if (!ownerFallback.error) {
          const ownerRows = (ownerFallback.data ?? []).map((r: any) => ({
            ...r,
            media: Array.isArray(r?.media) ? r.media : [],
            book_tags: Array.isArray(r?.book_tags) ? r.book_tags : [],
            edition: (r as any)?.edition ?? null
          }));
          if (ownerRows.length > 0) {
            setDebugBooksSource("books:client-owner-fallback");
            await applyBooksFromServer(ownerRows, "books:client-owner-fallback", requestSeq);
            return;
          }
        }
      }
      if (isStale()) return;
      setDebugBooksSource("books:failed");
      return;
    } catch (err: any) {
      if (isStale()) return;
      setDebugLastError(String(err?.message ?? "server_home_failed"));
      setDebugBooksSource("books:failed");
      return;
    } finally {
      if (!isStale()) setBooksLoading(false);
    }
  }

  function applyLibrarySelection(list: LibrarySummary[]) {
    try {
      const raw = window.localStorage.getItem("om_addLibraryId");
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed) && parsed > 0 && list.some((l) => l.id === parsed)) {
        setAddLibraryId(parsed);
      } else {
        setAddLibraryId(list[0]?.id ?? null);
      }
    } catch {
      setAddLibraryId(list[0]?.id ?? null);
    }
  }

  async function refreshLibraryMemberPreviewsFromApi() {
    if (memberPreviewHydratingRef.current) return;
    memberPreviewHydratingRef.current = true;
    try {
      const fullRes = await catalogApi<{ ok: true; catalogs: LibrarySummary[] }>("/api/catalog/list", { method: "GET" });
      const full = Array.isArray(fullRes.catalogs) ? fullRes.catalogs : [];
      if (full.length === 0) return;
      const byId = new Map<number, LibrarySummary>();
      for (const l of full) byId.set(l.id, l);
      setLibraries((prev) =>
        prev.map((l) => {
          const next = byId.get(l.id);
          if (!next) return l;
          const currentPreviews = l.memberPreviews ?? [];
          const nextPreviews = next.memberPreviews ?? [];
          if (
            currentPreviews.length === nextPreviews.length &&
            currentPreviews.every((m, i) => m.userId === nextPreviews[i]?.userId && m.avatarUrl === nextPreviews[i]?.avatarUrl)
          ) {
            return l;
          }
          return { ...l, memberPreviews: nextPreviews };
        })
      );
    } catch {
      // best-effort background hydration
    } finally {
      memberPreviewHydratingRef.current = false;
    }
  }

  async function refreshLibraries(): Promise<LibrarySummary[]> {
    if (!supabase) return [];
    const requestSeq = librariesRequestSeqRef.current + 1;
    librariesRequestSeqRef.current = requestSeq;
    const booksRequestSeq = booksRequestSeqRef.current + 1;
    booksRequestSeqRef.current = booksRequestSeq;
    const isStale = () => librariesRequestSeqRef.current !== requestSeq;
    setLibraryState({ busy: true, error: null, message: null });
    setBooksLoading(true);

    const cached = loadHomepageCache();
    if (cached) {
      const cachedList = normalizeLibrariesDeterministically(cached.libraries);
      if (!isStale() && cachedList.length > 0) {
        await hydrateFromHomepageCache(cached, booksRequestSeqRef.current);
      }
    }

    try {
      const homeLite = await catalogApi<{ ok: true; catalogs: LibrarySummary[]; books: any[] }>("/api/catalog/home?lite=1", { method: "GET" });
      if (isStale()) return [];

      const liteBooks = Array.isArray(homeLite.books) ? homeLite.books : [];
      let list = normalizeLibrariesDeterministically(Array.isArray(homeLite.catalogs) ? homeLite.catalogs : []);
      if (list.length > 0) {
        setDebugLibrariesSource("libs:api-home-lite");
      }

      if (list.length === 0) {
        const created = await supabase.from("libraries").insert({ owner_id: userId, name: "Your catalog" }).select("id").single();
        if (created.error) throw new Error(created.error.message);
        const createdId = Number((created.data as any)?.id ?? 0);
        if (createdId > 0) {
          await supabase.from("catalog_members").upsert(
            { catalog_id: createdId, user_id: userId, role: "owner", invited_by: userId, accepted_at: new Date().toISOString() },
            { onConflict: "catalog_id,user_id" }
          );
        }
        const res2 = await supabase
          .from("libraries")
          .select("id,name,created_at,owner_id")
          .eq("owner_id", userId)
          .order("created_at", { ascending: true });
        if (res2.error) throw new Error(res2.error.message);
        list = normalizeLibrariesDeterministically(((res2.data ?? []) as any[]).map((l) => ({ ...l, myRole: "owner" as const })));
      }

      if (list.length === 0) {
        const ownerBooks = await supabase.from("user_books").select("library_id").eq("owner_id", userId).limit(800);
        if (!ownerBooks.error) {
          setDebugLibrariesSource("libs:derived-from-owner-books");
          const idsFromBooks = Array.from(
            new Set(((ownerBooks.data ?? []) as any[]).map((r) => Number(r.library_id)).filter((n) => Number.isFinite(n) && n > 0))
          );
          list = idsFromBooks.map((id) => ({
            id,
            name: `Catalog ${id}`,
            created_at: new Date(0).toISOString(),
            myRole: "owner" as const
          }));
          list = normalizeLibrariesDeterministically(list);
        }
      }

      if (isStale()) return [];
      setLibraries(list);
      if (liteBooks.length > 0) {
        setDebugBooksSource("books:server-home-lite");
        await applyBooksFromServer(liteBooks, "books:server-home-lite", booksRequestSeq);
        if (list.length > 0 && liteBooks.length > 0) {
          saveHomepageCache({
            ts: Date.now(),
            libraries: list,
            books: liteBooks
          });
        }
        setBooksLoading(false);
      }
      if (!sharedRevealDoneRef.current) {
        setShowSharedLibraries(false);
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            setShowSharedLibraries(true);
            sharedRevealDoneRef.current = true;
          });
        } else {
          setShowSharedLibraries(true);
          sharedRevealDoneRef.current = true;
        }
      } else {
        setShowSharedLibraries(true);
      }
      applyLibrarySelection(list);
      if (liteBooks.length === 0) {
        await refreshAllBooks(list.map((l) => l.id));
      }

      if (isStale()) return [];
      setLibraryState({ busy: false, error: null, message: null });
      setBooksLoading(false);
      return list;
    } catch (e: any) {
      if (isStale()) return [];
      try {
        const ownerFallback = await supabase
          .from("libraries")
          .select("id,name,created_at,owner_id")
          .eq("owner_id", userId)
          .order("created_at", { ascending: true });
        if (!ownerFallback.error) {
          setDebugLibrariesSource("libs:owner-fallback");
          const ownerList = normalizeLibrariesDeterministically(((ownerFallback.data ?? []) as any[]).map((l) => ({ ...l, myRole: "owner" as const }))) as LibrarySummary[];
        if (isStale()) return [];
        setLibraries(ownerList);
        setShowSharedLibraries(true);
        setAddLibraryId(ownerList[0]?.id ?? null);
        try {
          await refreshAllBooks(ownerList.map((l) => Number(l.id)).filter((id) => Number.isFinite(id) && id > 0));
        } catch {
          // Best-effort; keep libraries visible even if books are unavailable.
        }
        setBooksLoading(false);
          setLibraryState({ busy: false, error: null, message: null });
          return ownerList;
        }
      } catch {
        // ignore
      }
      setDebugLibrariesSource("libs:failed");
      setDebugLastError(e?.message ?? "libs_failed");
      setLibraries([]);
      setAddLibraryId(null);
      setLibraryState({ busy: false, error: e?.message ?? "Failed to load catalogs", message: null });
      setBooksLoading(false);
      return [];
    }
  }

  async function createLibrary(name: string) {
    if (!supabase) return;
    const n = name.trim().replace(/\s+/g, " ");
    if (!n) return;
    setLibraryState({ busy: true, error: null, message: "Creating…" });
    try {
      const created = await supabase.from("libraries").insert({ owner_id: userId, name: n }).select("id").single();
      if (created.error) throw new Error(created.error.message);
      const createdId = Number((created.data as any)?.id ?? 0);
      if (createdId > 0) {
        await supabase.from("catalog_members").upsert(
          { catalog_id: createdId, user_id: userId, role: "owner", invited_by: userId, accepted_at: new Date().toISOString() },
          { onConflict: "catalog_id,user_id" }
        );
      }
      await refreshLibraries();
      const id = (created.data as any)?.id as number | undefined;
      if (id) {
        setAddLibraryId(id);
        try {
          window.localStorage.setItem("om_addLibraryId", String(id));
        } catch {
          // ignore
        }
      }
      setNewLibraryName("");
      setLibraryState({ busy: false, error: null, message: "Created" });
      window.setTimeout(() => setLibraryState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setLibraryState({ busy: false, error: e?.message ?? "Create failed", message: "Create failed" });
    }
  }

  async function saveLibraryName(libraryId: number, name: string) {
    if (!supabase) return;
    const n = name.trim().replace(/\s+/g, " ");
    if (!n) return;
    setLibraryState({ busy: true, error: null, message: "Saving…" });
    try {
      const upd = await supabase.from("libraries").update({ name: n }).eq("id", libraryId).eq("owner_id", userId);
      if (upd.error) throw new Error(upd.error.message);
      await refreshLibraries();
      setEditingLibraryId(null);
      setLibraryState({ busy: false, error: null, message: "Saved" });
      window.setTimeout(() => setLibraryState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setLibraryState({ busy: false, error: e?.message ?? "Save failed", message: "Save failed" });
    }
  }

  async function deleteLibrary(libraryId: number) {
    if (!supabase) return;
    const lib = libraries.find((l) => l.id === libraryId);
    if (!lib) return;
    if (libraries.length <= 1) {
      window.alert("You must keep at least one catalog.");
      return;
    }

    const choiceRaw = window.prompt(
      `Delete catalog “${lib.name}”? Type MOVE to move its books into another catalog, or type DELETE to delete all books in this catalog.`
    );
    const choice = (choiceRaw ?? "").trim().toLowerCase();
    if (!choice) return;

    setLibraryState({ busy: true, error: null, message: "Deleting…" });
    try {
      if (choice === "move") {
        const destOptions = libraries.filter((l) => l.id !== libraryId);
        const destRaw = window.prompt(
          `Move books from “${lib.name}” to which catalog?\n\nType the destination catalog name exactly:\n- ${destOptions.map((l) => l.name).join("\n- ")}`
        );
        const destName = (destRaw ?? "").trim();
        if (!destName) {
          setLibraryState({ busy: false, error: null, message: null });
          return;
        }
        const dest = destOptions.find((l) => l.name === destName);
        if (!dest) throw new Error("Destination catalog not found.");

        const upd = await supabase.from("user_books").update({ library_id: dest.id }).eq("owner_id", userId).eq("library_id", libraryId);
        if (upd.error) throw new Error(upd.error.message);
      } else if (choice === "delete") {
        const listRes = await supabase.from("user_books").select("id,media:user_book_media(storage_path)").eq("owner_id", userId).eq("library_id", libraryId).limit(2000);
        if (listRes.error) throw new Error(listRes.error.message);
        const rows = (listRes.data ?? []) as any[];
        const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
        const paths = Array.from(
          new Set(
            rows
              .flatMap((r) => (Array.isArray(r.media) ? r.media : []))
              .map((m: any) => (typeof m?.storage_path === "string" ? m.storage_path : ""))
              .filter(Boolean)
          )
        );

        if (!window.confirm(`Delete ${ids.length} book(s) in “${lib.name}”? This cannot be undone.`)) {
          setLibraryState({ busy: false, error: null, message: null });
          return;
        }

        if (paths.length > 0) {
          const rm = await supabase.storage.from("user-book-media").remove(paths);
          if (rm.error) {
            // continue
          }
        }
        if (ids.length > 0) {
          const del = await supabase.from("user_books").delete().in("id", ids);
          if (del.error) throw new Error(del.error.message);
        }
      } else {
        throw new Error("Please type MOVE or DELETE.");
      }

      const delLib = await supabase.from("libraries").delete().eq("id", libraryId).eq("owner_id", userId);
      if (delLib.error) throw new Error(delLib.error.message);

      setEditingLibraryId(null);
      await refreshLibraries();
      await refreshAllBooks();
      setLibraryState({ busy: false, error: null, message: "Deleted" });
      window.setTimeout(() => setLibraryState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setLibraryState({ busy: false, error: e?.message ?? "Delete failed", message: "Delete failed" });
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) return;
      if (alive) setInitialLoadDone(true);
      const profilePromise = supabase
        .from("profiles")
        .select("username,visibility,avatar_path")
        .eq("id", userId)
        .maybeSingle();
      const homepageCache = loadHomepageCache();

      try {
        const hasCachedHomePayload = !!(homepageCache && ((homepageCache.libraries.length > 0 || homepageCache.books.length > 0)));
        if (hasCachedHomePayload) {
          void hydrateFromHomepageCache(homepageCache);
        }
        void (async () => {
          try {
            const profileRes = await profilePromise;
            const profileData = profileRes.data;
            if (!alive) return;
            if (profileData) setProfile(profileData);
            if (!alive) return;
            const resolvedAvatar = await resolveAvatarUrl(profileData?.avatar_path ?? null);
            if (!alive) return;
            setAvatarUrl(resolvedAvatar);
          } catch {
            // best-effort profile load
          }
        })();

        await refreshLibraries();
      } finally {
        if (!alive) return;
        setShowInitialSkeleton(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  async function addByIsbnValue(isbnValue: string): Promise<number> {
    if (!supabase) throw new Error("Supabase is not configured");
    if (!addLibraryId) throw new Error("Choose a catalog first");
    const isbn = isbnValue.trim();
    if (!isbn) throw new Error("Provide an ISBN");
    try {
      const res = await fetch(`/api/isbn?isbn=${encodeURIComponent(isbn)}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "ISBN lookup failed");
      const edition = (json.edition ?? {}) as EditionMetadata;
      const isbn13 = (edition.isbn13 ?? "").trim();
      if (!isbn13) throw new Error("No ISBN-13 returned by resolver");

      const existing = await supabase.from("editions").select("id").eq("isbn13", isbn13).maybeSingle();
      if (existing.error) throw new Error(existing.error.message);

      let editionId = existing.data?.id as number | undefined;
      if (!editionId) {
        const inserted = await supabase
          .from("editions")
          .insert({
            isbn10: edition.isbn10 ?? null,
            isbn13,
            title: edition.title ?? null,
            authors: edition.authors ?? [],
            publisher: edition.publisher ?? null,
            publish_date: edition.publish_date ?? null,
            description: edition.description ?? null,
            subjects: edition.subjects ?? [],
            cover_url: edition.cover_url ?? null,
            raw: edition.raw ?? null
          })
          .select("id")
          .single();
        if (inserted.error) throw new Error(inserted.error.message);
        editionId = inserted.data.id;
      }

      const created = await supabase
        .from("user_books")
        .insert({ owner_id: userId, library_id: addLibraryId, edition_id: editionId })
        .select("id")
        .single();
      if (created.error) throw new Error(created.error.message);

      await refreshAllBooks();
      return created.data.id as number;
    } catch (e: any) {
      throw new Error(e?.message ?? "Failed to add book");
    }
  }

  async function addManualValue({
    title,
    authors,
    publisher,
    publish_date,
    description
  }: {
    title: string;
    authors: string[];
    publisher?: string | null;
    publish_date?: string | null;
    description?: string | null;
  }): Promise<number> {
    if (!supabase) throw new Error("Supabase is not configured");
    if (!addLibraryId) throw new Error("Choose a catalog first");
    if (!title.trim()) throw new Error("Provide a title");
    try {
      const created = await supabase
        .from("user_books")
        .insert({
          owner_id: userId,
          library_id: addLibraryId,
          edition_id: null,
          title_override: title,
          authors_override: authors.length > 0 ? authors : null,
          publisher_override: publisher ?? null,
          publish_date_override: publish_date ?? null,
          description_override: description ?? null
        })
        .select("id")
        .single();
      if (created.error) throw new Error(created.error.message);

      await refreshAllBooks();
      return created.data.id as number;
    } catch (e: any) {
      throw new Error(e?.message ?? "Failed to add book");
    }
  }

  function checkImageDimensions(url: string | null): Promise<boolean> {
    if (!url) return Promise.resolve(false);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const ok = img.naturalWidth >= 100 && img.naturalHeight >= 100;
        resolve(ok);
      };
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  async function createUserBookByIsbnNoRefresh(isbnValue: string): Promise<number> {
    if (!supabase) throw new Error("Supabase is not configured");
    if (!addLibraryId) throw new Error("Choose a catalog first");
    const isbn = isbnValue.trim();
    if (!isbn) throw new Error("Provide an ISBN");
    const res = await fetch(`/api/isbn?isbn=${encodeURIComponent(isbn)}`);
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? "ISBN lookup failed");
    const edition = (json.edition ?? {}) as EditionMetadata;
    const isbn13 = (edition.isbn13 ?? "").trim();
    if (!isbn13) throw new Error("No ISBN-13 returned by resolver");

    let finalCoverUrl = edition.cover_url ?? null;
    if (finalCoverUrl) {
      const ok = await checkImageDimensions(finalCoverUrl);
      if (!ok) finalCoverUrl = null;
    }

    const existing = await supabase.from("editions").select("id").eq("isbn13", isbn13).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    let editionId = existing.data?.id as number | undefined;
    if (!editionId) {
      const inserted = await supabase
        .from("editions")
        .insert({
          isbn10: edition.isbn10 ?? null,
          isbn13,
          title: edition.title ?? null,
          authors: edition.authors ?? [],
          publisher: edition.publisher ?? null,
          publish_date: edition.publish_date ?? null,
          description: edition.description ?? null,
          subjects: edition.subjects ?? [],
          cover_url: finalCoverUrl,
          raw: edition.raw ?? null
        })
        .select("id")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      editionId = inserted.data.id;
    }

    const created = await supabase.from("user_books").insert({ owner_id: userId, library_id: addLibraryId, edition_id: editionId }).select("id").single();
    if (created.error) throw new Error(created.error.message);
    return created.data.id as number;
  }

  async function createManualUserBookNoRefresh(row: {
    title: string;
    authors: string[];
    publisher?: string | null;
    publish_date?: string | null;
    description?: string | null;
  }): Promise<number> {
    if (!supabase) throw new Error("Supabase is not configured");
    if (!addLibraryId) throw new Error("Choose a catalog first");
    const title = (row.title ?? "").trim();
    if (!title) throw new Error("Provide a title");
    const created = await supabase
      .from("user_books")
      .insert({
        owner_id: userId,
        library_id: addLibraryId,
        edition_id: null,
        title_override: title,
        authors_override: row.authors.length > 0 ? row.authors : null,
        publisher_override: row.publisher ?? null,
        publish_date_override: row.publish_date ?? null,
        description_override: row.description ?? null
      })
      .select("id")
      .single();
    if (created.error) throw new Error(created.error.message);
    return created.data.id as number;
  }

  async function loadCsvFile(file: File) {
    const text = await file.text();
    const objects = parseCsvToObjects(text);
    const normalized: CsvImportRow[] = objects
      .map((o) => {
        const title = (o.title ?? o.Title ?? "").trim();
        const isbn13 = (o.ean_isbn13 ?? o.isbn13 ?? o.ISBN13 ?? "").trim();
        const isbn10 = (o.upc_isbn10 ?? o.isbn10 ?? o.ISBN10 ?? "").trim();
        const isbn = isbn13 || isbn10 || "";
        const creators = (o.creators ?? o.creators_name ?? o.author ?? o.authors ?? "").trim();
        const authors = creators ? splitListField(creators) : [];
        const publisher = (o.publisher ?? "").trim() || null;
        const publish_date = (o.publish_date ?? "").trim() || null;
        const description = (o.description ?? "").trim() || null;
        const category = (o.collection ?? o.category ?? "").trim() || null;
        const tags = splitListField((o.tags ?? "").trim());
        const notes = (o.notes ?? "").trim() || null;
        const group_label = (o.group ?? "").trim() || null;
        const object_type = (o.item_type ?? o.object_type ?? "").trim() || null;
        const copiesRaw = (o.copies ?? "").trim();
        const copiesNum = copiesRaw ? Number(copiesRaw) : 1;
        const copies = Number.isFinite(copiesNum) && copiesNum > 1 ? Math.floor(copiesNum) : 1;
        return {
          title,
          isbn: isbn ? isbn : null,
          authors,
          publisher,
          publish_date,
          description,
          category,
          tags,
          notes,
          group_label,
          object_type,
          copies
        } as CsvImportRow;
      })
      .filter((r) => Boolean(r.title || r.isbn));

    setCsvFileName(file.name);
    setCsvRows(normalized);
    setCsvImportState({ busy: false, error: null, message: `Loaded ${normalized.length} row(s)`, done: 0, total: normalized.length });
    window.setTimeout(() => setCsvImportState((s) => ({ ...s, message: null })), 1500);
  }

  function clearCsvImport() {
    setCsvFileName(null);
    setCsvRows([]);
    setCsvImportState({ busy: false, error: null, message: null, done: 0, total: 0 });
  }

  async function importCsvRows() {
    if (!supabase) return;
    if (csvRows.length === 0) return;
    if (!addLibraryId) {
      setCsvImportState({ busy: false, error: "Choose a catalog first", message: "Choose a catalog first", done: 0, total: csvRows.length });
      return;
    }

    setCsvImportState({ busy: true, error: null, message: `Importing…`, done: 0, total: csvRows.length });
    const tagIdCache = new Map<string, number>();
    const getTagIdCached = async (name: string, kind: "tag" | "category") => {
      const normalized = name.trim().replace(/\s+/g, " ");
      const key = `${kind}:${normalized.toLowerCase()}`;
      const cached = tagIdCache.get(key);
      if (cached) return cached;
      const id = await getOrCreateTagId(normalized, kind);
      tagIdCache.set(key, id);
      return id;
    };

    let done = 0;
    let successCount = 0;
    let skipCount = 0;

    try {
      for (const r of csvRows) {
        try {
          const copies = Math.max(1, Math.floor(Number(r.copies) || 1));
          for (let c = 0; c < copies; c += 1) {
            const id = r.isbn ? await createUserBookByIsbnNoRefresh(r.isbn) : await createManualUserBookNoRefresh(r);

            const { data: parsed, remainingNotes } = parseStructuredNotes(r.notes);
            const updatePayload: any = {
              notes: remainingNotes
            };
            if (!remainingNotes && r.notes) updatePayload.notes = null;

            if (r.group_label) updatePayload.group_label = r.group_label;
            updatePayload.object_type = r.object_type || parsed.object_type || null;

            if (parsed.subjects_override) {
              updatePayload.subjects_override = Array.from(new Set(parsed.subjects_override.split(",").map((s) => s.trim()).filter(Boolean)));
            }
            if (parsed.designers_override) {
              updatePayload.designers_override = Array.from(new Set(parsed.designers_override.split(",").map((s) => s.trim()).filter(Boolean)));
            }
            if (parsed.editors_override) {
              updatePayload.editors_override = Array.from(new Set(parsed.editors_override.split(",").map((s) => s.trim()).filter(Boolean)));
            }
            if (parsed.publisher_override && !r.publisher) {
              updatePayload.publisher_override = parsed.publisher_override;
            }
            if (parsed.printer_override) {
              updatePayload.printer_override = parsed.printer_override;
            }
            if (parsed.materials_override) {
              updatePayload.materials_override = parsed.materials_override;
            }
            if (parsed.decade) {
              updatePayload.decade = parsed.decade;
            }
            if (parsed.pages) {
              const p = Number(parsed.pages);
              if (Number.isFinite(p)) updatePayload.pages = Math.max(1, Math.floor(p));
            }

            if (csvApplyOverrides && r.isbn) {
              if (r.title) updatePayload.title_override = r.title;
              if (r.authors.length > 0) updatePayload.authors_override = r.authors;
              if (r.publisher) updatePayload.publisher_override = r.publisher;
              if (r.publish_date) updatePayload.publish_date_override = r.publish_date;
              if (r.description) updatePayload.description_override = r.description;
            }
            if (Object.keys(updatePayload).length > 0) {
              let up = await supabase.from("user_books").update(updatePayload).eq("id", id);
              if (up.error) {
                const msg = (up.error.message ?? "").toLowerCase();
                if (msg.includes("trim_width") || msg.includes("group_label")) {
                  delete updatePayload.decade;
                  delete updatePayload.pages;
                  delete updatePayload.group_label;
                  delete updatePayload.object_type;
                  up = await supabase.from("user_books").update(updatePayload).eq("id", id);
                }
              }
            }

            const rows: Array<{ user_book_id: number; tag_id: number }> = [];
            if (r.category) rows.push({ user_book_id: id, tag_id: await getTagIdCached(r.category, "category") });
            for (const t of r.tags) rows.push({ user_book_id: id, tag_id: await getTagIdCached(t, "tag") });
            if (rows.length > 0) {
              const upTags = await supabase.from("user_book_tags").upsert(rows as any, { onConflict: "user_book_id,tag_id" });
              if (upTags.error) {
                // ignore; tags optional
              }
            }
          }
          successCount += 1;
        } catch (e: any) {
          console.error("CSV import row failed:", e, r);
          skipCount += 1;
        }
        done += 1;
        setCsvImportState((s) => ({ ...s, done, message: `Importing… ${done}/${csvRows.length}` }));
        await new Promise(res => setTimeout(res, 20));
      }

      await refreshAllBooks();
      
      const finalMsg = skipCount > 0 
        ? `Imported ${successCount} / ${csvRows.length}. ${skipCount} skipped.`
        : `Imported all ${csvRows.length} rows.`;

      setCsvImportState({ busy: false, error: null, message: finalMsg, done: csvRows.length, total: csvRows.length });
      window.setTimeout(() => setCsvImportState((s) => ({ ...s, message: null })), 5000);
      setCsvFileName(null);
      setCsvRows([]);
    } catch (e: any) {
      setCsvImportState({ busy: false, error: e?.message ?? "Import failed", message: "Import failed", done, total: csvRows.length });
    }
  }

  function extFromContentType(contentType: string | null): string {
    const ct = (contentType ?? "").toLowerCase();
    if (ct.includes("image/png")) return "png";
    if (ct.includes("image/webp")) return "webp";
    if (ct.includes("image/avif")) return "avif";
    if (ct.includes("image/gif")) return "gif";
    if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return "jpg";
    return "jpg";
  }

  async function importCoverForBook(userBookId: number, coverUrl: string) {
    if (!supabase) return;
    const value = coverUrl.trim();
    if (!value) return;
    const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(value)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const ext = extFromContentType(res.headers.get("content-type"));
    const path = `${userId}/${userBookId}/cover-import-${Date.now()}.${ext}`;
    const up = await supabase.storage.from("user-book-media").upload(path, blob, {
      cacheControl: "3600",
      upsert: false,
      contentType: blob.type || "application/octet-stream"
    });
    if (up.error) return;
    await supabase.from("user_book_media").insert({ user_book_id: userBookId, kind: "cover", storage_path: path, caption: null });
  }

  async function previewUrl(url: string) {
    setAddState({ busy: true, error: null, message: "Importing…" });
    setAddUrlPreview(null);
    setAddPreviewCoverFailed(false);
    setAddUrlMeta({ final_url: null, domain: null, domain_kind: null });
    try {
      const res = await fetch("/api/import-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Import failed");
      const preview = json.preview ?? null;
      if (preview?.cover_url) {
        const ok = await checkImageDimensions(preview.cover_url);
        if (!ok) preview.cover_url = null;
      }
      setAddUrlPreview(preview);
      setAddUrlMeta({
        final_url: typeof json.final_url === "string" ? json.final_url : null,
        domain: typeof json.domain === "string" ? json.domain : null,
        domain_kind: typeof json.domain_kind === "string" ? json.domain_kind : null
      });
      setAddState({ busy: false, error: null, message: json.info ?? null });
    } catch (e: any) {
      setAddState({ busy: false, error: e?.message ?? "Import failed", message: "Import failed" });
    }
  }

  async function previewIsbn(isbn: string): Promise<boolean> {
    setAddState({ busy: true, error: null, message: "Looking up ISBN…" });
    setAddUrlPreview(null);
    setAddPreviewCoverFailed(false);
    setAddUrlMeta({ final_url: null, domain: null, domain_kind: null });
    try {
      const res = await fetch(`/api/isbn?isbn=${encodeURIComponent(isbn)}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "ISBN lookup failed");
      const edition = (json.edition ?? null) as any;
      if (!edition || typeof edition !== "object") throw new Error("No edition returned");

      let finalCoverUrl = typeof edition.cover_url === "string" ? edition.cover_url.trim() || null : null;
      if (finalCoverUrl) {
        const ok = await checkImageDimensions(finalCoverUrl);
        if (!ok) finalCoverUrl = null;
      }

      setAddUrlPreview({
        title: typeof edition.title === "string" ? edition.title : null,
        authors: Array.isArray(edition.authors) ? edition.authors.filter(Boolean) : [],
        publisher: typeof edition.publisher === "string" ? edition.publisher : null,
        publish_date: typeof edition.publish_date === "string" ? edition.publish_date : null,
        description: typeof edition.description === "string" ? edition.description : null,
        subjects: Array.isArray(edition.subjects) ? edition.subjects.filter(Boolean) : [],
        isbn10: typeof edition.isbn10 === "string" ? edition.isbn10 : null,
        isbn13: typeof edition.isbn13 === "string" ? edition.isbn13 : null,
        cover_url: finalCoverUrl,
        sources: Array.from(new Set(["isbn", ...((edition.sources ?? []) as any[]).map((s: any) => String(s))])).filter(Boolean)
      });
      setAddState({ busy: false, error: null, message: null });
      return true;
    } catch (e: any) {
      setAddState({ busy: false, error: e?.message ?? "ISBN lookup failed", message: "ISBN lookup failed" });
      return false;
    }
  }

  async function searchAddResults(title: string, author: string | null, barcode?: string | null) {
    setAddSearchState({ busy: true, error: null, message: "Searching…" });
    setAddSearchResults([]);
    try {
      const params = new URLSearchParams();
      if (title) params.set("title", title);
      if (author) params.set("author", author);
      if (barcode) params.set("barcode", barcode);
      const res = await fetch(`/api/search?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Search failed");
      setAddSearchResults((json.results ?? []) as SearchCandidate[]);
      setAddSearchState({ busy: false, error: null, message: null });
    } catch (e: any) {
      setAddSearchState({ busy: false, error: e?.message ?? "Search failed", message: "Search failed" });
    }
  }

  async function smartAddOrSearch(override?: string) {
    const value = (override ?? addInput).trim();
    if (!value) return;
    setAddState({ busy: false, error: null, message: null });
    setAddUrlPreview(null);
    setAddUrlMeta({ final_url: null, domain: null, domain_kind: null });
    setAddSearchResults([]);
    setAddSearchState({ busy: false, error: null, message: null });

    if (looksLikeIsbn(value)) {
      const ok = await previewIsbn(value);
      if (ok) return;
      if (looksLikeBarcode(value)) {
        await searchAddResults("", null, value);
      }
      return;
    }

    if (looksLikeBarcode(value)) {
      await searchAddResults("", null, value);
      return;
    }

    const parsedUrl = tryParseUrl(value);
    if (parsedUrl) {
      await previewUrl(parsedUrl.toString());
      return;
    }

    const { title, author } = parseTitleAndAuthor(value);
    if (!title) return;
    await searchAddResults(title, author);
  }

  function cancelAddPreview() {
    setAddUrlPreview(null);
    setAddUrlMeta({ final_url: null, domain: null, domain_kind: null });
    setAddSearchResults([]);
    setAddSearchState({ busy: false, error: null, message: null });
    setAddState({ busy: false, error: null, message: null });
    setAddPreviewCoverFailed(false);
  }

  async function addEditionData(data: {
    isbn10?: string | null;
    isbn13?: string | null;
    title?: string | null;
    authors?: string[];
    publisher?: string | null;
    publish_date?: string | null;
    description?: string | null;
    subjects?: string[];
    cover_url?: string | null;
    object_type?: "book" | "music" | null;
    source_type?: string | null;
    source_url?: string | null;
    external_source_ids?: Record<string, string | null> | null;
    music_metadata?: MusicMetadata | null;
    contributor_entities?: Partial<Record<MusicContributorRole, string[]>> | null;
  }, targetLibraryId?: number | null): Promise<number> {
    if (!supabase) throw new Error("Supabase is not configured");
    const selectedLibraryId = Number(targetLibraryId ?? addLibraryId ?? 0);
    if (!selectedLibraryId) throw new Error("Choose a catalog first");
    const objectType = (data.object_type ?? "book") === "music" ? "music" : "book";
    if (objectType === "music") {
      const musicMetadata = data.music_metadata ?? null;
      const insertPayload: Record<string, unknown> = {
        owner_id: userId,
        library_id: selectedLibraryId,
        edition_id: null,
        object_type: "music",
        title_override: data.title ?? null,
        description_override: data.description ?? null,
        subjects_override: (data.subjects ?? []).length > 0 ? data.subjects : [],
        source_type: data.source_type ?? null,
        source_url: data.source_url ?? null,
        external_source_ids: data.external_source_ids ?? null,
        music_metadata: musicMetadata,
        decade:
          String(musicMetadata?.original_release_year ?? "").trim()
            ? `${String(musicMetadata?.original_release_year).trim().slice(0, 3)}0s`
            : null
      };
      const created = await supabase.from("user_books").insert(insertPayload).select("id").single();
      if (created.error) throw new Error(created.error.message);
      const createdId = created.data.id as number;
      const contributorEntities = data.contributor_entities ?? {};
      const primaryArtist = String(musicMetadata?.primary_artist ?? "").trim();
      if (primaryArtist) {
        contributorEntities.performer = Array.from(new Set([primaryArtist, ...(contributorEntities.performer ?? [])]));
      }
      const label = String(musicMetadata?.label ?? "").trim();
      if (label) {
        await supabase.rpc("set_book_entities", {
          p_user_book_id: createdId,
          p_role: "publisher",
          p_names: [label]
        });
      }
      for (const [role, names] of Object.entries(contributorEntities)) {
        if (!Array.isArray(names) || names.length === 0) continue;
        await supabase.rpc("set_book_entities", {
          p_user_book_id: createdId,
          p_role: role,
          p_names: names
        });
      }
      const coverUrl = (data.cover_url ?? "").trim();
      if (coverUrl) {
        try {
          await importCoverForBook(createdId, coverUrl);
        } catch {
          // ignore cover import failures for music objects
        }
      }
      await refreshAllBooks();
      return createdId;
    }
    const isbn13 = (data.isbn13 ?? "").trim();
    let editionId: number | undefined;
    if (isbn13) {
      const existing = await supabase.from("editions").select("id").eq("isbn13", isbn13).maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      editionId = existing.data?.id as number | undefined;
      if (!editionId) {
        const inserted = await supabase.from("editions").insert({
          isbn10: data.isbn10 ?? null,
          isbn13,
          title: data.title ?? null,
          authors: data.authors ?? [],
          publisher: data.publisher ?? null,
          publish_date: data.publish_date ?? null,
          description: data.description ?? null,
          subjects: data.subjects ?? [],
          cover_url: data.cover_url ?? null,
        }).select("id").single();
        if (inserted.error) throw new Error(inserted.error.message);
        editionId = inserted.data.id;
      } else if ((data.cover_url ?? "").trim()) {
        // Backfill a missing edition cover when this ISBN already exists.
        const cover = (data.cover_url ?? "").trim();
        const currentEdition = await supabase.from("editions").select("cover_url").eq("id", editionId).maybeSingle();
        if (!currentEdition.error) {
          const existingCover = String(currentEdition.data?.cover_url ?? "").trim();
          if (!existingCover) {
            await supabase.from("editions").update({ cover_url: cover }).eq("id", editionId);
          }
        }
      }
    }
    const insertPayload: Record<string, unknown> = { owner_id: userId, library_id: selectedLibraryId, edition_id: editionId ?? null };
    if (!editionId) {
      insertPayload.title_override = data.title ?? null;
      insertPayload.authors_override = (data.authors ?? []).length > 0 ? data.authors : null;
      insertPayload.publisher_override = data.publisher ?? null;
      insertPayload.publish_date_override = data.publish_date ?? null;
    }
    const created = await supabase.from("user_books").insert(insertPayload).select("id").single();
    if (created.error) throw new Error(created.error.message);
    const createdId = created.data.id as number;
    const coverUrl = (data.cover_url ?? "").trim();
    if (coverUrl) {
      try {
        await importCoverForBook(createdId, coverUrl);
      } catch {
        // Non-fatal: edition cover_url fallback still applies.
      }
    }
    await refreshAllBooks();
    return createdId;
  }

  async function confirmAddFromPreview() {
    if (!addUrlPreview) return;
    setAddState({ busy: true, error: null, message: "Adding…" });
    try {
      await addEditionData(addUrlPreview, addPreviewLibraryId);
      setAddInput("");
      cancelAddPreview();
      setAddState({ busy: false, error: null, message: "Added" });
      window.setTimeout(() => {
        setAddState((prev) => (prev.message === "Added" ? { busy: false, error: null, message: null } : prev));
      }, 1200);
    } catch (e: any) {
      setAddState({ busy: false, error: e?.message ?? "Failed to add book", message: e?.message ?? "Failed to add book" });
    }
  }

  async function hydrateDiscogsSearchCandidate(result: SearchCandidate): Promise<SearchCandidate> {
    if (result.source_type !== "discogs" || !result.source_url) return result;
    const res = await fetch("/api/import-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: result.source_url })
    });
    const json = await res.json();
    if (!res.ok || !json?.ok || !json?.preview) return result;
    const preview = json.preview as any;
    return {
      ...result,
      object_type: preview.object_type === "music" ? "music" : (result.object_type ?? "book"),
      source_type: preview.source_type ?? result.source_type ?? null,
      source_url: preview.source_url ?? result.source_url ?? null,
      external_source_ids: preview.external_source_ids ?? result.external_source_ids ?? null,
      title: preview.title ?? result.title ?? null,
      authors: Array.isArray(preview.authors) ? preview.authors.filter(Boolean) : result.authors,
      publisher: preview.publisher ?? result.publisher ?? null,
      publish_date: preview.publish_date ?? result.publish_date ?? null,
      description: preview.description ?? result.description ?? null,
      subjects: Array.isArray(preview.subjects) ? preview.subjects.filter(Boolean) : result.subjects,
      cover_url: preview.cover_url ?? result.cover_url ?? null,
      music_metadata: preview.music_metadata ?? result.music_metadata ?? null,
      contributor_entities: preview.contributor_entities ?? result.contributor_entities ?? null
    };
  }

  async function addFromSearchResultItem(result: typeof addSearchResults[number], targetLibraryId?: number | null) {
    setAddState({ busy: true, error: null, message: "Adding…" });
    try {
      const hydrated = await hydrateDiscogsSearchCandidate(result);
      await addEditionData(hydrated, targetLibraryId);
      setAddInput("");
      cancelAddPreview();
      setAddState({ busy: false, error: null, message: "Added" });
      window.setTimeout(() => {
        setAddState((prev) => (prev.message === "Added" ? { busy: false, error: null, message: null } : prev));
      }, 1200);
    } catch (e: any) {
      setAddState({ busy: false, error: e?.message ?? "Failed to add book", message: e?.message ?? "Failed to add book" });
    }
  }

  async function getOrCreateTagId(name: string, kind: "tag" | "category"): Promise<number> {
    if (!supabase || !userId) throw new Error("Not signed in");
    const normalized = name.trim().replace(/\s+/g, " ");
    const existing = await supabase.from("tags").select("id").eq("owner_id", userId).eq("name", normalized).eq("kind", kind).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.id) return existing.data.id as number;
    const inserted = await supabase.from("tags").insert({ owner_id: userId, name: normalized, kind }).select("id").single();
    if (inserted.error) throw new Error(inserted.error.message);
    return inserted.data.id as number;
  }

  function setUrlFilters(next: Partial<Record<DetailFilterKey, string | null>>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, rawValue] of Object.entries(next)) {
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      if (!value || value === "all") params.delete(key);
      else params.set(key, value);
    }
    const url = params.toString() ? `/app?${params.toString()}` : "/app";
    router.push(url);
  }

  function clampNumber(n: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, n));
  }

  function openTagMenu() {
    closeCategoryMenu();
    const el = tagButtonRef.current;
    if (!el) {
      setTagMenu({ open: true, top: 0, left: 0, minWidth: 260 });
      return;
    }
    const rect = el.getBoundingClientRect();
    const minWidth = Math.max(260, Math.ceil(rect.width));
    const left = clampNumber(rect.left, 8, Math.max(8, window.innerWidth - minWidth - 8));
    const top = rect.bottom + 6;
    setTagSearch("");
    setTagMenu({ open: true, top, left, minWidth });
  }

  function closeTagMenu() {
    setTagMenu((p) => ({ ...p, open: false }));
  }

  function openCategoryMenu() {
    closeTagMenu();
    const el = categoryButtonRef.current;
    if (!el) {
      setCategoryMenu({ open: true, top: 0, left: 0, minWidth: 260 });
      return;
    }
    const rect = el.getBoundingClientRect();
    const minWidth = Math.max(260, Math.ceil(rect.width));
    const left = clampNumber(rect.left, 8, Math.max(8, window.innerWidth - minWidth - 8));
    const top = rect.bottom + 6;
    setCategorySearch("");
    setCategoryMenu({ open: true, top, left, minWidth });
  }

  function closeCategoryMenu() {
    setCategoryMenu((p) => ({ ...p, open: false }));
  }

  async function catalogApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = session.access_token;
    if (!token) throw new Error("not_authenticated");
    const res = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
        authorization: `Bearer ${token}`
      }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(json?.error ?? "request_failed"));
    return json as T;
  }

  async function resolveAvatarUrl(path: string | null | undefined): Promise<string | null> {
    const value = String(path ?? "").trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (!supabase) return null;
    const signed = await supabase.storage.from("avatars").createSignedUrl(value, 60 * 60);
    if (signed.data?.signedUrl) return signed.data.signedUrl;
    const pub = supabase.storage.from("avatars").getPublicUrl(value);
    return pub.data?.publicUrl ?? null;
  }

  async function loadCatalogMembers(catalogId: number) {
    if (!supabase) return;
    setMembersByCatalogId((prev) => ({
      ...prev,
      [catalogId]: {
        busy: true,
        error: null,
        members: prev[catalogId]?.members ?? [],
        inviteInput: prev[catalogId]?.inviteInput ?? "",
        inviteBusy: prev[catalogId]?.inviteBusy ?? false
      }
    }));
    try {
      const res = await catalogApi<{ ok: true; members: any[] }>(`/api/catalog/${catalogId}/members`, { method: "GET" });
      const rows = (res.members ?? []) as any[];
      const nextMembers: CatalogMemberView[] = await Promise.all(rows.map(async (row) => {
        const avatarPath = row?.profile?.avatar_path ? String(row.profile.avatar_path) : null;
        const avatarUrl = await resolveAvatarUrl(avatarPath);
        return {
          id: String(row.id),
          catalog_id: Number(row.catalog_id),
          user_id: String(row.user_id),
          role: String(row.role) as any,
          invited_by: row.invited_by ? String(row.invited_by) : null,
          invited_at: String(row.invited_at),
          accepted_at: row.accepted_at ? String(row.accepted_at) : null,
          profile: row.profile
            ? {
                id: String(row.profile.id),
                username: String(row.profile.username ?? ""),
                display_name: row.profile.display_name ? String(row.profile.display_name) : null,
                avatar_path: avatarPath,
                email: row.profile.email ? String(row.profile.email) : null
              }
            : null,
          avatar_url: avatarUrl
        };
      }));
      setMembersByCatalogId((prev) => ({
        ...prev,
        [catalogId]: {
          busy: false,
          error: null,
          members: nextMembers,
          inviteInput: prev[catalogId]?.inviteInput ?? "",
          inviteBusy: false
        }
      }));
    } catch (e: any) {
      setMembersByCatalogId((prev) => ({
        ...prev,
        [catalogId]: {
          busy: false,
          error: e?.message ?? "Failed to load members",
          members: prev[catalogId]?.members ?? [],
          inviteInput: prev[catalogId]?.inviteInput ?? "",
          inviteBusy: false
        }
      }));
    }
  }

  useEffect(() => {
    if (!bulkMode) return;
    for (const lib of libraries) {
      void loadCatalogMembers(lib.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkMode]);

  useEffect(() => {
    if (!tagMenu.open && !categoryMenu.open) return;
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;

      const inTag = !!tagMenuRef.current?.contains(target) || !!tagButtonRef.current?.contains(target);
      const inCategory = !!categoryMenuRef.current?.contains(target) || !!categoryButtonRef.current?.contains(target);
      if (inTag || inCategory) return;

      closeTagMenu();
      closeCategoryMenu();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [tagMenu.open, categoryMenu.open]);

  async function bulkDeleteSelected() {
    if (!supabase) return;
    if (bulkSelectedGroups.length === 0) return;
    if (!window.confirm(`Delete ${bulkSelectedGroups.length} book(s)? This deletes all selected copies across your catalogs.`)) return;
    setBulkState({ busy: true, error: null, message: "Deleting…" });
    try {
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));
      const paths = Array.from(
        new Set(
          ids
            .flatMap((id) => (items.find((x) => x.id === id)?.media ?? []))
            .map((m) => (typeof (m as any)?.storage_path === "string" ? (m as any).storage_path : ""))
            .filter(Boolean)
        )
      );
      if (paths.length > 0) {
        await supabase.storage.from("user-book-media").remove(paths);
      }
      const del = await supabase.from("user_books").delete().in("id", ids);
      if (del.error) throw new Error(del.error.message);
      setBulkSelectedKeys({});
      await refreshAllBooks();
      setBulkState({ busy: false, error: null, message: "Deleted" });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Bulk delete failed", message: "Bulk delete failed" });
    }
  }

  async function bulkMoveSelected(targetLibraryId: number) {
    if (!supabase) return;
    if (bulkSelectedGroups.length === 0) return;
    setBulkState({ busy: true, error: null, message: "Moving…" });
    try {
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));
      const upd = await supabase.from("user_books").update({ library_id: targetLibraryId }).in("id", ids);
      if (upd.error) throw new Error(upd.error.message);
      setBulkSelectedKeys({});
      await refreshAllBooks();
      setBulkState({ busy: false, error: null, message: "Moved" });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Move failed", message: "Move failed" });
    }
  }

  async function bulkCopySelected(targetLibraryId: number) {
    if (!supabase) return;
    if (bulkSelectedGroups.length === 0) return;
    setBulkState({ busy: true, error: null, message: "Copying…" });
    try {
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));
      const srcRes = await supabase
        .from("user_books")
        .select("*")
        .in("id", ids);
      if (srcRes.error) throw new Error(srcRes.error.message);
      const srcRows = (srcRes.data ?? []) as any[];

      for (const r of srcRows) {
        const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = r;
        await supabase.from("user_books").insert({ ...rest, owner_id: userId, library_id: targetLibraryId });
      }

      setBulkSelectedKeys({});
      await refreshAllBooks();
      setBulkState({ busy: false, error: null, message: `Copied ${srcRows.length}` });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Copy failed", message: "Copy failed" });
    }
  }

  async function bulkAssignCategory() {
    if (!supabase) return;
    if (!bulkSelectedGroups.length) return;
    const name = bulkCategoryName.trim().replace(/\s+/g, " ");
    if (!name) return;
    setBulkState({ busy: true, error: null, message: "Applying…" });
    try {
      const tagId = await getOrCreateTagId(name, "category");
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));
      const rows = ids.map((id) => ({ user_book_id: id, tag_id: tagId }));
      const up = await supabase.from("user_book_tags").upsert(rows as any, { onConflict: "user_book_id,tag_id" });
      if (up.error) throw new Error(up.error.message);
      setBulkCategoryName("");
      await refreshAllBooks();
      setBulkState({ busy: false, error: null, message: "Applied" });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Apply failed", message: "Apply failed" });
    }
  }

  async function bulkMakePublic() {
    if (!supabase) return;
    if (!bulkSelectedGroups.length) return;
    setBulkState({ busy: true, error: null, message: "Applying…" });
    try {
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));
      const { error } = await supabase.from("user_books").update({ visibility: "public" }).in("id", ids);
      if (error) throw new Error(error.message);
      await refreshAllBooks();
      setBulkState({ busy: false, error: null, message: "Applied" });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Apply failed", message: "Apply failed" });
    }
  }

  async function bulkMakePrivate() {
    if (!supabase) return;
    if (!bulkSelectedGroups.length) return;
    setBulkState({ busy: true, error: null, message: "Applying…" });
    try {
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));
      const { error } = await supabase.from("user_books").update({ visibility: "followers_only" }).in("id", ids);
      if (error) throw new Error(error.message);
      await refreshAllBooks();
      setBulkState({ busy: false, error: null, message: "Applied" });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Apply failed", message: "Apply failed" });
    }
  }

  async function deleteEntry(userBookId: number) {
    if (!supabase) return;
    if (!window.confirm("Delete this entry?")) return;
    setDeleteStateByBookId((prev) => ({ ...prev, [userBookId]: { busy: true, error: null, message: "Deleting…" } }));
    try {
      const it = items.find((x) => x.id === userBookId) ?? null;
      const paths = (it?.media ?? []).map((m) => m.storage_path).filter(Boolean);
      if (paths.length > 0) {
        await supabase.storage.from("user-book-media").remove(paths);
      }
      const del = await supabase.from("user_books").delete().eq("id", userBookId);
      if (del.error) throw new Error(del.error.message);
      await refreshAllBooks();
      setDeleteStateByBookId((prev) => ({ ...prev, [userBookId]: { busy: false, error: null, message: "Deleted" } }));
    } catch (e: any) {
      setDeleteStateByBookId((prev) => ({ ...prev, [userBookId]: { busy: false, error: e?.message ?? "Delete failed", message: "Delete failed" } }));
    }
  }

  function toggleBulkKey(key: string) {
    setBulkSelectedKeys((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  }

  function selectAll() {
    const next: Record<string, true> = {};
    for (const g of displayGroups) {
      next[g.key] = true;
    }
    setBulkSelectedKeys(next);
  }

  function moveLibrary(libraryId: number, delta: -1 | 1) {
    const idx = libraries.findIndex((l) => l.id === libraryId);
    if (idx < 0) return;
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= libraries.length) return;
    const next = libraries.slice();
    const [moved] = next.splice(idx, 1);
    next.splice(nextIdx, 0, moved);
    setLibraries(next);
    try {
      window.localStorage.setItem("om_libraryOrder", next.map((l) => l.id).join(","));
    } catch { }
    if (supabase) {
      void Promise.all(
        next.map((l, i) =>
          supabase!.from("libraries").update({ sort_order: i }).eq("id", l.id).eq("owner_id", userId)
        )
      ).catch(() => {});
    }
  }

  function beginEditLibrary(libraryId: number, currentName: string) {
    setEditingLibraryId(libraryId);
    setLibraryNameDraft(currentName ?? "");
    void loadCatalogMembers(libraryId);
  }

  function cancelEditLibrary() {
    setEditingLibraryId(null);
    setLibraryNameDraft("");
  }

  async function inviteCatalogMember(catalogId: number) {
    const draft = (membersByCatalogId[catalogId]?.inviteInput ?? "").trim();
    if (!draft) return;
    setMembersByCatalogId((prev) => ({
      ...prev,
      [catalogId]: {
        busy: prev[catalogId]?.busy ?? false,
        error: null,
        members: prev[catalogId]?.members ?? [],
        inviteInput: prev[catalogId]?.inviteInput ?? "",
        inviteBusy: true
      }
    }));
    try {
      await catalogApi(`/api/catalog/${catalogId}/invite`, {
        method: "POST",
        body: JSON.stringify({ identifier: draft, role: "editor" })
      });
      setMembersByCatalogId((prev) => ({
        ...prev,
        [catalogId]: {
          busy: prev[catalogId]?.busy ?? false,
          error: null,
          members: prev[catalogId]?.members ?? [],
          inviteInput: "",
          inviteBusy: false
        }
      }));
      await loadCatalogMembers(catalogId);
      await refreshLibraries();
      window.dispatchEvent(new Event("om:catalog-members-changed"));
    } catch (e: any) {
      setMembersByCatalogId((prev) => ({
        ...prev,
        [catalogId]: {
          busy: prev[catalogId]?.busy ?? false,
          error: e?.message ?? "Invite failed",
          members: prev[catalogId]?.members ?? [],
          inviteInput: prev[catalogId]?.inviteInput ?? "",
          inviteBusy: false
        }
      }));
    }
  }

  async function removeCatalogMember(catalogId: number, memberUserId: string) {
    try {
      await catalogApi(`/api/catalog/${catalogId}/member/${encodeURIComponent(memberUserId)}`, { method: "DELETE" });
      await loadCatalogMembers(catalogId);
      await refreshLibraries();
      window.dispatchEvent(new Event("om:catalog-members-changed"));
    } catch (e: any) {
      setMembersByCatalogId((prev) => ({
        ...prev,
        [catalogId]: {
          busy: prev[catalogId]?.busy ?? false,
          error: e?.message ?? "Remove failed",
          members: prev[catalogId]?.members ?? [],
          inviteInput: prev[catalogId]?.inviteInput ?? "",
          inviteBusy: prev[catalogId]?.inviteBusy ?? false
        }
      }));
    }
  }

  async function updateCatalogMemberRole(catalogId: number, memberUserId: string, role: "editor") {
    try {
      await catalogApi(`/api/catalog/${catalogId}/member/${encodeURIComponent(memberUserId)}`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      await loadCatalogMembers(catalogId);
      await refreshLibraries();
      window.dispatchEvent(new Event("om:catalog-members-changed"));
    } catch (e: any) {
      setMembersByCatalogId((prev) => ({
        ...prev,
        [catalogId]: {
          busy: prev[catalogId]?.busy ?? false,
          error: e?.message ?? "Role update failed",
          members: prev[catalogId]?.members ?? [],
          inviteInput: prev[catalogId]?.inviteInput ?? "",
          inviteBusy: prev[catalogId]?.inviteBusy ?? false
        }
      }));
    }
  }

  const filteredItems = useMemo(() => items, [items]);

  const displayGroups = useMemo(() => {
    const profileVis = profile?.visibility === "public" ? "public" : "followers_only";
    const activeTag = (filterTag ?? tagMode ?? "all").trim();
    const tag = activeTag === "all" ? "" : activeTag.toLowerCase();
    const author = (filterAuthor ?? "").trim().toLowerCase();
    const subject = (filterSubject ?? "").trim().toLowerCase();
    const publisher = (filterPublisher ?? "").trim().toLowerCase();
    const designer = (filterDesigner ?? "").trim().toLowerCase();
    const groupVal = (filterGroup ?? "").trim().toLowerCase();
    const decadeVal = (filterDecade ?? "").trim().toLowerCase();
    const activeCategoryMode = (filterCategory ?? categoryMode) || "all";
    const categoryTag = (activeCategoryMode === "all" ? "" : String(activeCategoryMode)).trim().toLowerCase();
    const q = searchQuery.trim().toLowerCase();
    const publishDate = (searchParams.get("publish_date") ?? "").trim().toLowerCase();
    const releaseDate = (searchParams.get("release_date") ?? "").trim().toLowerCase();
    const originalReleaseYear = (searchParams.get("original_release_year") ?? "").trim().toLowerCase();
    const formatVal = (searchParams.get("format") ?? "").trim().toLowerCase();
    const releaseType = (searchParams.get("release_type") ?? "").trim().toLowerCase();
    const pressing = (searchParams.get("pressing") ?? "").trim().toLowerCase();
    const catalogNumber = (searchParams.get("catalog_number") ?? "").trim().toLowerCase();
    const barcode = (searchParams.get("barcode") ?? "").trim().toLowerCase();
    const country = (searchParams.get("country") ?? "").trim().toLowerCase();
    const discogsId = (searchParams.get("discogs_id") ?? "").trim().toLowerCase();
    const musicbrainzId = (searchParams.get("musicbrainz_id") ?? "").trim().toLowerCase();
    const speed = (searchParams.get("speed") ?? "").trim().toLowerCase();
    const channels = (searchParams.get("channels") ?? "").trim().toLowerCase();
    const discCount = (searchParams.get("disc_count") ?? "").trim().toLowerCase();
    const limitedEdition = (searchParams.get("limited_edition") ?? "").trim().toLowerCase();
    const reissue = (searchParams.get("reissue") ?? "").trim().toLowerCase();
    const entityRoleFilters = [
      ["performer", "performer"],
      ["composer", "composer"],
      ["producer", "producer"],
      ["engineer", "engineer"],
      ["mastering", "mastering"],
      ["featured_artist", "featured artist"],
      ["arranger", "arranger"],
      ["conductor", "conductor"],
      ["orchestra", "orchestra"],
      ["art_direction", "art direction"],
      ["artwork", "artwork"],
      ["design", "design"],
      ["photography", "photography"],
      ["printer", "printer"]
    ] as const;

    const byKey = new Map<string, CatalogItem[]>();
    for (const it of filteredItems) {
      const key = `${it.library_id}:${groupKeyFor(it)}`;
      const cur = byKey.get(key);
      if (!cur) byKey.set(key, [it]);
      else cur.push(it);
    }

    let groups: CatalogGroup[] = Array.from(byKey.entries()).map(([key, copies]) => {
      const sorted = copies.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const primary = sorted.slice().sort((a, b) => {
        const score = (c: CatalogItem): number => {
          let s = 0;
          if ((c.media ?? []).some((m) => m.kind === "cover")) s += 1000;
          if (c.edition?.cover_url) s += 150;
          return s;
        };
        return score(b) - score(a);
      })[0]!;
      const title = effectiveTitleFor(primary);

      const tagSet = new Set<string>();
      const categorySet = new Set<string>();
      const authorsSet = new Set<string>();
      const subjectsSet = new Set<string>();
      const publishersSet = new Set<string>();
      const designersSet = new Set<string>();
      const groupsSet = new Set<string>();
      const decadesSet = new Set<string>();
      const visSet = new Set<string>();
      const effVisSet = new Set<string>();
      let latest = -Infinity;
      let earliest = Infinity;
      for (const c of sorted) {
        for (const t of tagsFor(c)) {
          if (t.kind === "category") categorySet.add(t.name);
          else tagSet.add(t.name);
        }
        for (const a of effectiveAuthorsFor(c)) authorsSet.add(a);
        for (const s of effectiveSubjectsFor(c)) subjectsSet.add(s);
        const p = effectivePublisherFor(c);
        if (p) publishersSet.add(p);
        for (const d of (c.designers_override ?? [])) if (d) designersSet.add(d);
        if (c.group_label) groupsSet.add(c.group_label);
        if (c.decade) decadesSet.add(c.decade);

        visSet.add(c.visibility);
        const eff = (c.visibility === "inherit" || !c.visibility ? profileVis : c.visibility) as string;
        effVisSet.add(eff);
        const ts = Date.parse(c.created_at);
        if (Number.isFinite(ts)) {
          latest = Math.max(latest, ts);
          earliest = Math.min(earliest, ts);
        }
      }

      return {
        key,
        libraryId: primary.library_id,
        primary,
        copies: sorted,
        copiesCount: sorted.length,
        tagNames: Array.from(tagSet.values()).sort((a, b) => a.localeCompare(b)),
        categoryNames: Array.from(categorySet.values()).sort((a, b) => a.localeCompare(b)),
        filterAuthors: Array.from(authorsSet.values()),
        filterSubjects: Array.from(subjectsSet.values()),
        filterPublishers: Array.from(publishersSet.values()),
        filterDesigners: Array.from(designersSet.values()),
        filterGroups: Array.from(groupsSet.values()),
        filterDecades: Array.from(decadesSet.values()),
        title,
        visibility: visSet.size === 1 ? (primary.visibility as any) : "mixed",
        effectiveVisibility: effVisSet.size === 1 ? ((Array.from(effVisSet.values())[0] as string) === "public" ? "public" : "followers_only") : "mixed",
        latestCreatedAt: Number.isFinite(latest) ? latest : Date.now(),
        earliestCreatedAt: Number.isFinite(earliest) ? earliest : Date.now(),
        sortOrder: sorted.reduce((min, c) => Math.min(min, (c as any).sort_order ?? 0), Infinity)
      };
    });

    if (tag) groups = groups.filter((g) => g.tagNames.some((t) => t.toLowerCase() === tag));
    if (author) groups = groups.filter((g) => g.filterAuthors.some((a) => a.toLowerCase() === author));
    if (subject) groups = groups.filter((g) => g.filterSubjects.some((s) => String(s).toLowerCase() === subject));
    if (publisher) groups = groups.filter((g) => g.filterPublishers.some((p) => p.toLowerCase() === publisher));
    if (designer) groups = groups.filter((g) => g.filterDesigners.some((d) => d.toLowerCase() === designer));
    if (groupVal) groups = groups.filter((g) => g.filterGroups.some((v) => v.toLowerCase() === groupVal));
    if (decadeVal) groups = groups.filter((g) => g.filterDecades.some((v) => v.toLowerCase() === decadeVal));
    if (categoryTag) groups = groups.filter((g) => g.categoryNames.some((t) => t.toLowerCase() === categoryTag));
    if (publishDate) groups = groups.filter((g) => g.copies.some((c) => String(c.publish_date_override ?? c.edition?.publish_date ?? "").trim().toLowerCase() === publishDate));
    if (releaseDate) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.release_date ?? "").trim().toLowerCase() === releaseDate));
    if (originalReleaseYear) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.original_release_year ?? "").trim().toLowerCase() === originalReleaseYear));
    if (formatVal) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.format ?? "").trim().toLowerCase() === formatVal));
    if (releaseType) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.release_type ?? "").trim().toLowerCase() === releaseType));
    if (pressing) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.edition_pressing ?? "").trim().toLowerCase() === pressing));
    if (catalogNumber) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.catalog_number ?? "").trim().toLowerCase() === catalogNumber));
    if (barcode) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.barcode ?? "").trim().toLowerCase() === barcode));
    if (country) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.country ?? "").trim().toLowerCase() === country));
    if (discogsId) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.discogs_id ?? "").trim().toLowerCase() === discogsId));
    if (musicbrainzId) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.musicbrainz_id ?? "").trim().toLowerCase() === musicbrainzId));
    if (speed) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.speed ?? "").trim().toLowerCase() === speed));
    if (channels) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.channels ?? "").trim().toLowerCase() === channels));
    if (discCount) groups = groups.filter((g) => g.copies.some((c) => String(parseMusicMetadata(c.music_metadata)?.disc_count ?? "").trim().toLowerCase() === discCount));
    if (limitedEdition) groups = groups.filter((g) => g.copies.some((c) => {
      const value = parseMusicMetadata(c.music_metadata)?.limited_edition;
      const normalized = value == null ? "" : value ? "yes" : "no";
      return normalized === limitedEdition;
    }));
    if (reissue) groups = groups.filter((g) => g.copies.some((c) => {
      const value = parseMusicMetadata(c.music_metadata)?.reissue;
      const normalized = value == null ? "" : value ? "reissue" : "original release";
      return normalized === reissue;
    }));
    for (const [queryKey, role] of entityRoleFilters) {
      const value = (searchParams.get(queryKey) ?? "").trim().toLowerCase();
      if (!value) continue;
      groups = groups.filter((g) =>
        g.copies.some((c) => {
          if (role === "printer") {
            const printerOverride = String((c as any).printer_override ?? "").trim().toLowerCase();
            if (printerOverride === value) return true;
          }
          return (c.book_entities ?? []).some((row: any) => {
            const rowRole = String(row?.role ?? "").trim().toLowerCase();
            const rowName = String(row?.entity?.name ?? "").trim().toLowerCase();
            return rowRole === role && rowName === value;
          });
        })
      );
    }
    if (visibilityMode !== "all") {
      groups = groups.filter((g) => {
        const eff = g.effectiveVisibility;
        if (visibilityMode === "public") return eff === "public" || eff === "mixed";
        return eff === "followers_only" || eff === "mixed";
      });
    }
    if (q) {
      groups = groups.filter((g) => {
        const haystackParts: string[] = [];
        haystackParts.push(g.title ?? "");
        haystackParts.push((g.filterAuthors ?? []).join(" "));
        haystackParts.push((g.tagNames ?? []).join(" "));
        haystackParts.push((g.categoryNames ?? []).join(" "));
        haystackParts.push((g.filterSubjects ?? []).join(" "));
        haystackParts.push((g.filterPublishers ?? []).join(" "));
        haystackParts.push((g.filterDesigners ?? []).join(" "));
        haystackParts.push((g.filterGroups ?? []).join(" "));
        haystackParts.push((g.filterDecades ?? []).join(" "));
        for (const c of g.copies ?? []) {
          const music = (c as any)?.music_metadata && typeof (c as any).music_metadata === "object" ? (c as any).music_metadata : null;
          haystackParts.push(String(c.edition?.isbn13 ?? ""));
          haystackParts.push(String(c.edition?.isbn10 ?? ""));
          haystackParts.push(String(c.publisher_override ?? ""));
          haystackParts.push(String(c.edition?.publisher ?? ""));
          haystackParts.push(String(c.description_override ?? ""));
          haystackParts.push(String(c.edition?.description ?? ""));
          haystackParts.push(String(c.materials_override ?? ""));
          haystackParts.push(String(c.group_label ?? ""));
          haystackParts.push(String(c.object_type ?? ""));
          haystackParts.push(String((c as any).location ?? ""));
          haystackParts.push(String((c as any).shelf ?? ""));
          haystackParts.push(String((c as any).notes ?? ""));
          haystackParts.push(String(c.decade ?? ""));
          haystackParts.push(String(c.publish_date_override ?? ""));
          haystackParts.push(String(c.edition?.publish_date ?? ""));
          haystackParts.push((c.editors_override ?? []).join(" "));
          haystackParts.push((c.designers_override ?? []).join(" "));
          haystackParts.push((c.subjects_override ?? c.edition?.subjects ?? []).join(" "));
          haystackParts.push((c.book_entities ?? []).map((row: any) => String(row?.entity?.name ?? "")).join(" "));
          if (music) {
            haystackParts.push(String(music.primary_artist ?? ""));
            haystackParts.push(String(music.label ?? ""));
            haystackParts.push(String(music.release_date ?? ""));
            haystackParts.push(String(music.original_release_year ?? ""));
            haystackParts.push(String(music.format ?? ""));
            haystackParts.push(String(music.release_type ?? ""));
            haystackParts.push(String(music.edition_pressing ?? ""));
            haystackParts.push(String(music.catalog_number ?? ""));
            haystackParts.push(String(music.barcode ?? ""));
            haystackParts.push(String(music.country ?? ""));
            haystackParts.push(String(music.discogs_id ?? ""));
            haystackParts.push(String(music.musicbrainz_id ?? ""));
            haystackParts.push(String(music.speed ?? ""));
            haystackParts.push(String(music.channels ?? ""));
            haystackParts.push(String(music.color_variant ?? ""));
            haystackParts.push(String(music.reissue == null ? "" : music.reissue ? "reissue" : "original release"));
            haystackParts.push(String(music.packaging_type ?? ""));
            haystackParts.push(((music.genres ?? []) as string[]).join(" "));
            haystackParts.push(((music.styles ?? []) as string[]).join(" "));
            haystackParts.push((((music.tracklist ?? []) as Array<{ position?: string | null; title?: string | null; duration?: string | null }>).map((track) => `${track.position ?? ""} ${track.title ?? ""} ${track.duration ?? ""}`.trim())).join(" "));
          }
          haystackParts.push(
            (c.book_tags ?? [])
              .map((bt) => bt?.tag)
              .filter((t) => Boolean(t))
              .map((t: any) => String(t.name ?? ""))
              .join(" ")
          );
        }
        return haystackParts.join(" ").toLowerCase().includes(q);
      });
    }

    groups.sort((a, b) => {
      if (sortMode === "custom") return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (sortMode === "latest") return b.latestCreatedAt - a.latestCreatedAt;
      if (sortMode === "earliest") return a.earliestCreatedAt - b.earliestCreatedAt;
      const cmp = normalizeKeyPart(a.title).localeCompare(normalizeKeyPart(b.title));
      return sortMode === "title_asc" ? cmp : -cmp;
    });

    return groups;
  }, [filteredItems, filterTag, tagMode, filterAuthor, filterSubject, filterPublisher, filterDesigner, filterGroup, filterDecade, filterCategory, categoryMode, visibilityMode, sortMode, searchQuery, profile?.visibility, searchParams]);

  const bulkSelectedGroups = useMemo(() => displayGroups.filter((g) => bulkSelectedKeys[g.key]), [displayGroups, bulkSelectedKeys]);

  const displayGroupsByLibraryId = useMemo(() => {
    const by: Record<number, CatalogGroup[]> = {};
    for (const g of displayGroups) {
      const id = g.libraryId;
      if (!by[id]) by[id] = [];
      by[id].push(g);
    }
    return by;
  }, [displayGroups]);

  const renderLibraries = useMemo<LibrarySummary[]>(() => {
    if (libraries.length > 0) return libraries;
    const ids = Array.from(new Set(displayGroups.map((g) => g.libraryId))).filter((id) => Number.isFinite(id) && id > 0);
    return ids.map((id) => ({
      id,
      name: `Catalog ${id}`,
      created_at: new Date(0).toISOString(),
      myRole: "owner"
    }));
  }, [libraries, displayGroups]);
  const ownedRenderLibraries = useMemo(() => renderLibraries.filter((l) => l.myRole !== "editor"), [renderLibraries]);
  const sharedRenderLibraries = useMemo(() => renderLibraries.filter((l) => l.myRole === "editor"), [renderLibraries]);
  const displayLibraries = useMemo(
    () => (showSharedLibraries ? [...ownedRenderLibraries, ...sharedRenderLibraries] : ownedRenderLibraries),
    [ownedRenderLibraries, sharedRenderLibraries, showSharedLibraries]
  );
  const firstSharedDisplayIndex = useMemo(() => displayLibraries.findIndex((l) => l.myRole === "editor"), [displayLibraries]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      for (const t of tagsFor(it)) if (t.kind === "category") set.add(t.name);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      for (const t of tagsFor(it)) if (t.kind === "tag") set.add(t.name);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [items]);
  const availableDecades = useMemo(() => {
    const set = new Set<string>();
    for (const g of displayGroups) {
      for (const d of g.filterDecades ?? []) {
        const v = String(d ?? "").trim();
        if (v) set.add(v);
      }
    }
    return Array.from(set.values()).sort((a, b) => {
      const ai = DECADE_OPTIONS.indexOf(a);
      const bi = DECADE_OPTIONS.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.localeCompare(b);
    });
  }, [displayGroups]);

  useEffect(() => {
    if ((filterCategory ?? "").trim()) return;
    if (categoryMode === "all") return;
    if (!availableCategories.some((c) => c === categoryMode)) setCategoryMode("all");
  }, [availableCategories, categoryMode, filterCategory]);

  useEffect(() => {
    if ((filterTag ?? "").trim()) return;
    if (tagMode === "all") return;
    if (!availableTags.some((t) => t === tagMode)) setTagMode("all");
  }, [availableTags, tagMode, filterTag]);

  if (showInitialSkeleton) {
    return <HomepageSkeleton />;
  }

  return (
    <>
      <div style={{ marginTop: "var(--space-16)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = (e.target.files ?? [])[0];
            if (!f) return;
            setCsvImportState({ busy: true, error: null, message: "Loading CSV…", done: 0, total: 0 });
            loadCsvFile(f).catch((err: any) => {
              setCsvImportState({ busy: false, error: err?.message ?? "CSV load failed", message: "CSV load failed", done: 0, total: 0 });
            });
          }}
          disabled={csvImportState.busy}
        />

        <div className="row" style={{ justifyContent: "space-between", margin: 0 }}>
          <div className="om-stat-line">
            <span className="om-stat-pair">
              <span className="text-muted">Catalogs</span>
              <span>{displayLibraries.length}</span>
            </span>
            <span className="om-stat-pair">
              <span className="text-muted">Items</span>
              <span>{displayGroups.length}</span>
            </span>
            {bulkMode && (
              <>
                <span className="om-stat-pair">
                  <span className="text-muted">Selected</span>
                  <span>{bulkSelectedGroups.length}</span>
                </span>
                {displayGroups.length > 0 && bulkSelectedGroups.length < displayGroups.length && (
                  <button type="button" onClick={selectAll} style={{ background: "transparent", border: 0, padding: 0, font: "inherit", color: "inherit", textDecoration: "underline", cursor: "pointer" }}>
                    Select all
                  </button>
                )}
                {bulkSelectedGroups.length > 0 && (
                  <button type="button" className="om-clear-filter-btn" onClick={() => setBulkSelectedKeys({})} style={{ margin: 0 }}>clear</button>
                )}
              </>
            )}
          </div>
          <div className="row text-muted" style={{ gap: "var(--space-10)", justifyContent: "flex-end" }}>
            <ActiveFilterDisplay
              pairs={(() => {
                const pairs: FilterPair[] = [];
                const activeCategory = (filterCategory ?? categoryMode) !== "all" ? String(filterCategory ?? categoryMode) : null;
                const activeTag = (filterTag ?? tagMode) !== "all" ? String(filterTag ?? tagMode) : null;
                const queryValue = (searchParams.get("q") ?? "").trim();
                
                if (activeCategory) pairs.push({ label: "Category", value: activeCategory, key: "category", onClear: () => { setCategoryMode("all"); clearFilter("category"); } });
                if (activeTag) pairs.push({ label: "Tag", value: activeTag, key: "tag", onClear: () => { setTagMode("all"); clearFilter("tag"); } });
                if (queryValue) pairs.push({ label: "Search", value: queryValue, key: "q", onClear: () => { setSearchQuery(""); clearFilter("q"); } });
                if (filterAuthor) pairs.push({ label: "Author", value: filterAuthor, key: "author", onClear: () => clearFilter("author") });
                if (filterEditor) pairs.push({ label: "Editor", value: filterEditor, key: "editor", onClear: () => clearFilter("editor") });
                if (filterDesigner) pairs.push({ label: "Designer", value: filterDesigner, key: "designer", onClear: () => clearFilter("designer") });
                if (filterSubject) pairs.push({ label: "Subject", value: filterSubject, key: "subject", onClear: () => clearFilter("subject") });
                if (filterPublisher) pairs.push({ label: "Publisher", value: filterPublisher, key: "publisher", onClear: () => clearFilter("publisher") });
                if (filterMaterial) pairs.push({ label: "Material", value: filterMaterial, key: "material", onClear: () => clearFilter("material") });
                if (filterPrinter) pairs.push({ label: "Printer", value: filterPrinter, key: "printer", onClear: () => clearFilter("printer") });
                if (filterPerformer) pairs.push({ label: "Performer", value: filterPerformer, key: "performer", onClear: () => clearFilter("performer") });
                if (filterComposer) pairs.push({ label: "Composer", value: filterComposer, key: "composer", onClear: () => clearFilter("composer") });
                if (filterProducer) pairs.push({ label: "Producer", value: filterProducer, key: "producer", onClear: () => clearFilter("producer") });
                if (filterEngineer) pairs.push({ label: "Engineer", value: filterEngineer, key: "engineer", onClear: () => clearFilter("engineer") });
                if (filterMastering) pairs.push({ label: "Mastering", value: filterMastering, key: "mastering", onClear: () => clearFilter("mastering") });
                if (filterFeaturedArtist) pairs.push({ label: "Featured artist", value: filterFeaturedArtist, key: "featured_artist", onClear: () => clearFilter("featured_artist") });
                if (filterArranger) pairs.push({ label: "Arranger", value: filterArranger, key: "arranger", onClear: () => clearFilter("arranger") });
                if (filterConductor) pairs.push({ label: "Conductor", value: filterConductor, key: "conductor", onClear: () => clearFilter("conductor") });
                if (filterOrchestra) pairs.push({ label: "Orchestra", value: filterOrchestra, key: "orchestra", onClear: () => clearFilter("orchestra") });
                if (filterArtDirection) pairs.push({ label: "Art direction", value: filterArtDirection, key: "art_direction", onClear: () => clearFilter("art_direction") });
                if (filterArtwork) pairs.push({ label: "Artwork", value: filterArtwork, key: "artwork", onClear: () => clearFilter("artwork") });
                if (filterDesign) pairs.push({ label: "Design", value: filterDesign, key: "design", onClear: () => clearFilter("design") });
                if (filterPhotography) pairs.push({ label: "Photography", value: filterPhotography, key: "photography", onClear: () => clearFilter("photography") });
                if (filterGroup) pairs.push({ label: "Group", value: filterGroup, key: "group", onClear: () => clearFilter("group") });
                if (filterDecade) pairs.push({ label: "Decade", value: filterDecade, key: "decade", onClear: () => clearFilter("decade") });
                for (const key of DETAIL_FILTER_KEYS.filter((entry) => !["q", "author", "tag", "category", "publisher", "subject", "designer", "editor", "material", "printer", "performer", "composer", "producer", "engineer", "mastering", "featured_artist", "arranger", "conductor", "orchestra", "art_direction", "artwork", "design", "photography", "group", "decade"].includes(entry))) {
                  const value = (searchParams.get(key) ?? "").trim();
                  const label = detailFilterLabel(key);
                  if (!value || !label) continue;
                  pairs.push({ label, value, key, onClear: () => clearFilter(key) });
                }
                return pairs;
              })()}
              onClearAll={clearAllFilters}
            />
          </div>
        </div>

        {isMobile ? (
          <>
            <div className="row" style={{ width: "100%", margin: 0, gap: "var(--space-10)", alignItems: "baseline", flexWrap: "nowrap" }}>
              {showScan && (
                <div className="row" style={{ gap: "var(--space-sm)", flex: "0 0 auto", alignItems: "baseline" }}>
                  <button className="text-muted" onClick={openScanner} style={{ whiteSpace: "nowrap", padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", textDecoration: "underline" }}>Scan</button>
                  <span className="text-muted" style={{ fontSize: "0.9em" }}>or</span>
                </div>
              )}
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <input
                  placeholder="Add ISBN, URL, or title/author"
                  value={addInput}
                  onFocus={() => { if (bulkMode) exitEditMode(); setSortOpen(false); setAddInputFocused(true); }}
                  onBlur={() => setTimeout(() => setAddInputFocused(false), 150)}
                  onChange={(e) => setAddInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); smartAddOrSearch(); } }}
                  style={{ width: "100%" }}
                />
              </div>
              {((addInput.trim() || addInputFocused) || (addUrlPreview || addSearchResults.length > 0 || addSearchState.message || addState.message)) && (
                <div className="row" style={{ gap: "var(--space-10)", flex: "0 0 auto" }}>
                  {(addInput.trim() || addInputFocused) && (
                    <button onClick={() => smartAddOrSearch()} disabled={addState.busy || !addInput.trim()}>
                      {addState.busy ? "…" : "Go"}
                    </button>
                  )}
                  {(addUrlPreview || addSearchResults.length > 0 || addSearchState.message || addState.message) && (
                    <button onClick={cancelAddPreview} disabled={addState.busy}>Cancel</button>
                  )}
                </div>
              )}
            </div>
            <div className="row" style={{ width: "100%", margin: 0, gap: "var(--space-md)", alignItems: "baseline", flexWrap: "nowrap" }}>
              <button onClick={() => { const next = !bulkMode; if (next) { setAddOpen(false); setSortOpen(false); setSearchOpen(false); setReorderMode(true); } else { exitEditMode(); } setBulkMode(next); }}>
                {bulkMode ? "Done" : "Edit"}
              </button>
              <button type="button" className={sortOpen ? "text-primary" : "text-muted"} onClick={() => { if (bulkMode) exitEditMode(); const next = !sortOpen; setSortOpen(next); if (next) { setSearchOpen(false); } }}>
                View by
              </button>
              <input
                className="om-inline-search-input"
                placeholder="Search your catalog"
                value={searchQuery}
                onFocus={() => { if (bulkMode) exitEditMode(); setSortOpen(false); cancelAddPreview(); setSearchFocused(true); }}
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ minWidth: 0, flex: 1 }}
              />
              {(searchFocused || searchQuery.trim()) && (
                <Link href={`/app/discover${searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ""}`} className="text-muted" style={{ whiteSpace: "nowrap", flex: "0 0 auto" }}>Search others</Link>
              )}
            </div>
          </>
        ) : (
          <div className="row" style={{ width: "100%", margin: 0, alignItems: "baseline", justifyContent: "space-between", flexWrap: "nowrap" }}>
            <div className="row" style={{ flex: "1 1 auto", gap: "var(--space-md)", alignItems: "baseline", minWidth: 0, flexWrap: "nowrap", margin: 0 }}>
              {showScan && (
                <div className="row" style={{ gap: "var(--space-sm)", flex: "0 0 auto", alignItems: "baseline" }}>
                  <button className="text-muted" onClick={openScanner} style={{ whiteSpace: "nowrap", padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", textDecoration: "underline" }}>Scan</button>
                  <span className="text-muted" style={{ fontSize: "0.9em" }}>or</span>
                </div>
              )}
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <input
                  placeholder={showScan ? "enter ISBN…" : "Add by ISBN, URL, or title/author"}
                  value={addInput}
                  onFocus={() => { if (bulkMode) exitEditMode(); setSortOpen(false); setAddInputFocused(true); }}
                  onBlur={() => setTimeout(() => setAddInputFocused(false), 150)}
                  onChange={(e) => setAddInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); smartAddOrSearch(); } }}
                  style={{ width: "100%" }}
                />
              </div>
              <div className="row" style={{ gap: "var(--space-10)", flex: "0 0 auto" }}>
                {(addInput.trim() || addInputFocused) && (
                  <button onClick={() => smartAddOrSearch()} disabled={addState.busy || !addInput.trim()}>
                    {addState.busy ? "…" : "Go"}
                  </button>
                )}
                {(addUrlPreview || addSearchResults.length > 0 || addSearchState.message || addState.message) && (
                  <button onClick={cancelAddPreview} disabled={addState.busy}>Cancel</button>
                )}
              </div>
              <button onClick={() => { const next = !bulkMode; if (next) { setAddOpen(false); setSortOpen(false); setSearchOpen(false); setReorderMode(true); } else { exitEditMode(); } setBulkMode(next); }}>
                {bulkMode ? "Done" : "Edit"}
              </button>
              <button type="button" className={sortOpen ? "text-primary" : "text-muted"} onClick={() => { if (bulkMode) exitEditMode(); const next = !sortOpen; setSortOpen(next); if (next) { setSearchOpen(false); } }}>
                View by
              </button>
            </div>
            <button type="button" className={searchOpen ? "text-primary" : "text-muted"} onClick={() => { if (bulkMode) exitEditMode(); const next = !searchOpen; setSearchOpen(next); if (next) { setSortOpen(false); } }}>
              Search
            </button>
          </div>
        )}
      </div>

      {!isMobile && searchOpen && (
        <div className="row" style={{ width: "100%", marginTop: "var(--space-sm)", alignItems: "baseline", gap: "var(--space-md)", flexWrap: "nowrap", position: "relative", zIndex: 2 }}>
          <input
            className="om-inline-search-input"
            placeholder="Search your catalog"
            value={searchQuery}
            onFocus={() => { if (bulkMode) exitEditMode(); setSortOpen(false); cancelAddPreview(); setSearchFocused(true); }}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ minWidth: 0, flex: 1, maxWidth: "100%", position: "relative", zIndex: 2, pointerEvents: "auto" }}
          />
          {(searchFocused || searchQuery.trim()) && (
            <Link href={`/app/discover${searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ""}`} className="text-muted" style={{ whiteSpace: "nowrap", flex: "0 0 auto" }}>Search others</Link>
          )}
        </div>
      )}


        {(addState.message || addSearchState.message) && (
          <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
            {addState.message || addSearchState.message}
          </div>
        )}

        {addUrlPreview && (
          <div className="om-lookup-item">
            <div className="om-lookup-row">
              <div style={{ width: 62, flex: "0 0 auto" }}>
                {addUrlPreview.cover_url && !addPreviewCoverFailed ? (
                  <div className="om-cover-slot" style={{ width: 60, height: "auto" }}>
                    <img
                      src={addUrlPreview.cover_url}
                      alt=""
                      width={60}
                      style={{ display: "block", width: "100%", height: "auto", objectFit: "contain" }}
                      onError={() => setAddPreviewCoverFailed(true)}
                    />
                  </div>
                ) : (
                  <div className="om-cover-slot" style={{ width: 60, height: "auto" }}><div className="om-cover-placeholder" style={{ width: "100%", aspectRatio: "3/4" }} /></div>
                )}
              </div>
              <div className="om-lookup-main">
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(addUrlPreview.title ?? "").trim() || "—"}</div>
                <div className="text-muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(addUrlPreview.authors ?? []).filter(Boolean).join(", ") || "—"}
                </div>
                <div className="text-muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[addUrlPreview.publisher ?? "", addUrlPreview.publish_date ?? ""].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div className="om-lookup-actions">
                {renderLibraries.length > 1 ? (
                  <div className="row no-wrap" style={{ gap: "var(--space-sm)", alignItems: "baseline" }}>
                    <span className="text-muted">Add to</span>
                    <select
                      value={String(addPreviewLibraryId ?? addLibraryId ?? renderLibraries[0]?.id ?? "")}
                      onChange={(e) => setAddPreviewLibraryId(Number(e.target.value))}
                      disabled={addState.busy}
                    >
                      {renderLibraries.map((l) => (
                        <option key={l.id} value={String(l.id)}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <button onClick={confirmAddFromPreview} disabled={addState.busy}>
                      {addState.busy ? "…" : "OK"}
                    </button>
                  </div>
                ) : (
                  <button onClick={confirmAddFromPreview} disabled={addState.busy}>
                    {addState.busy ? "…" : "Add to catalog"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {addSearchResults.length > 0 && (
          <div>
            {addSearchResults.slice(0, addSearchLimit).map((result, i) => (
              <div key={i} className="om-lookup-item">
                <div className="om-lookup-row">
                  <div style={{ width: 62, flex: "0 0 auto" }}>
                    {result.cover_url ? (
                      <div className="om-cover-slot" style={{ width: 60, height: "auto" }}>
                        <img 
                          src={proxyExternalImageUrl(result.cover_url)} 
                          alt="" 
                          width={60} 
                          style={{ display: "block", width: "100%", height: "auto", objectFit: "contain" }} 
                          onError={(e) => {
                            const candidates = result.cover_candidates || [];
                            const currentSrc = e.currentTarget.src;
                            const nextCandidate = candidates.find(c => proxyExternalImageUrl(c) !== currentSrc);
                            if (nextCandidate) {
                              e.currentTarget.src = proxyExternalImageUrl(nextCandidate);
                            } else {
                              e.currentTarget.style.display = "none";
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="om-cover-slot" style={{ width: 60, height: "auto" }}><div className="om-cover-placeholder" style={{ width: "100%", aspectRatio: "3/4" }} /></div>
                    )}
                  </div>
                  <div className="om-lookup-main">
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(result.title ?? "").trim() || "—"}</div>
                    <div className="text-muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {(result.authors ?? []).filter(Boolean).join(", ") || "—"}
                    </div>
                    <div className="text-muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[
                        result.publisher ?? "",
                        result.publish_year ? String(result.publish_year) : (result.publish_date ?? ""),
                        (result.object_type === "music" ? (result.music_metadata as any)?.format : "") ?? "",
                        (result.object_type === "music" ? (result.music_metadata as any)?.catalog_number : "") ?? ""
                      ].filter(Boolean).join(" · ") || "—"}
                    </div>
                    {result.object_type === "music" && (result.subjects ?? []).length > 0 && (
                      <div className="text-muted" style={{ marginTop: 2, fontSize: "0.9em", opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {(result.subjects ?? []).slice(0, 5).join(", ")}
                      </div>
                    )}
                  </div>
                  <div className="om-lookup-actions">
                    {renderLibraries.length > 1 ? (
                      <div className="row no-wrap" style={{ gap: "var(--space-sm)", alignItems: "baseline" }}>
                        <span className="text-muted">Add to</span>
                        <select
                          value={String(addSearchLibraryIds[i] ?? addLibraryId ?? renderLibraries[0]?.id ?? "")}
                          onChange={(e) =>
                            setAddSearchLibraryIds((prev) => ({ ...prev, [i]: Number(e.target.value) }))
                          }
                          disabled={addState.busy}
                        >
                          {renderLibraries.map((l) => (
                            <option key={l.id} value={String(l.id)}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                        <button onClick={() => addFromSearchResultItem(result, addSearchLibraryIds[i])} disabled={addState.busy}>
                          {addState.busy ? "…" : "OK"}
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => addFromSearchResultItem(result, addLibraryId)} disabled={addState.busy}>
                        {addState.busy ? "…" : "Add"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {addSearchResults.length > addSearchLimit || addSearchLimit > addSearchPageSize ? (
              <div className="row" style={{ marginTop: "var(--space-md)", justifyContent: "center" }}>
                {addSearchResults.length > addSearchLimit ? (
                  <button onClick={() => setAddSearchLimit((prev) => prev + addSearchPageSize)} className="text-muted">
                    Load more
                  </button>
                ) : null}
                {addSearchLimit > addSearchPageSize ? (
                  <button onClick={() => setAddSearchLimit(addSearchPageSize)} className="text-muted">
                    See less
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

      {sortOpen && (
        <div className="om-filter-row" style={{ marginTop: "var(--space-10)", marginBottom: 4, gap: "var(--space-10)", alignItems: "center" }}>
          <select className="om-filter-control" value={viewMode} onChange={(e) => setViewMode(e.target.value as any)}>
            <option value="grid">grid</option>
            <option value="list">list</option>
          </select>
          {viewMode === "grid" && (
            <select className="om-filter-control" value={gridCols} onChange={(e) => setGridCols(Number(e.target.value) as any)}>
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

          <select className="om-filter-control" value={sortMode} onChange={(e) => {
            const val = e.target.value as any;
            setSortMode(val);
            if (val === "custom" && rearrangingLibraryId === null && displayLibraries.length > 0) {
              setRearrangingLibraryId(displayLibraries[0].id);
            }
          }}>
            <option value="custom">custom order</option>
            <option value="latest">latest</option>
            <option value="earliest">earliest</option>
            <option value="title_asc">title A-Z</option>
            <option value="title_desc">title Z-A</option>
          </select>          {(availableCategories.length > 0 || !!(filterCategory ?? "").trim()) && (
            <select className="om-filter-control" value={filterCategory ?? ""} onChange={(e) => setUrlFilters({ category: e.target.value || null })}>
              <option value="">category</option>
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {(availableTags.length > 0 || !!(filterTag ?? "").trim()) && (
            <select className="om-filter-control" value={filterTag ?? ""} onChange={(e) => setUrlFilters({ tag: e.target.value || null })}>
              <option value="">tags</option>
              {availableTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          {(availableDecades.length > 0 || !!(filterDecade ?? "").trim()) && (
            <select className="om-filter-control" value={filterDecade ?? ""} onChange={(e) => setUrlFilters({ decade: e.target.value || null })}>
              <option value="">decade</option>
              {availableDecades.map((decade) => (
                <option key={decade} value={decade}>
                  {decade}
                </option>
              ))}
            </select>
          )}
          <select className="om-filter-control" value={visibilityMode} onChange={(e) => setVisibilityMode(e.target.value as any)}>
            <option value="all">visibility</option>
            <option value="public">public</option>
            <option value="private">private</option>
          </select>
        </div>
      )}

      <BulkBar
        bulkMode={bulkMode}
        bulkState={bulkState}
        selectedGroupsCount={bulkSelectedGroups.length}
        libraries={renderLibraries.map((l) => ({ id: l.id, name: l.name }))}
        bulkCategoryName={bulkCategoryName}
        setBulkCategoryName={setBulkCategoryName}
        onClearSelected={() => setBulkSelectedKeys({})}
        onBulkDeleteSelected={bulkDeleteSelected}
        onBulkMakePublic={bulkMakePublic}
        onBulkMakePrivate={bulkMakePrivate}
        onBulkAssignCategory={bulkAssignCategory}
        onBulkMoveSelected={bulkMoveSelected}
        onBulkCopySelected={bulkCopySelected}
        onAnyMenuOpen={() => { closeTagMenu(); closeCategoryMenu(); }}
      />

      <div style={{ height: "var(--catalog-top-gap)" }} />

      {displayLibraries.map((lib, idx) => {
        const groups = displayGroupsByLibraryId[lib.id] ?? [];
        const effectiveCols = isMobile ? Math.min(gridCols, 2) : gridCols;
        const showBookSkeleton = booksLoading && groups.length === 0;
        const memberState = membersByCatalogId[lib.id] ?? { busy: false, error: null, members: [], inviteInput: "", inviteBusy: false };
        const acceptedMembers = memberState.members.filter((m) => m.accepted_at);
        const pendingMembers = memberState.members.filter((m) => !m.accepted_at);
        const selfMember = memberState.members.find((m) => m.user_id === userId) ?? null;
        const iAmOwner = (selfMember?.role ?? lib.myRole) === "owner";
        const hasSharedCatalogMembers =
          (lib.memberPreviews ?? []).length > 0 ||
          acceptedMembers.some((m) => m.user_id !== userId) ||
          pendingMembers.length > 0;
        const showMembersEditor = bulkMode && hasSharedCatalogMembers && membersEditorCatalogId === lib.id;
        const membersPanel = showMembersEditor ? (
          <div style={{ marginTop: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
            <div className="text-muted">Members</div>

            <div style={{ marginTop: "var(--space-md)" }}>
              {acceptedMembers.map((m) => {
                const display = (m.profile?.display_name ?? "").trim() || m.profile?.username || m.user_id;
                const username = (m.profile?.username ?? "").trim();
                const isSelfRow = m.user_id === userId;
                const isRowOwner = m.role === "owner";
                const canModify = iAmOwner && !isRowOwner;
                return (
                  <div key={m.id} className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-sm)" }}>
                    <div className="om-avatar-lockup">
                      {m.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt="" src={m.avatar_url} className="om-avatar-img" />
                      ) : (
                        <div className="om-avatar-img" style={{ background: "var(--placeholder-bg)" }} />
                      )}
                      {username && !isSelfRow ? <Link href={`/u/${username}`}>{display}</Link> : <span>{display}</span>}
                    </div>
                    <div className="row" style={{ alignItems: "baseline", gap: "var(--space-md)", flexWrap: "nowrap" }}>
                      {isRowOwner ? <span className="text-muted">owner</span> : <span className="text-muted">editor</span>}
                      {canModify ? (
                        <button className="text-muted" onClick={() => void removeCatalogMember(lib.id, m.user_id)}>
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {pendingMembers.length > 0 ? (
              <div style={{ marginTop: "var(--space-md)" }}>
                <div className="text-muted">Pending invitations</div>
                {pendingMembers.map((m) => {
                  const display = (m.profile?.display_name ?? "").trim() || m.profile?.username || m.profile?.email || m.user_id;
                  const username = (m.profile?.username ?? "").trim();
                  const isSelfRow = m.user_id === userId;
                  return (
                    <div key={m.id} className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-sm)" }}>
                      {username && !isSelfRow ? <Link href={`/u/${username}`}>{display}</Link> : <span>{display}</span>}
                      <div className="row" style={{ alignItems: "baseline", gap: "var(--space-md)", flexWrap: "nowrap" }}>
                        <span className="text-muted">pending</span>
                        {iAmOwner ? (
                          <>
                            <button className="text-muted" onClick={() => void removeCatalogMember(lib.id, m.user_id)}>
                              Rescind
                            </button>
                            <button
                              className="text-muted"
                              onClick={() => {
                                if (!window.confirm("Delete this pending invite?")) return;
                                void removeCatalogMember(lib.id, m.user_id);
                              }}
                            >
                              Delete
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {iAmOwner ? (
              <div className="row" style={{ marginTop: "var(--space-md)", alignItems: "baseline", flexWrap: "nowrap" }}>
                <input
                  placeholder="Invite by username or email"
                  value={memberState.inviteInput}
                  onChange={(e) =>
                    setMembersByCatalogId((prev) => ({
                      ...prev,
                      [lib.id]: { ...memberState, inviteInput: e.target.value }
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void inviteCatalogMember(lib.id);
                  }}
                  style={{ minWidth: 0, flex: 1 }}
                />
                <button onClick={() => void inviteCatalogMember(lib.id)} disabled={memberState.inviteBusy || !memberState.inviteInput.trim()}>
                  {memberState.inviteBusy ? "Inviting…" : "Invite"}
                </button>
              </div>
            ) : null}
            {memberState.error ? <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>{memberState.error}</div> : null}
          </div>
        ) : null;
        return (
          <div key={lib.id}>
            {firstSharedDisplayIndex === idx ? (
              <div style={{ marginBottom: "var(--space-sm)" }} className="text-muted">
                Shared with you
              </div>
            ) : null}
            <LibraryBlock
              libraryId={lib.id}
              libraryName={lib.name}
              memberPreviews={lib.memberPreviews ?? []}
              showEditMembers={bulkMode && hasSharedCatalogMembers}
              membersEditorOpen={membersEditorCatalogId === lib.id}
              onToggleMembersEditor={(catalogId) => {
                setMembersEditorCatalogId((prev) => (prev === catalogId ? null : catalogId));
                void loadCatalogMembers(catalogId);
              }}
              membersPanel={membersPanel}
              bookCount={groups.length}
              index={idx}
              total={displayLibraries.length}
              rearrangingLibraryId={rearrangingLibraryId}
              onToggleRearrange={(id) => {
                setRearrangingLibraryId(id);
                if (id !== null) {
                  setSortMode("custom");
                  window.localStorage.setItem("om_sortMode", "custom");
                }
              }}
              busy={libraryState.busy}
              isEditing={editingLibraryId === lib.id}
              nameDraft={libraryNameDraft}
              reorderMode={reorderMode}
              manageMode={bulkMode}
              onStartEdit={beginEditLibrary}
              onNameDraftChange={setLibraryNameDraft}
              onSaveName={saveLibraryName}
              onCancelEdit={cancelEditLibrary}
              onDelete={deleteLibrary}
              collapsed={!!collapsedByLibraryId[lib.id]}
              onToggleCollapsed={(id) =>
                setCollapsedByLibraryId((prev) => {
                  const n = { ...prev };
                  const nextCollapsed = !n[id];
                  if (n[id]) delete n[id];
                  else n[id] = true;
                  if (nextCollapsed && membersEditorCatalogId === id) {
                    setMembersEditorCatalogId(null);
                  }
                  return n;
                })
              }
              onMoveUp={(id) => moveLibrary(id, -1)}
              onMoveDown={(id) => moveLibrary(id, 1)}
              viewMode={viewMode}
              gridCols={effectiveCols}
              isMobile={isMobile}
              searchQuery={searchQuery}
              renderBooks={(limit, effectiveViewMode) => (
                <div style={{ display: effectiveViewMode === "grid" ? "grid" : "flex", flexDirection: effectiveViewMode === "list" ? "column" : undefined, gridTemplateColumns: effectiveViewMode === "grid" ? `repeat(${effectiveCols}, minmax(0, 1fr))` : undefined, gap: "var(--space-md)" }}>
                  {showBookSkeleton
                    ? Array.from({ length: Math.min(4, Math.max(1, effectiveCols)) }).map((_, i) => (
                        <div key={`skeleton-${lib.id}-${i}`} className="om-cover-placeholder" style={{ width: "100%", aspectRatio: "3/4" }} />
                      ))
                    : null}
                  {groups.slice(0, limit).map((g) => {
                    const orderedBookIds = groups.map((group) => Number(group.primary.id)).filter((id) => Number.isFinite(id) && id > 0);
                    const resolvedCoverUrl =
                      typeof g.primary.resolved_cover_url === "string" && g.primary.resolved_cover_url.trim()
                        ? g.primary.resolved_cover_url
                        : null;
                    
                    const isRearrangingThis = rearrangingLibraryId === lib.id;
                    const isDragged = draggedItemKey === g.key;
                    const isDragOver = dragOverItemKey === g.key;

                    return (
                      <div
                        key={g.key}
                        data-reorder-key={g.key}
                        data-reorder-lib-id={lib.id}
                        draggable={isRearrangingThis}
                        onDragStart={isRearrangingThis ? (e) => handleDragStart(e, g.key, lib.id) : undefined}
                        onDragOver={isRearrangingThis ? (e) => handleDragOver(e, g.key) : undefined}
                        onDragEnter={isRearrangingThis ? (e) => handleDragEnter(e, g.key, lib.id) : undefined}
                        onDragEnd={isRearrangingThis ? handleDragEnd : undefined}
                        onDrop={isRearrangingThis ? (e) => handleDrop(e, g.key, lib.id) : undefined}
                        onTouchStart={isRearrangingThis ? (e) => handleTouchStart(e, g.key, lib.id) : undefined}
                        onTouchMove={isRearrangingThis ? handleTouchMove : undefined}
                        onTouchEnd={isRearrangingThis ? handleTouchEnd : undefined}
                        style={{
                          opacity: isDragged ? 0.3 : 1,
                          cursor: isRearrangingThis ? "grab" : "default",
                          transition: "all 0.3s cubic-bezier(0.2, 0, 0, 1)",
                          transform: isDragged ? "scale(1.05)" : "none",
                          zIndex: isDragged ? 1000 : 1,
                          boxShadow: isDragged ? "0 8px 24px rgba(0,0,0,0.2)" : "none",
                          position: "relative",
                          touchAction: isRearrangingThis ? "none" : "auto"
                        }}
                      >
                        <BookCard
                          viewMode={viewMode}
                          bulkMode={bulkMode || isRearrangingThis}
                          selected={!!bulkSelectedKeys[g.key]}
                          onToggleSelected={() => toggleBulkKey(g.key)}
                          title={g.title}
                          authors={g.filterAuthors}
                          isbn13={g.primary.edition?.isbn13 ?? null}
                          tags={g.tagNames}
                          copiesCount={g.copiesCount}
                          href={isRearrangingThis ? "" : `/app/books/${g.primary.id}`}
                          coverUrl={resolvedCoverUrl}
                          originalSrc={resolvedCoverUrl}
                          onOpen={() => storeBookNavContext(lib.id, orderedBookIds)}
                          cropData={g.primary.cover_crop}
                          onDeleteCopy={() => deleteEntry(g.primary.id)}
                          deleteState={deleteStateByBookId[g.primary.id]}
                          gridCols={effectiveCols}
                        />
                        {isRearrangingThis && (
                          <div style={{ position: "absolute", inset: 0, zIndex: 10, cursor: "grab" }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            />
            {idx < displayLibraries.length - 1 && <hr className="om-hr" />}
          </div>
        );
      })}

      <div style={{ marginTop: 24 }} className="card">
        <div className="row" style={{ marginTop: "var(--space-sm)", flexWrap: isMobile ? "wrap" : "nowrap", gap: "var(--space-10)", width: "100%", alignItems: "baseline" }}>
          <input
            placeholder="Add another catalog (e.g. Home, Office)"
            value={newLibraryName}
            onFocus={() => setNewLibraryFocused(true)}
            onBlur={() => setNewLibraryFocused(false)}
            onChange={(e) => setNewLibraryName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createLibrary(newLibraryName); } }}
            style={{ minWidth: 0, flex: 1 }}
          />
          {(newLibraryName.trim() || newLibraryFocused) && (
            <button onClick={() => createLibrary(newLibraryName)} disabled={libraryState.busy} style={{ marginLeft: "auto" }}>Add</button>
          )}
        </div>
      </div>
      <div style={{ height: 24 }} />
      <BookScannerModal open={scannerOpen} onClose={closeScanner} onResult={(query) => { setAddInput(query); smartAddOrSearch(query); }} />
    </>
  );
}

function AppWithFilters({ session }: { session: Session }) {
  const searchParams = useSearchParams();
  usePageTitle(useMemo(() => contextFromFilterParams(searchParams, "Home"), [searchParams]));
  const filterTag = searchParams.get("tag");
  const filterAuthor = searchParams.get("author");
  const filterSubject = searchParams.get("subject");
  const filterPublisher = searchParams.get("publisher");
  const filterDesigner = searchParams.get("designer");
  const filterEditor = searchParams.get("editor");
  const filterMaterial = searchParams.get("material");
  const filterPrinter = searchParams.get("printer");
  const filterPerformer = searchParams.get("performer");
  const filterComposer = searchParams.get("composer");
  const filterProducer = searchParams.get("producer");
  const filterEngineer = searchParams.get("engineer");
  const filterMastering = searchParams.get("mastering");
  const filterFeaturedArtist = searchParams.get("featured_artist");
  const filterArranger = searchParams.get("arranger");
  const filterConductor = searchParams.get("conductor");
  const filterOrchestra = searchParams.get("orchestra");
  const filterArtDirection = searchParams.get("art_direction");
  const filterArtwork = searchParams.get("artwork");
  const filterDesign = searchParams.get("design");
  const filterPhotography = searchParams.get("photography");
  const filterGroup = searchParams.get("group");
  const filterDecade = searchParams.get("decade");
  const filterCategory = searchParams.get("category");
  const openAddPanel = searchParams.get("add") === "1";
  const openCsvPicker = searchParams.get("csv") === "1";
  return (
    <AppShell
      session={session}
      filterTag={filterTag}
      filterAuthor={filterAuthor}
      filterSubject={filterSubject}
      filterPublisher={filterPublisher}
      filterDesigner={filterDesigner}
      filterEditor={filterEditor}
      filterMaterial={filterMaterial}
      filterPrinter={filterPrinter}
      filterPerformer={filterPerformer}
      filterComposer={filterComposer}
      filterProducer={filterProducer}
      filterEngineer={filterEngineer}
      filterMastering={filterMastering}
      filterFeaturedArtist={filterFeaturedArtist}
      filterArranger={filterArranger}
      filterConductor={filterConductor}
      filterOrchestra={filterOrchestra}
      filterArtDirection={filterArtDirection}
      filterArtwork={filterArtwork}
      filterDesign={filterDesign}
      filterPhotography={filterPhotography}
      filterGroup={filterGroup}
      filterDecade={filterDecade}
      filterCategory={filterCategory}
      openAddPanel={openAddPanel}
      openCsvPicker={openCsvPicker}
    />
  );
}

export default function AppPage() {
  usePageTitle("Home");
  const [session, setSession] = useState<Session | null>(null);
  const [authState, setAuthState] = useState<"loading" | "authed" | "guest">("loading");

  useEffect(() => {
    if (!supabase) {
      setAuthState("guest");
      return;
    }
    let alive = true;
    let guestTimer: number | null = null;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const s = data.session ?? null;
      setSession(s);
      if (s) {
        setAuthState("authed");
      } else {
        // Grace window prevents guest flash while auth session restores.
        guestTimer = window.setTimeout(() => {
          if (!alive) return;
          setAuthState("guest");
        }, 700);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!alive) return;
      if (guestTimer) {
        window.clearTimeout(guestTimer);
        guestTimer = null;
      }
      const s = newSession ?? null;
      setSession(s);
      setAuthState(s ? "authed" : "guest");
    });
    return () => {
      alive = false;
      if (guestTimer) window.clearTimeout(guestTimer);
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <main className="container">
      {!supabase ? (
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.</div>
        </div>
      ) : authState === "loading" ? (
        <HomepageSkeleton />
      ) : authState === "authed" && session ? (
        <Suspense fallback={<HomepageSkeleton />}>
          <AppWithFilters session={session} />
        </Suspense>
      ) : (
        <SignInCard note="Profiles are public by default." />
      )}
    </main>
  );
}
