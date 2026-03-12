"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabaseClient";
import SignInCard from "../components/SignInCard";
import BulkBar from "./components/BulkBar";
import LibraryBlock from "./components/LibraryBlock";
import HomepageSkeleton from "./components/HomepageSkeleton";
import SortableCatalogGrid from "./components/SortableCatalogGrid";
import CatalogRenderBoundary from "./components/CatalogRenderBoundary";
import { useBookScanner } from "../../hooks/useBookScanner";
import usePageTitle from "../../hooks/usePageTitle";
import dynamic from "next/dynamic";
import ActiveFilterDisplay, { type FilterPair } from "../../components/ActiveFilterDisplay";
import RotatingHintInput from "../../components/RotatingHintInput";
import type { CatalogItem, CatalogGroup } from "../../lib/types";
import { 
  normalizeKeyPart, 
  effectiveTitleFor, 
  effectiveAuthorsFor, 
  effectiveSecondaryLineFor,
  effectiveSubjectsFor, 
  effectivePublisherFor, 
  groupKeyFor,
  titleSortKeyFor,
  tagsFor
} from "../../lib/book";
import {
  normalizeIsbn,
  looksLikeIsbn,
  looksLikeLccn,
  looksLikeOclc,
  tryParseUrl,
  parseTitleAndAuthor
} from "../../lib/isbn";
import { DECADE_OPTIONS } from "../../lib/decades";
import { saveBookNavContext } from "../../lib/bookNav";
import { parseMusicMetadata, type MusicMetadata, type MusicContributorRole } from "../../lib/music";
import { formatIssueDisplay, looksLikeIssn, normalizeIssueYear, normalizeIssn, parseMagazineTitle } from "../../lib/magazine";
import { contextFromFilterParams } from "../../lib/pageTitle";
import { DETAIL_FILTER_KEYS, detailFilterLabel, type DetailFilterKey } from "../../lib/detailFilters";
import { slugify } from "../../lib/slug";
import { arrayMove } from "@dnd-kit/sortable";
import { useStickyBand } from "./hooks/useStickyBand";

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

function entityHrefForName(name: string): string | undefined {
  const normalized = String(name ?? "").trim();
  if (!normalized) return undefined;
  return `/entity/${slugify(normalized)}`;
}

type SearchCandidate = {
  source: "openlibrary" | "googleBooks" | "discogs";
  object_type?: "book" | "music" | "magazine" | null;
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
  issn?: string | null;
  issue_number?: string | null;
  issue_volume?: string | null;
  issue_season?: string | null;
  issue_year?: number | null;
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

const HOMEPAGE_CACHE_KEY = "om_homepage_home_cache_v2";
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

function clearHomepageCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(HOMEPAGE_CACHE_KEY);
    window.localStorage.removeItem("om_homepage_home_cache_v1");
  } catch {
    // ignore cache clear failures
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

function coerceStringArray(input: unknown): string[] | null {
  if (input == null) return null;
  if (Array.isArray(input)) {
    const next = input
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    return next.length > 0 ? next : [];
  }
  if (typeof input === "string") {
    const next = splitListField(input);
    return next.length > 0 ? next : [];
  }
  return [];
}

function normalizeMemberPreviews(input: unknown): Array<{ userId: string; username: string; avatarUrl: string | null }> {
  if (!Array.isArray(input)) return [];
  const out: Array<{ userId: string; username: string; avatarUrl: string | null }> = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const raw = row as Record<string, unknown>;
    const userId = String(raw.userId ?? raw.user_id ?? "").trim();
    const username = String(raw.username ?? "").trim();
    const avatarValue = raw.avatarUrl ?? raw.avatar_url ?? null;
    const avatarUrl = typeof avatarValue === "string" && avatarValue.trim() ? avatarValue.trim() : null;
    if (!userId && !username && !avatarUrl) continue;
    out.push({
      userId: userId || username || `member-${out.length}`,
      username,
      avatarUrl
    });
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
    issn?: string | null;
    issue_number?: string | null;
    issue_volume?: string | null;
    issue_season?: string | null;
    issue_year?: number | null;
    cover_url: string | null;
    object_type?: "book" | "music" | "magazine" | null;
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
    raw_title?: string | null;
    title: string;
    isbn: string | null;
    issn: string | null;
    authors: string[];
    publisher: string | null;
    publish_date: string | null;
    description: string | null;
    category: string | null;
    tags: string[];
    notes: string | null;
    group_label: string | null;
    object_type: string | null;
    issue_number: string | null;
    issue_volume: string | null;
    issue_season: string | null;
    issue_year: number | null;
    parse_flagged?: boolean;
    copies: number;
  };
  type CsvImportKind = "book" | "magazine";
  type CsvImportJob = {
    id: string;
    library_id: number;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    total_rows: number;
    processed_rows: number;
    success_rows: number;
    failed_rows: number;
    last_error: string | null;
    apply_overrides: boolean;
  };
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<CsvImportRow[]>([]);
  const [csvBaseRows, setCsvBaseRows] = useState<CsvImportRow[]>([]);
  const [csvImportKind, setCsvImportKind] = useState<CsvImportKind>("book");
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const csvAutoOpenDoneRef = useRef(false);
  const [csvApplyOverrides, setCsvApplyOverrides] = useState(false);
  const [csvJob, setCsvJob] = useState<CsvImportJob | null>(null);
  const csvJobTickRef = useRef(false);
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
  const [reorderBackupItems, setReorderBackupItems] = useState<CatalogItem[] | null>(null);
  const itemsRef = useRef<CatalogItem[]>([]);
  // Refs that mirror state for use inside stable useCallback functions.
  const rearrangingLibraryIdRef = useRef<number | null>(null);
  const reorderBackupItemsRef = useRef<CatalogItem[] | null>(null);
  const displayGroupsByLibraryIdRef = useRef<Record<number, import("../../lib/types").CatalogGroup[]>>({});
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

  // Sticky band — scroll-driven docked/visible state lives in a shared hook so
  // the scroll listener only re-renders this component when truly necessary.
  // controlsPinnedOpen is inlined here (same computation as line ~744 below).
  const { controlsDocked, controlsVisible, controlsBandHeight, controlsBandRef, measureControlsBand } = useStickyBand({
    controlsPinnedOpen: sortOpen || bulkMode || searchOpen ||
      (addInputFocused || Boolean(addUrlPreview || addSearchResults.length > 0 || addSearchState.message || addState.message)),
    isMobile,
  });
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
    if (!stagedCsvData || !stagedCsvFilename) return;
    try {
      loadCsvText(stagedCsvData, stagedCsvFilename);
    } catch (err: any) {
      setCsvImportState({
        busy: false,
        error: err?.message ?? "CSV load failed",
        message: "CSV load failed",
        done: 0,
        total: 0
      });
    } finally {
      window.sessionStorage.removeItem("om_staged_csv_data");
      window.sessionStorage.removeItem("om_staged_csv_filename");
      setStagedCsvData(null);
      setStagedCsvFilename(null);
    }
  }, [stagedCsvData, stagedCsvFilename]);

  useEffect(() => {
    if (csvBaseRows.length === 0 || csvJob) return;
    setCsvRows(buildCsvRowsForKind(csvBaseRows, csvImportKind));
  }, [csvBaseRows, csvImportKind, csvJob]);

  useEffect(() => {
    let alive = true;
    if (!supabase || !userId) return;
    (async () => {
      try {
        const job = await fetchCsvImportJob("active=1");
        if (!alive || !job) return;
        setCsvJob(job);
        setCsvImportState({
          busy: job.status === "pending" || job.status === "running",
          error: job.status === "failed" ? (job.last_error ?? "Import failed") : null,
          message:
            job.status === "completed"
              ? `Imported ${job.success_rows} / ${job.total_rows}.`
              : `Importing… ${job.processed_rows}/${job.total_rows}`,
          done: job.processed_rows,
          total: job.total_rows
        });
        setAddLibraryId((prev) => prev ?? job.library_id);
      } catch {
        // ignore active job lookup failures
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase, userId]);

  useEffect(() => {
    if (!openAddPanel) return;
    setAddOpen(true);
  }, [openAddPanel]);

  useEffect(() => {
    if (!csvJob) return;
    if (csvJob.status !== "pending" && csvJob.status !== "running") return;
    if (!supabase || !userId) return;
    let cancelled = false;

    const tick = async () => {
      if (csvJobTickRef.current) return;
      csvJobTickRef.current = true;
      try {
        const headers = await withAuthHeaders();
        const processRes = await fetch("/api/csv-import/process", {
          method: "POST",
          headers,
          body: JSON.stringify({ job_id: csvJob.id })
        });
        const processJson = await processRes.json().catch(() => ({}));
        if (!processRes.ok) throw new Error(processJson?.error ?? "CSV import failed");
        const nextJob = (processJson?.job ?? null) as CsvImportJob | null;
        if (!cancelled && nextJob) {
          setCsvJob(nextJob);
          setCsvImportState({
            busy: nextJob.status === "pending" || nextJob.status === "running",
            error: nextJob.status === "failed" ? (nextJob.last_error ?? "Import failed") : null,
            message:
              nextJob.status === "completed"
                ? nextJob.failed_rows > 0
                  ? `Imported ${nextJob.success_rows} / ${nextJob.total_rows}. ${nextJob.failed_rows} skipped.`
                  : `Imported all ${nextJob.total_rows} rows.`
                : `Importing… ${nextJob.processed_rows}/${nextJob.total_rows}`,
            done: nextJob.processed_rows,
            total: nextJob.total_rows
          });
          if (nextJob.status === "completed") {
            void refreshAllBooks();
            setCsvFileName(null);
            setCsvRows([]);
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setCsvImportState((s) => ({ ...s, busy: false, error: e?.message ?? "Import failed", message: "Import failed" }));
          setCsvJob((prev) => (prev ? { ...prev, status: "failed", last_error: e?.message ?? "Import failed" } : prev));
        }
      } finally {
        csvJobTickRef.current = false;
        if (!cancelled) {
          const nextDelay = 800;
          window.setTimeout(() => {
            if (!cancelled) void tick();
          }, nextDelay);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [csvJob?.id, csvJob?.status, supabase, userId]);

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

  const searchParamsKey = searchParams.toString();
  const addMode = addInputFocused || Boolean(addUrlPreview || addSearchResults.length > 0 || addSearchState.message || addState.message);
  const controlsPinnedOpen = sortOpen || bulkMode || searchOpen || addMode;
  const controlsFixed = controlsDocked;

  // Re-measure the band height whenever its content can change size.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.requestAnimationFrame(measureControlsBand);
    return () => window.cancelAnimationFrame(id);
  }, [measureControlsBand, isMobile, bulkMode, sortOpen, searchOpen, searchParamsKey, libraries.length]);

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
        memberPreviews: normalizeMemberPreviews(l.memberPreviews)
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
    try {
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
    } catch (err) {
      console.error("homepage_cache_hydrate_failed", err);
      clearHomepageCache();
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

  const storeBookNavContext = useCallback(function storeBookNavContext(libraryId: number, orderedBookIds: number[]) {
    const bookIds = orderedBookIds.filter((id) => Number.isFinite(id) && id > 0);
    if (bookIds.length === 0) return;
    saveBookNavContext({
      bookIds,
      libraryId,
      source: "app-home",
      ts: Date.now()
    });
  }, []);

  async function applyBooksFromServer(serverRows: any[], source: string, requestSeq?: number) {
    const client = supabase;
    if (!client) return;
    if (typeof requestSeq === "number" && booksRequestSeqRef.current !== requestSeq) return;
    const normalizedRows = (serverRows ?? []).map((r: any) => ({
      ...r,
      authors_override: coerceStringArray(r?.authors_override),
      editors_override: coerceStringArray(r?.editors_override),
      subjects_override: coerceStringArray(r?.subjects_override),
      designers_override: coerceStringArray(r?.designers_override),
      media: Array.isArray(r?.media) ? r.media : [],
      book_tags: Array.isArray(r?.book_tags) ? r.book_tags : [],
      book_entities: Array.isArray(r?.book_entities) ? r.book_entities : [],
      edition: r?.edition
        ? {
            ...r.edition,
            authors: coerceStringArray(r.edition?.authors),
            subjects: coerceStringArray(r.edition?.subjects)
          }
        : null
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

  function persistAddLibrarySelection(libraryId: number | null) {
    const normalized = Number(libraryId ?? 0);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      setAddLibraryId(null);
      try {
        window.localStorage.removeItem("om_addLibraryId");
      } catch {
        // ignore
      }
      return;
    }
    setAddLibraryId(normalized);
    try {
      window.localStorage.setItem("om_addLibraryId", String(normalized));
    } catch {
      // ignore
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
        applyLibrarySelection(ownerList);
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
      persistAddLibrarySelection(null);
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
        persistAddLibrarySelection(id);
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
      const createdId = created.data.id as number;

      // Sync entity links from edition metadata (best-effort)
      try {
        const editionAuthors = (edition.authors ?? []).filter(Boolean);
        if (editionAuthors.length > 0) await supabase.rpc("set_book_entities", { p_user_book_id: createdId, p_role: "author", p_names: editionAuthors });
        const editionPublisher = (edition.publisher ?? "").trim();
        if (editionPublisher) await supabase.rpc("set_book_entities", { p_user_book_id: createdId, p_role: "publisher", p_names: [editionPublisher] });
      } catch { /* ignore */ }

      await refreshAllBooks();
      return createdId;
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
      const createdId = created.data.id as number;

      // Sync entity links (best-effort)
      try {
        if (authors.length > 0) await supabase.rpc("set_book_entities", { p_user_book_id: createdId, p_role: "author", p_names: authors });
        if (publisher) await supabase.rpc("set_book_entities", { p_user_book_id: createdId, p_role: "publisher", p_names: publisher.split(",").map((s) => s.trim()).filter(Boolean) });
      } catch { /* ignore */ }

      await refreshAllBooks();
      return createdId;
    } catch (e: any) {
      throw new Error(e?.message ?? "Failed to add book");
    }
  }

  function checkImageDimensions(url: string | null): Promise<boolean> {
    if (!url) return Promise.resolve(false);
    return Promise.race([
      new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const ok = img.naturalWidth >= 100 && img.naturalHeight >= 100;
          resolve(ok);
        };
        img.onerror = () => resolve(false);
        img.src = url;
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
    ]);
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
    const createdId = created.data.id as number;

    // Sync entity links from edition metadata (best-effort)
    try {
      const editionAuthors = (edition.authors ?? []).filter(Boolean);
      if (editionAuthors.length > 0) await supabase.rpc("set_book_entities", { p_user_book_id: createdId, p_role: "author", p_names: editionAuthors });
      const editionPublisher = (edition.publisher ?? "").trim();
      if (editionPublisher) await supabase.rpc("set_book_entities", { p_user_book_id: createdId, p_role: "publisher", p_names: [editionPublisher] });
    } catch { /* ignore */ }

    return createdId;
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

  function buildCsvRowsForKind(baseRows: CsvImportRow[], kind: CsvImportKind): CsvImportRow[] {
    if (kind !== "magazine") {
      return baseRows.map((row) => ({
        ...row,
        title: row.raw_title ?? row.title,
        object_type: "book",
        issue_number: null,
        issue_volume: null,
        issue_season: null,
        issue_year: null,
        parse_flagged: false
      }));
    }
    return baseRows.map((row) => {
      const parsed = parseMagazineTitle(row.raw_title ?? row.title);
      return {
        ...row,
        title: parsed.publicationName || row.raw_title || row.title,
        object_type: "magazine",
        issn: row.issn ? normalizeIssn(row.issn) : null,
        issue_number: row.issue_number ?? parsed.issueNumber,
        issue_volume: row.issue_volume ?? parsed.issueVolume,
        issue_season: row.issue_season ?? parsed.issueSeason,
        issue_year: row.issue_year ?? parsed.issueYear,
        parse_flagged: parsed.flagged
      };
    });
  }

  function loadCsvText(text: string, filename: string) {
    const objects = parseCsvToObjects(text);
    const normalizedBase: CsvImportRow[] = objects
      .map((o) => {
        const title = (o.title ?? o.Title ?? "").trim();
        const isbn13 = (o.ean_isbn13 ?? o.isbn13 ?? o.ISBN13 ?? "").trim();
        const isbn10 = (o.upc_isbn10 ?? o.isbn10 ?? o.ISBN10 ?? "").trim();
        const isbn = isbn13 || isbn10 || "";
        const issn = (o.issn ?? o.ISSN ?? "").trim();
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
        const issue_number = (o.issue_number ?? o.issue ?? o["issue number"] ?? "").trim() || null;
        const issue_volume = (o.issue_volume ?? o.volume ?? o["issue volume"] ?? "").trim() || null;
        const issue_season = (o.issue_season ?? o.season ?? o["issue season"] ?? "").trim() || null;
        const issue_year = normalizeIssueYear(o.issue_year ?? o.year ?? o["issue year"] ?? null);
        const copiesRaw = (o.copies ?? "").trim();
        const copiesNum = copiesRaw ? Number(copiesRaw) : 1;
        const copies = Number.isFinite(copiesNum) && copiesNum > 1 ? Math.floor(copiesNum) : 1;
        return {
          raw_title: title,
          title,
          isbn: isbn ? isbn : null,
          issn: issn ? normalizeIssn(issn) : null,
          authors,
          publisher,
          publish_date,
          description,
          category,
          tags,
          notes,
          group_label,
          object_type,
          issue_number,
          issue_volume,
          issue_season,
          issue_year,
          copies
        } as CsvImportRow;
      })
      .filter((r) => Boolean(r.title || r.isbn));

    const normalized = buildCsvRowsForKind(normalizedBase, "book");
    setCsvFileName(filename);
    setCsvImportKind("book");
    setCsvBaseRows(normalizedBase);
    setCsvRows(normalized);
    setAddOpen(true);
    if (normalized.length === 0) {
      setCsvImportState({
        busy: false,
        error: "No importable rows found",
        message: null,
        done: 0,
        total: 0
      });
      return;
    }
    setCsvImportState({ busy: false, error: null, message: `Loaded ${normalized.length} row(s)`, done: 0, total: normalized.length });
    window.setTimeout(() => setCsvImportState((s) => ({ ...s, message: null })), 1500);
  }

  async function loadCsvFile(file: File) {
    const text = await file.text();
    loadCsvText(text, file.name);
  }

  async function withAuthHeaders(): Promise<HeadersInit> {
    if (!supabase) throw new Error("Supabase is not configured");
    const sessionRes = await supabase.auth.getSession();
    const token = sessionRes.data.session?.access_token ?? null;
    if (!token) throw new Error("Not signed in");
    return {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    };
  }

  async function fetchCsvImportJob(query: string): Promise<CsvImportJob | null> {
    const headers = await withAuthHeaders();
    const res = await fetch(`/api/csv-import?${query}`, { headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? "CSV import status failed");
    return (json?.job ?? null) as CsvImportJob | null;
  }

  function clearCsvImport() {
    setCsvFileName(null);
    setCsvBaseRows([]);
    setCsvRows([]);
    setCsvImportKind("book");
    setCsvJob(null);
    setCsvImportState({ busy: false, error: null, message: null, done: 0, total: 0 });
  }

  async function importCsvRows() {
    if (!supabase) return;
    if (csvRows.length === 0) return;
    if (!addLibraryId) {
      setCsvImportState({ busy: false, error: "Choose a catalog first", message: "Choose a catalog first", done: 0, total: csvRows.length });
      return;
    }
    try {
      const headers = await withAuthHeaders();
      setCsvImportState({ busy: true, error: null, message: "Queueing import…", done: 0, total: csvRows.length });
      const res = await fetch("/api/csv-import", {
        method: "POST",
        headers,
        body: JSON.stringify({
          library_id: addLibraryId,
          apply_overrides: csvApplyOverrides,
          rows: csvRows
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok || !json?.job) throw new Error(json?.error ?? "Import failed");
      const job = json.job as CsvImportJob;
      setCsvJob(job);
      setCsvImportState({
        busy: true,
        error: null,
        message: `Importing… ${job.processed_rows}/${job.total_rows}`,
        done: job.processed_rows,
        total: job.total_rows
      });
      setCsvRows([]);
      setCsvFileName(null);
    } catch (e: any) {
      setCsvImportState({ busy: false, error: e?.message ?? "Import failed", message: "Import failed", done: 0, total: csvRows.length });
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
      window.scrollTo({ top: 0, behavior: "smooth" });
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
        issn: typeof edition.issn === "string" ? edition.issn : null,
        issue_number: typeof edition.issue_number === "string" ? edition.issue_number : null,
        issue_volume: typeof edition.issue_volume === "string" ? edition.issue_volume : null,
        issue_season: typeof edition.issue_season === "string" ? edition.issue_season : null,
        issue_year: typeof edition.issue_year === "number" ? edition.issue_year : normalizeIssueYear(edition.issue_year),
        cover_url: finalCoverUrl,
        object_type: edition.object_type === "magazine" ? "magazine" : "book",
        sources: Array.from(new Set(["isbn", ...((edition.sources ?? []) as any[]).map((s: any) => String(s))])).filter(Boolean)
      });
      setAddState({ busy: false, error: null, message: null });
      window.scrollTo({ top: 0, behavior: "smooth" });
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
      window.scrollTo({ top: 0, behavior: "smooth" });
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

    if (looksLikeIsbn(value) || looksLikeIssn(value)) {
      const ok = await previewIsbn(value);
      if (ok) return;
      if (looksLikeBarcode(value)) {
        await searchAddResults("", null, value);
      }
      return;
    }

    if (looksLikeLccn(value) || looksLikeOclc(value)) {
      await previewIsbn(value);
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

  function cancelAddMode() {
    cancelAddPreview();
    setAddInput("");
    setAddInputFocused(false);
    setAddOpen(false);
    if (csvRows.length > 0 || csvJob) {
      clearCsvImport();
    }
    (document.activeElement as HTMLElement)?.blur();
  }

  async function handleAddManually() {
    try {
      if (!supabase) throw new Error("Supabase is not configured");
      if (!addLibraryId) throw new Error("Choose a catalog first");
      const created = await supabase
        .from("user_books")
        .insert({
          owner_id: userId,
          library_id: addLibraryId,
          edition_id: null
        })
        .select("id")
        .single();
      if (created.error) throw new Error(created.error.message);
      const id = created.data.id as number;
      cancelAddMode();
      router.push(`/app/books/${id}?edit=1`);
    } catch (e: any) {
      setAddState({ busy: false, error: e?.message ?? "Failed to add", message: null });
    }
  }

  async function addEditionData(data: {
    isbn10?: string | null;
    isbn13?: string | null;
    issn?: string | null;
    title?: string | null;
    authors?: string[];
    publisher?: string | null;
    publish_date?: string | null;
    description?: string | null;
    subjects?: string[];
    cover_url?: string | null;
    object_type?: "book" | "music" | "magazine" | null;
    source_type?: string | null;
    source_url?: string | null;
    external_source_ids?: Record<string, string | null> | null;
    music_metadata?: MusicMetadata | null;
    contributor_entities?: Partial<Record<MusicContributorRole, string[]>> | null;
    issue_number?: string | null;
    issue_volume?: string | null;
    issue_season?: string | null;
    issue_year?: number | null;
  }, targetLibraryId?: number | null): Promise<number> {
    if (!supabase) throw new Error("Supabase is not configured");
    const selectedLibraryId = Number(targetLibraryId ?? addLibraryId ?? 0);
    if (!selectedLibraryId) throw new Error("Choose a catalog first");
    persistAddLibrarySelection(selectedLibraryId);
    const rawObjectType = String(data.object_type ?? "book").trim().toLowerCase();
    const objectType = rawObjectType === "music" ? "music" : rawObjectType === "magazine" ? "magazine" : "book";
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
    if (objectType === "magazine") {
      const issueYear =
        typeof data.issue_year === "number"
          ? data.issue_year
          : normalizeIssueYear(data.publish_date?.slice(0, 4) ?? null);
      const insertPayload: Record<string, unknown> = {
        owner_id: userId,
        library_id: selectedLibraryId,
        edition_id: null,
        object_type: "magazine",
        title_override: data.title ?? null,
        description_override: data.description ?? null,
        publisher_override: data.publisher ?? null,
        publish_date_override: data.publish_date ?? null,
        subjects_override: (data.subjects ?? []).length > 0 ? data.subjects : [],
        issue_number: data.issue_number ?? null,
        issue_volume: data.issue_volume ?? null,
        issue_season: data.issue_season ?? null,
        issue_year: issueYear,
        issn: data.issn ? normalizeIssn(data.issn) : null,
        source_type: data.source_type ?? null,
        source_url: data.source_url ?? null,
        external_source_ids: data.external_source_ids ?? null,
        decade: issueYear ? `${String(issueYear).slice(0, 3)}0s` : null
      };
      const created = await supabase.from("user_books").insert(insertPayload).select("id").single();
      if (created.error) throw new Error(created.error.message);
      const createdId = created.data.id as number;
      if (data.publisher) {
        await supabase.rpc("set_book_entities", {
          p_user_book_id: createdId,
          p_role: "publisher",
          p_names: [data.publisher]
        });
      }
      const coverUrl = (data.cover_url ?? "").trim();
      if (coverUrl) {
        try {
          await importCoverForBook(createdId, coverUrl);
        } catch {
          // ignore cover import failures for magazine objects
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

  async function bulkChangeObjectType(objectType: string | null) {
    if (!supabase) return;
    if (!bulkSelectedGroups.length) return;
    setBulkState({ busy: true, error: null, message: "Applying…" });
    try {
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));
      const { error } = await supabase.from("user_books").update({ object_type: objectType }).in("id", ids);
      if (error) throw new Error(error.message);
      await refreshAllBooks();
      setBulkState({ busy: false, error: null, message: "Applied" });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Apply failed", message: "Apply failed" });
    }
  }

  const deleteEntry = useCallback(async function deleteEntry(userBookId: number) {
    if (!supabase) return;
    if (!window.confirm("Delete this entry?")) return;
    setDeleteStateByBookId((prev) => ({ ...prev, [userBookId]: { busy: true, error: null, message: "Deleting…" } }));
    try {
      const it = itemsRef.current.find((x) => x.id === userBookId) ?? null;
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
  // refreshAllBooks is a plain function recreated each render; calling it via
  // closure is intentional — the latest version is always used at call time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleBulkKey = useCallback(function toggleBulkKey(key: string) {
    setBulkSelectedKeys((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  }, []);

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
    try {
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
        try {
          const libraryId = Number((it as any)?.library_id);
          if (!Number.isFinite(libraryId) || libraryId <= 0) continue;
          const key = `${libraryId}:${groupKeyFor(it)}`;
          const cur = byKey.get(key);
          if (!cur) byKey.set(key, [it]);
          else cur.push(it);
        } catch {
          continue;
        }
      }

      let groups: CatalogGroup[] = Array.from(byKey.entries()).flatMap(([key, copies]) => {
        try {
          const sorted = copies.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
          const primary = sorted.slice().sort((a, b) => {
            const score = (c: CatalogItem): number => {
              let s = 0;
              if ((c.media ?? []).some((m) => m.kind === "cover")) s += 1000;
              if (c.edition?.cover_url) s += 150;
              return s;
            };
            return score(b) - score(a);
          })[0];
          if (!primary) return [];
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
            for (const row of c.book_entities ?? []) {
              const role = String(row?.role ?? "").trim().toLowerCase();
              if (role !== "designer" && role !== "design") continue;
              const name = String(row?.entity?.name ?? "").trim();
              if (name) designersSet.add(name);
            }
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

          return [{
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
          }];
        } catch {
          return [];
        }
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
      const cmp = titleSortKeyFor(a.primary).localeCompare(titleSortKeyFor(b.primary), undefined, {
        numeric: true,
        sensitivity: "base"
      });
      return sortMode === "title_asc" ? cmp : -cmp;
    });

      return groups;
    } catch (err) {
      console.error("displayGroups_failed", err);
      return [];
    }
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

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    rearrangingLibraryIdRef.current = rearrangingLibraryId;
  }, [rearrangingLibraryId]);

  useEffect(() => {
    reorderBackupItemsRef.current = reorderBackupItems;
  }, [reorderBackupItems]);

  useEffect(() => {
    displayGroupsByLibraryIdRef.current = displayGroupsByLibraryId;
  }, [displayGroupsByLibraryId]);

  const beginItemReorder = useCallback(function beginItemReorder(_activeKey: string, _libraryId: number) {
    setReorderBackupItems((prev) => prev ?? [...itemsRef.current]);
  }, []);

  const selectAllInLibrary = useCallback(function selectAllInLibrary(libraryId: number) {
    const groups = displayGroupsByLibraryIdRef.current[libraryId] ?? [];
    setBulkSelectedKeys((prev) => {
      const next = { ...prev };
      for (const g of groups) next[g.key] = true;
      return next;
    });
  }, []);

  const previewItemReorder = useCallback(function previewItemReorder(activeKey: string, overKey: string, libraryId: number) {
    if (activeKey === overKey) return;
    const groups = displayGroupsByLibraryIdRef.current[libraryId] ?? [];
    const fromIndex = groups.findIndex((group) => group.key === activeKey);
    const toIndex = groups.findIndex((group) => group.key === overKey);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    const reordered = arrayMove(groups, fromIndex, toIndex);
    const nextSortByItemId = new Map<number, number>();
    reordered.forEach((group, index) => {
      const nextSortOrder = (index + 1) * 1000;
      group.copies.forEach((copy) => nextSortByItemId.set(copy.id, nextSortOrder));
    });

    setItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        const nextSort = nextSortByItemId.get(item.id);
        if (nextSort == null || item.sort_order === nextSort) return item;
        changed = true;
        return { ...item, sort_order: nextSort };
      });
      return changed ? next : prev;
    });
  }, []);

  const commitItemReorder = useCallback(async function commitItemReorder(libraryId: number) {
    const snapshot = reorderBackupItemsRef.current;
    setReorderBackupItems(null);
    if (!supabase) return;
    const db = supabase;

    const previousSortOrderById = new Map<number, number | null>(
      (snapshot ?? [])
        .filter((item) => item.library_id === libraryId)
        .map((item) => [item.id, item.sort_order ?? null])
    );

    const rows = itemsRef.current
      .filter((item) => item.library_id === libraryId)
      .map((item) => ({ id: item.id, sort_order: item.sort_order ?? null }))
      .filter((row) => previousSortOrderById.get(row.id) !== row.sort_order);

    if (rows.length === 0) return;

    try {
      const results = await Promise.all(
        rows.map((row) => db.from("user_books").update({ sort_order: row.sort_order }).eq("id", row.id))
      );
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
    } catch (err: any) {
      console.error("Failed to persist new order", err);
      if (snapshot) {
        setItems(snapshot);
        itemsRef.current = snapshot;
      }
      window.alert("Failed to save new order. Reverting.");
    }
  }, []);

  const cancelItemReorder = useCallback(function cancelItemReorder(libraryId: number) {
    const snapshot = reorderBackupItemsRef.current;
    setReorderBackupItems(null);
    if (!snapshot) return;
    setItems(snapshot);
    itemsRef.current = snapshot;
  }, []);

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
    const values: string[] = [];
    for (const g of displayGroups) {
      for (const name of g.categoryNames ?? []) {
        const normalized = String(name ?? "").trim();
        if (normalized) values.push(normalized);
      }
    }
    return uniqCaseInsensitive(values).sort((a, b) => a.localeCompare(b));
  }, [displayGroups]);

  const availableTags = useMemo(() => {
    const values: string[] = [];
    for (const g of displayGroups) {
      for (const name of g.tagNames ?? []) {
        const normalized = String(name ?? "").trim();
        if (normalized) values.push(normalized);
      }
    }
    return uniqCaseInsensitive(values).sort((a, b) => a.localeCompare(b));
  }, [displayGroups]);
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
                if (filterAuthor) pairs.push({ label: "Author", value: filterAuthor, key: "author", entityHref: entityHrefForName(filterAuthor), onClear: () => clearFilter("author") });
                if (filterEditor) pairs.push({ label: "Editor", value: filterEditor, key: "editor", onClear: () => clearFilter("editor") });
                if (filterDesigner) pairs.push({ label: "Designer", value: filterDesigner, key: "designer", onClear: () => clearFilter("designer") });
                if (filterSubject) pairs.push({ label: "Subject", value: filterSubject, key: "subject", onClear: () => clearFilter("subject") });
                if (filterPublisher) pairs.push({ label: "Publisher", value: filterPublisher, key: "publisher", onClear: () => clearFilter("publisher") });
                if (filterMaterial) pairs.push({ label: "Material", value: filterMaterial, key: "material", onClear: () => clearFilter("material") });
                if (filterPrinter) pairs.push({ label: "Printer", value: filterPrinter, key: "printer", onClear: () => clearFilter("printer") });
                if (filterPerformer) pairs.push({ label: "Performer", value: filterPerformer, key: "performer", entityHref: entityHrefForName(filterPerformer), onClear: () => clearFilter("performer") });
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
      </div>

        {controlsFixed ? <div aria-hidden style={{ height: controlsBandHeight }} /> : null}
        <div
          ref={controlsBandRef}
          className="om-smart-sticky-band"
          data-docked={controlsDocked ? "true" : "false"}
          data-visible={!controlsDocked || controlsVisible ? "true" : "false"}
          data-fixed={controlsFixed ? "true" : "false"}
        >
        {isMobile ? (
          <>
            <div className="row" style={{ width: "100%", margin: 0, gap: "var(--space-10)", alignItems: "baseline", flexWrap: "nowrap", marginBottom: "var(--space-md)" }}>
              {showScan && (
                <div className="row" style={{ gap: "var(--space-sm)", flex: "0 0 auto", alignItems: "baseline" }}>
                  <button className="text-muted" onClick={openScanner} style={{ whiteSpace: "nowrap", padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", textDecoration: "underline" }}>Scan</button>
                  <span className="text-muted" style={{ fontSize: "0.9em" }}>or</span>
                </div>
              )}
              {isMobile && addInput && (
                <button
                  type="button"
                  onClick={() => setAddInput("")}
                  style={{ padding: "0 4px", fontSize: "1.2em", border: 0, background: "none", cursor: "pointer", color: "var(--text-muted)", flex: "0 0 auto" }}
                  title="Clear"
                >
                  ×
                </button>
              )}
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <RotatingHintInput
                  value={addInput}
                  onFocus={() => { if (bulkMode) exitEditMode(); setSortOpen(false); setAddInputFocused(true); if (controlsDocked) window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  onBlur={() => setTimeout(() => setAddInputFocused(false), 150)}
                  onChange={(e) => setAddInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); smartAddOrSearch(); } else if (e.key === "Escape") { cancelAddMode(); } }}
                  style={{ width: "100%" }}
                  isMobile={isMobile}
                />
              </div>
              {addMode && (
                <div className="row" style={{ gap: "var(--space-10)", flex: "0 0 auto", alignItems: "center" }}>
                  {(addInput.trim() || addInputFocused) && (
                    <button onClick={() => smartAddOrSearch()} disabled={addState.busy || !addInput.trim()}>
                      {addState.busy ? "…" : "Go"}
                    </button>
                  )}
                  <button type="button" className="text-muted" onClick={handleAddManually} disabled={addState.busy} style={{ padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>Add manually</button>
                  <button type="button" className="text-muted" onClick={cancelAddMode} disabled={addState.busy} style={{ padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>Cancel</button>
                </div>
              )}
            </div>
            {!addMode && <div className="row" style={{ width: "100%", margin: 0, gap: "var(--space-md)", alignItems: "baseline", flexWrap: "nowrap" }}>
              <button onClick={() => { const next = !bulkMode; if (next) { setAddOpen(false); setSortOpen(false); setSearchOpen(false); setReorderMode(true); } else { exitEditMode(); } setBulkMode(next); }}>
                {bulkMode ? "Done" : "Edit"}
              </button>
              <button type="button" className={sortOpen ? "text-primary" : "text-muted"} onClick={() => { if (bulkMode) exitEditMode(); const next = !sortOpen; setSortOpen(next); if (next) { setSearchOpen(false); } }}>
                View by
              </button>
              {isMobile && searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  style={{ padding: "0 4px", fontSize: "1.2em", border: 0, background: "none", cursor: "pointer", color: "var(--text-muted)", flex: "0 0 auto" }}
                  title="Clear"
                >
                  ×
                </button>
              )}
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
            </div>}
            {sortOpen && (
              <div className="om-filter-row" style={{ marginTop: "var(--space-10)", marginBottom: 4, gap: "var(--space-10)", alignItems: "center", paddingBottom: "var(--space-8)" }}>
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
                </select>
                {(availableCategories.length > 0 || !!(filterCategory ?? "").trim()) && (
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
          </>
        ) : (
          <div className="om-sticky-controls">
            <div className="row" style={{ width: "100%", margin: 0, alignItems: "baseline", justifyContent: "space-between", flexWrap: "nowrap" }}>
              <div className="row" style={{ flex: "1 1 auto", gap: "var(--space-md)", alignItems: "baseline", minWidth: 0, flexWrap: "nowrap", margin: 0 }}>
                {showScan && (
                  <div className="row" style={{ gap: "var(--space-sm)", flex: "0 0 auto", alignItems: "baseline" }}>
                    <button className="text-muted" onClick={openScanner} style={{ whiteSpace: "nowrap", padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", textDecoration: "underline" }}>Scan</button>
                    <span className="text-muted" style={{ fontSize: "0.9em" }}>or</span>
                  </div>
                )}
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <RotatingHintInput
                    value={addInput}
                    onFocus={() => { if (bulkMode) exitEditMode(); setSortOpen(false); setAddInputFocused(true); if (controlsDocked) window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    onBlur={() => setTimeout(() => setAddInputFocused(false), 150)}
                    onChange={(e) => setAddInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); smartAddOrSearch(); } else if (e.key === "Escape") { cancelAddMode(); } }}
                    style={{ width: "100%" }}
                  />
                </div>
                <div className="row" style={{ gap: "var(--space-10)", flex: "0 0 auto" }}>
                  {addMode && (addInput.trim() || addInputFocused) && (
                    <button onClick={() => smartAddOrSearch()} disabled={addState.busy || !addInput.trim()}>
                      {addState.busy ? "…" : "Go"}
                    </button>
                  )}
                  {addMode && (
                    <button type="button" className="text-muted" onClick={handleAddManually} disabled={addState.busy} style={{ padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>Add manually</button>
                  )}
                  {addMode && (
                    <button type="button" className="text-muted" onClick={cancelAddMode} disabled={addState.busy} style={{ padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>Cancel</button>
                  )}
                </div>
                {!addMode && <button onClick={() => { const next = !bulkMode; if (next) { setAddOpen(false); setSortOpen(false); setSearchOpen(false); setReorderMode(true); } else { exitEditMode(); } setBulkMode(next); }}>
                  {bulkMode ? "Done" : "Edit"}
                </button>}
                {!addMode && <button type="button" className={sortOpen ? "text-primary" : "text-muted"} onClick={() => { if (bulkMode) exitEditMode(); const next = !sortOpen; setSortOpen(next); if (next) { setSearchOpen(false); } }}>
                  View by
                </button>}
              </div>
              {!addMode && <button type="button" className={searchOpen ? "text-primary" : "text-muted"} onClick={() => { if (bulkMode) exitEditMode(); const next = !searchOpen; setSearchOpen(next); if (next) { setSortOpen(false); } }}>
                Search
              </button>}
            </div>

            {!isMobile && !addMode && searchOpen && (
              <div className="row" style={{ width: "100%", marginTop: "var(--space-sm)", alignItems: "baseline", gap: "var(--space-md)", flexWrap: "nowrap", position: "relative", zIndex: 9, paddingBottom: "var(--space-xs)" }}>
                <input
                  className="om-inline-search-input"
                  placeholder="Search your catalog"
                  value={searchQuery}
                  onFocus={() => { if (bulkMode) exitEditMode(); setSortOpen(false); cancelAddPreview(); setSearchFocused(true); }}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ minWidth: 0, flex: 1, maxWidth: "100%", position: "relative", zIndex: 9, pointerEvents: "auto" }}
                />
                {(searchFocused || searchQuery.trim()) && (
                  <Link href={`/app/discover${searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ""}`} className="text-muted" style={{ whiteSpace: "nowrap", flex: "0 0 auto" }}>Search others</Link>
                )}
              </div>
            )}

            {sortOpen && (
              <div className="om-filter-row" style={{ marginTop: "var(--space-10)", marginBottom: 4, gap: "var(--space-10)", alignItems: "center", paddingBottom: "var(--space-8)" }}>
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
                </select>
                {(availableCategories.length > 0 || !!(filterCategory ?? "").trim()) && (
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
            onBulkChangeObjectType={bulkChangeObjectType}
            onAnyMenuOpen={() => { closeTagMenu(); closeCategoryMenu(); }}
          />
        </div>

      <div style={{ height: "var(--space-md)" }} />

      {(addState.message || addSearchState.message) && (
        <div className="text-muted" style={{ marginBottom: "var(--space-sm)" }}>
          {addState.message || addSearchState.message}
        </div>
      )}
      {(csvRows.length > 0 || csvJob) && (
        <div className="om-lookup-item" style={{ marginBottom: "var(--space-sm)" }}>
          <div className="om-lookup-row" style={{ alignItems: "baseline" }}>
            <div className="om-lookup-main">
              <div>{csvFileName ?? "CSV import"}</div>
              <div className="text-muted" style={{ marginTop: 4 }}>
                {csvJob
                  ? `${csvJob.processed_rows}/${csvJob.total_rows} row${csvJob.total_rows === 1 ? "" : "s"} processed`
                  : `${csvRows.length} row${csvRows.length === 1 ? "" : "s"} ready`}
              </div>
              {csvImportState.message ? (
                <div className="text-muted" style={{ marginTop: 4 }}>
                  {csvImportState.message}
                </div>
              ) : null}
              {csvImportState.error ? (
                <div className="text-muted" style={{ marginTop: 4 }}>
                  {csvImportState.error}
                </div>
              ) : null}
              {!csvJob ? (
                <div style={{ marginTop: "var(--space-sm)" }}>
                  <div className="text-muted" style={{ marginBottom: 4 }}>What are you importing?</div>
                  <div className="row no-wrap" style={{ gap: "var(--space-sm)", alignItems: "baseline" }}>
                    <button
                      type="button"
                      onClick={() => setCsvImportKind("book")}
                      disabled={csvImportState.busy}
                      className={csvImportKind === "book" ? "" : "text-muted"}
                    >
                      Books
                    </button>
                    <button
                      type="button"
                      onClick={() => setCsvImportKind("magazine")}
                      disabled={csvImportState.busy}
                      className={csvImportKind === "magazine" ? "" : "text-muted"}
                    >
                      Periodicals
                    </button>
                  </div>
                </div>
              ) : null}
              {!csvJob && csvImportKind === "magazine" && csvRows.length > 0 ? (
                <div style={{ marginTop: "var(--space-md)", maxHeight: 280, overflow: "auto", paddingRight: "var(--space-xs)" }}>
                  <div className="text-muted" style={{ marginBottom: "var(--space-sm)" }}>
                    Review parsed publication name and issue info before import.
                  </div>
                  <div style={{ display: "grid", gap: "var(--space-sm)" }}>
                    {csvRows.map((row, index) => (
                      <div
                        key={`${row.raw_title ?? row.title}-${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
                          gap: "var(--space-sm)",
                          paddingTop: "var(--space-sm)",
                          borderTop: index === 0 ? "none" : "1px solid var(--border-color)"
                        }}
                      >
                        <div>
                          <input
                            className="om-inline-control"
                            value={row.title}
                            onChange={(e) =>
                              setCsvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: e.target.value, parse_flagged: false } : item))
                            }
                            placeholder="Publication name"
                          />
                          {row.parse_flagged ? (
                            <div className="text-muted" style={{ marginTop: 4 }}>
                              Review title split
                            </div>
                          ) : null}
                        </div>
                        <div className="row" style={{ gap: "var(--space-sm)", flexWrap: "wrap" }}>
                          <input
                            className="om-inline-control"
                            value={row.issue_volume ?? ""}
                            onChange={(e) =>
                              setCsvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, issue_volume: e.target.value || null } : item))
                            }
                            placeholder="Vol."
                            style={{ width: 72 }}
                          />
                          <input
                            className="om-inline-control"
                            value={row.issue_number ?? ""}
                            onChange={(e) =>
                              setCsvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, issue_number: e.target.value || null } : item))
                            }
                            placeholder="Issue"
                            style={{ width: 84 }}
                          />
                          <input
                            className="om-inline-control"
                            value={row.issue_season ?? ""}
                            onChange={(e) =>
                              setCsvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, issue_season: e.target.value || null } : item))
                            }
                            placeholder="Season"
                            style={{ width: 96 }}
                          />
                          <input
                            className="om-inline-control"
                            value={row.issue_year != null ? String(row.issue_year) : ""}
                            onChange={(e) =>
                              setCsvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, issue_year: normalizeIssueYear(e.target.value) } : item))
                            }
                            placeholder="Year"
                            style={{ width: 84 }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="om-lookup-actions">
              <div className="row no-wrap" style={{ gap: "var(--space-sm)", alignItems: "baseline" }}>
                {!csvJob && renderLibraries.length > 1 ? (
                  <>
                    <span className="text-muted">Add to</span>
                    <select
                      value={String(addLibraryId ?? renderLibraries[0]?.id ?? "")}
                      onChange={(e) => {
                        const nextId = Number(e.target.value);
                        setAddLibraryId(nextId);
                        persistAddLibrarySelection(nextId);
                      }}
                      disabled={csvImportState.busy}
                    >
                      {renderLibraries.map((l) => (
                        <option key={l.id} value={String(l.id)}>{l.name}</option>
                      ))}
                    </select>
                  </>
                ) : null}
                {!csvJob ? (
                  <>
                    <label className="row no-wrap text-muted" style={{ gap: "var(--space-xs)", alignItems: "baseline", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={csvApplyOverrides}
                        onChange={(e) => setCsvApplyOverrides(e.target.checked)}
                        disabled={csvImportState.busy}
                      />
                      Override
                    </label>
                    <button onClick={() => void importCsvRows()} disabled={csvImportState.busy}>
                      {csvImportState.busy ? "…" : "Import"}
                    </button>
                    <button className="text-muted" onClick={clearCsvImport} disabled={csvImportState.busy}>
                      Cancel
                    </button>
                  </>
                ) : csvJob.status === "completed" || csvJob.status === "failed" ? (
                  <button className="text-muted" onClick={clearCsvImport}>
                    Dismiss
                  </button>
                ) : (
                  <span className="text-muted">Importing…</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {addUrlPreview && (
        <div className="om-lookup-item" style={{ marginBottom: "var(--space-sm)" }}>
          <div className="om-lookup-row">
            <div style={{ width: 62, flex: "0 0 auto" }}>
              {addUrlPreview.cover_url && !addPreviewCoverFailed ? (
                <div className="om-cover-slot om-cover-slot-has-image" style={{ width: 60, height: "auto" }}>
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
                {addUrlPreview.object_type === "magazine"
                  ? formatIssueDisplay(addUrlPreview) || "—"
                  : (addUrlPreview.authors ?? []).filter(Boolean).join(", ") || "—"}
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
                    onChange={(e) => {
                      const nextId = Number(e.target.value);
                      setAddPreviewLibraryId(nextId);
                      persistAddLibrarySelection(nextId);
                    }}
                    disabled={addState.busy}
                  >
                    {renderLibraries.map((l) => (
                      <option key={l.id} value={String(l.id)}>{l.name}</option>
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
        <div style={{ marginBottom: "var(--space-sm)" }}>
          {addSearchResults.slice(0, addSearchLimit).map((result, i) => (
            <div key={i} className="om-lookup-item">
              <div className="om-lookup-row">
                <div style={{ width: 62, flex: "0 0 auto" }}>
                  {result.cover_url ? (
                    <div className="om-cover-slot om-cover-slot-has-image" style={{ width: 60, height: "auto" }}>
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
                        onChange={(e) => {
                          const nextId = Number(e.target.value);
                          setAddSearchLibraryIds((prev) => ({ ...prev, [i]: nextId }));
                          persistAddLibrarySelection(nextId);
                        }}
                        disabled={addState.busy}
                      >
                        {renderLibraries.map((l) => (
                          <option key={l.id} value={String(l.id)}>{l.name}</option>
                        ))}
                      </select>
                      <button onClick={() => addFromSearchResultItem(result, addSearchLibraryIds[i])} disabled={addState.busy}>
                        {addState.busy ? "…" : "Add"}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => addFromSearchResultItem(result)} disabled={addState.busy}>
                      {addState.busy ? "…" : "Add to catalog"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {(addSearchResults.length > addSearchLimit || addSearchLimit > addSearchPageSize) && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "var(--space-14)" }}>
              {addSearchResults.length > addSearchLimit && (
                <button onClick={() => setAddSearchLimit((prev) => prev + addSearchPageSize)} className="text-muted">
                  Show more
                </button>
              )}
              {addSearchLimit > addSearchPageSize && (
                <button onClick={() => setAddSearchLimit(addSearchPageSize)} className="text-muted">
                  Show less
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
        const showEditMembersAction = bulkMode && iAmOwner;
        const showMembersEditor = bulkMode && iAmOwner && membersEditorCatalogId === lib.id;
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
            <LibraryBlock
              libraryId={lib.id}
              libraryName={lib.name}
              memberPreviews={lib.memberPreviews ?? []}
              showEditMembers={showEditMembersAction}
              membersEditorOpen={membersEditorCatalogId === lib.id}
              onToggleMembersEditor={(catalogId) => {
                setMembersEditorCatalogId((prev) => (prev === catalogId ? null : catalogId));
                void loadCatalogMembers(catalogId);
              }}
              membersPanel={membersPanel}
              bookCount={groups.length}
              index={idx}
              total={displayLibraries.length}
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
              onSelectAll={selectAllInLibrary}
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
                <CatalogRenderBoundary libraryName={lib.name}>
                  <SortableCatalogGrid
                    libraryId={lib.id}
                    groups={groups}
                    limit={limit}
                    effectiveViewMode={effectiveViewMode}
                    effectiveCols={effectiveCols}
                    showBookSkeleton={showBookSkeleton}
                    isRearranging={bulkMode}
                    bulkMode={bulkMode}
                    viewMode={viewMode}
                    bulkSelectedKeys={bulkSelectedKeys}
                    deleteStateByBookId={deleteStateByBookId}
                    onToggleSelected={toggleBulkKey}
                    onDeleteCopy={deleteEntry}
                    onStoreBookNavContext={storeBookNavContext}
                    onReorderStart={beginItemReorder}
                    onReorderPreview={previewItemReorder}
                    onReorderCommit={commitItemReorder}
                    onReorderCancel={cancelItemReorder}
                  />
                </CatalogRenderBoundary>
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
