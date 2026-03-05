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
import { useBookScanner } from "../../hooks/useBookScanner";
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
    sources: string[];
  } | null>(null);
  const [addPreviewCoverFailed, setAddPreviewCoverFailed] = useState(false);
  const [addUrlMeta, setAddUrlMeta] = useState<{ final_url: string | null; domain: string | null; domain_kind: string | null }>({
    final_url: null,
    domain: null,
    domain_kind: null
  });
  const [addSearchResults, setAddSearchResults] = useState<
    Array<{
      source: "openlibrary" | "googleBooks";
      title: string | null;
      authors: string[];
      publisher: string | null;
      publish_date: string | null;
      publish_year: number | null;
      subjects: string[];
      isbn10: string | null;
      isbn13: string | null;
      cover_url: string | null;
    }>
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
  const [sortMode, setSortMode] = useState<"latest" | "earliest" | "title_asc" | "title_desc">("latest");
  const [categoryMode, setCategoryMode] = useState<string>("all");
  const [visibilityMode, setVisibilityMode] = useState<"all" | "public" | "private">("all");
  const [tagMode, setTagMode] = useState<string>("all");
  const [tagSearch, setTagSearch] = useState<string>("");
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
  const [addLibraryId, setAddLibraryId] = useState<number | null>(null);
  const [editingLibraryId, setEditingLibraryId] = useState<number | null>(null);
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

  const [bulkMode, setBulkMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  function exitEditMode() {
    setBulkMode(false);
    setReorderMode(false);
    setBulkSelectedKeys({});
    setBulkState({ busy: false, error: null, message: null });
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
      const cm = window.localStorage.getItem("om_categoryMode");
      const vis = window.localStorage.getItem("om_visibilityMode");
      const tm = window.localStorage.getItem("om_tagMode");
      if (vm === "grid" || vm === "list") setViewMode(vm);
      if (gc === "1" || gc === "2" || gc === "4" || gc === "8") setGridCols(Number(gc) as any);
      if (sm === "latest" || sm === "earliest" || sm === "title_asc" || sm === "title_desc") setSortMode(sm);
      if (cm && typeof cm === "string") setCategoryMode(cm);
      if (tm && typeof tm === "string") setTagMode(tm);
      if (vis === "all" || vis === "public" || vis === "private") setVisibilityMode(vis);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("om_viewMode", viewMode);
      window.localStorage.setItem("om_gridCols", String(gridCols));
      window.localStorage.setItem("om_sortMode", sortMode);
      if (!filterCategory) window.localStorage.setItem("om_categoryMode", categoryMode);
      if (!filterTag) window.localStorage.setItem("om_tagMode", tagMode);
      window.localStorage.setItem("om_visibilityMode", visibilityMode);
    } catch {
      // ignore
    }
  }, [viewMode, gridCols, sortMode, categoryMode, filterCategory, tagMode, filterTag, visibilityMode]);

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

  async function applyBooksFromServer(serverRows: any[], source: string) {
    const client = supabase;
    if (!client) return;
    const normalizedRows = (serverRows ?? []).map((r: any) => ({
      ...r,
      media: Array.isArray(r?.media) ? r.media : [],
      book_tags: Array.isArray(r?.book_tags) ? r.book_tags : [],
      edition: r?.edition ?? null
    }));
    setDebugBooksSource(source);
    setItems(normalizedRows as any);
    const serverPaths = Array.from(
      new Set([
        ...normalizedRows
          .flatMap((r) => (Array.isArray(r.media) ? r.media : []))
          .map((m: any) => (typeof m?.storage_path === "string" ? m.storage_path : ""))
          .filter(Boolean),
        ...normalizedRows
          .filter((r: any) => r.cover_crop && typeof r.cover_original_url === "string" && r.cover_original_url)
          .map((r: any) => r.cover_original_url as string)
      ])
    );
    const serverMissing = serverPaths.filter((p) => !mediaUrlsByPath[p]);
    if (serverMissing.length > 0) {
      const signedServer = await client.storage.from("user-book-media").createSignedUrls(serverMissing, 60 * 60);
      if (!signedServer.error && signedServer.data) {
        const nextMap: Record<string, string> = {};
        for (const s of signedServer.data) if (s.path && s.signedUrl) nextMap[s.path] = s.signedUrl;
        setMediaUrlsByPath((prev) => ({ ...prev, ...nextMap }));
      }
    }
  }

  async function refreshAllBooks(targetLibraryIds?: number[], options?: { fastFirst?: boolean }) {
    if (!supabase) return;
    setBooksLoading(true);
    const ids = Array.from(new Set((targetLibraryIds ?? libraries.map((l) => l.id)).filter((n) => Number.isFinite(n) && n > 0)));
    const idsQuery = ids.length > 0 ? `catalog_ids=${encodeURIComponent(ids.join(","))}` : "";
    const endpoint = idsQuery ? `/api/catalog/home?${idsQuery}` : "/api/catalog/home";
    const liteEndpoint = idsQuery ? `/api/catalog/home?${idsQuery}&lite=1` : "/api/catalog/home?lite=1";
    try {
      if (options?.fastFirst) {
        const liteHome = await catalogApi<{ ok: true; books: any[] }>(liteEndpoint, { method: "GET" });
        if (Array.isArray(liteHome.books)) {
          await applyBooksFromServer(liteHome.books as any[], ids.length > 0 ? "books:server-home-lite" : "books:server-home-lite-noids");
          setBooksLoading(false);
        }
      }
      const serverHome = await catalogApi<{ ok: true; books: any[] }>(endpoint, { method: "GET" });
      if (Array.isArray(serverHome.books)) {
        await applyBooksFromServer(serverHome.books as any[], ids.length > 0 ? "books:server-home" : "books:server-home-noids");
        return;
      }
      setDebugBooksSource("books:failed");
      setItems([]);
      return;
    } catch (err: any) {
      setDebugLastError(String(err?.message ?? "server_home_failed"));
      setDebugBooksSource("books:failed");
      setItems([]);
      return;
    } finally {
      setBooksLoading(false);
    }
  }

  async function refreshLibraries(): Promise<LibrarySummary[]> {
    if (!supabase) return [];
    setLibraryState({ busy: true, error: null, message: null });
    try {
      let list: LibrarySummary[] = [];
      try {
        const listRes = await catalogApi<{ ok: true; catalogs: LibrarySummary[] }>("/api/catalog/list", { method: "GET" });
        const apiList = Array.isArray(listRes.catalogs) ? listRes.catalogs : [];
        if (apiList.length > 0) {
          setDebugLibrariesSource("libs:api-list");
          list = apiList;
        }
      } catch {
        setDebugLastError("catalog_list_failed");
        // fall through to client-side queries
      }

      if (list.length > 0) {
        setLibraries(list);
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
        setLibraryState({ busy: false, error: null, message: null });
        return list;
      }

      if (list.length === 0) {
        try {
          const serverHome = await catalogApi<{ ok: true; catalogs: LibrarySummary[]; books: any[] }>("/api/catalog/home?lite=1", { method: "GET" });
          const serverCatalogs = Array.isArray(serverHome.catalogs) ? serverHome.catalogs : [];
          if (serverCatalogs.length > 0) {
            setDebugLibrariesSource("libs:server-home");
            list = serverCatalogs;
          } else {
            const rows = Array.isArray(serverHome.books) ? serverHome.books : [];
            const idsFromBooks = Array.from(new Set(rows.map((r: any) => Number(r.library_id)).filter((n: any) => Number.isFinite(n) && n > 0)));
            if (idsFromBooks.length > 0) {
              setDebugLibrariesSource("libs:server-home-derived");
              list = idsFromBooks.map((id) => ({
                id,
                name: `Catalog ${id}`,
                created_at: new Date(0).toISOString(),
                myRole: "owner" as const
              }));
            }
          }
          if (list.length > 0) {
            setLibraries(list);
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
            setLibraryState({ busy: false, error: null, message: null });
            return list;
          }
        } catch {
          // continue to client fallback
        }
      }

      if (list.length === 0) {
        let ownedList: LibrarySummary[] = [];
        const resWithOrder = await supabase
          .from("libraries")
          .select("id,name,created_at,sort_order,owner_id")
          .eq("owner_id", userId)
          .order("sort_order", { ascending: true });
        if (!resWithOrder.error) {
          setDebugLibrariesSource("libs:client-owned-sort");
          ownedList = ((resWithOrder.data ?? []) as any[]).map((l) => ({ ...l, myRole: "owner" as const }));
        } else {
          const msg = (resWithOrder.error.message ?? "").toLowerCase();
          if (msg.includes("sort_order") && msg.includes("does not exist")) {
            const res = await supabase
              .from("libraries")
              .select("id,name,created_at,owner_id")
              .eq("owner_id", userId)
              .order("created_at", { ascending: true });
            if (res.error) throw new Error(res.error.message);
            setDebugLibrariesSource("libs:client-owned-created");
            ownedList = ((res.data ?? []) as any[]).map((l) => ({ ...l, myRole: "owner" as const }));
          } else {
            throw new Error(resWithOrder.error.message);
          }
        }

        let sharedList: LibrarySummary[] = [];
        try {
          const sharedRes = await catalogApi<{ ok: true; shared: Array<{ catalog_id: number; role: "owner" | "editor"; catalog: { id: number; name: string } | null }> }>(
            "/api/catalog/shared",
            { method: "GET" }
          );
          const acceptedShared = Array.isArray(sharedRes.shared) ? sharedRes.shared : [];
          if (acceptedShared.length > 0) setDebugLibrariesSource("libs:client-shared");
          sharedList = acceptedShared
            .map((r) => {
              const cid = Number(r.catalog?.id ?? r.catalog_id);
              if (!Number.isFinite(cid) || cid <= 0) return null;
              return {
                id: cid,
                name: String(r.catalog?.name ?? `Catalog ${cid}`),
                created_at: new Date(0).toISOString(),
                sort_order: null,
                owner_id: null,
                myRole: r.role === "owner" ? "owner" : "editor"
              } satisfies LibrarySummary;
            })
            .filter(Boolean) as LibrarySummary[];
        } catch {
          sharedList = [];
        }

        const byId = new Map<number, LibrarySummary>();
        for (const l of [...ownedList, ...sharedList]) byId.set(Number(l.id), l);
        list = Array.from(byId.values());
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
        list = ((res2.data ?? []) as any[]).map((l) => ({ ...l, myRole: "owner" as const }));
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
        }
      }

      try {
        const raw = window.localStorage.getItem("om_libraryOrder");
        const order = (raw ?? "")
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (order.length > 0) {
          const rank = new Map<number, number>();
          order.forEach((id, idx) => rank.set(id, idx));
          list = list
            .slice()
            .sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || Date.parse(a.created_at) - Date.parse(b.created_at));
        }
      } catch {
        // ignore
      }

      setLibraries(list);

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

      setLibraryState({ busy: false, error: null, message: null });
      return list;
    } catch (e: any) {
      try {
        const ownerFallback = await supabase
          .from("libraries")
          .select("id,name,created_at,owner_id")
          .eq("owner_id", userId)
          .order("created_at", { ascending: true });
        if (!ownerFallback.error) {
          setDebugLibrariesSource("libs:owner-fallback");
          const ownerList = ((ownerFallback.data ?? []) as any[]).map((l) => ({ ...l, myRole: "owner" as const })) as LibrarySummary[];
          setLibraries(ownerList);
          setAddLibraryId(ownerList[0]?.id ?? null);
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
      void refreshAllBooks(undefined, { fastFirst: true });
      const [profileRes] = await Promise.all([
        supabase.from("profiles").select("username,visibility,avatar_path").eq("id", userId).maybeSingle(),
        refreshLibraries()
      ]);
      const profileData = profileRes.data;
      if (!alive) return;
      if (profileData) setProfile(profileData);
      const resolvedAvatar = await resolveAvatarUrl(profileData?.avatar_path ?? null);
      if (!alive) return;
      setAvatarUrl(resolvedAvatar);
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

  async function previewIsbn(isbn: string) {
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
    } catch (e: any) {
      setAddState({ busy: false, error: e?.message ?? "ISBN lookup failed", message: "ISBN lookup failed" });
    }
  }

  async function searchAddResults(title: string, author: string | null) {
    setAddSearchState({ busy: true, error: null, message: "Searching…" });
    setAddSearchResults([]);
    try {
      const res = await fetch(`/api/search?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author ?? "")}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Search failed");
      setAddSearchResults((json.results ?? []) as any[]);
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
      await previewIsbn(value);
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
  }, targetLibraryId?: number | null): Promise<number> {
    if (!supabase) throw new Error("Supabase is not configured");
    const selectedLibraryId = Number(targetLibraryId ?? addLibraryId ?? 0);
    if (!selectedLibraryId) throw new Error("Choose a catalog first");
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
    await refreshAllBooks();
    return created.data.id as number;
  }

  async function confirmAddFromPreview() {
    if (!addUrlPreview) return;
    setAddState({ busy: true, error: null, message: "Adding…" });
    try {
      const id = await addEditionData(addUrlPreview, addPreviewLibraryId);
      setAddInput("");
      cancelAddPreview();
      router.push(`/app/books/${id}`);
    } catch (e: any) {
      setAddState({ busy: false, error: e?.message ?? "Failed to add book", message: e?.message ?? "Failed to add book" });
    }
  }

  async function addFromSearchResultItem(result: typeof addSearchResults[number], targetLibraryId?: number | null) {
    setAddState({ busy: true, error: null, message: "Adding…" });
    try {
      const id = await addEditionData(result, targetLibraryId);
      setAddInput("");
      cancelAddPreview();
      router.push(`/app/books/${id}`);
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

  function setUrlFilters(next: { tag?: string | null; category?: string | null }) {
    const params = new URLSearchParams();
    const nextTag = typeof next.tag === "string" ? next.tag : next.tag === null ? "" : (filterTag ?? "");
    const nextCategory = typeof next.category === "string" ? next.category : next.category === null ? "" : (filterCategory ?? "");

    const tagVal = nextTag.trim();
    const catVal = nextCategory.trim();
    if (tagVal && tagVal !== "all") params.set("tag", tagVal);
    if (catVal && catVal !== "all") params.set("category", catVal);
    if (filterAuthor) params.set("author", filterAuthor);
    if (filterSubject) params.set("subject", filterSubject);
    if (filterPublisher) params.set("publisher", filterPublisher);

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
        earliestCreatedAt: Number.isFinite(earliest) ? earliest : Date.now()
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
    if (visibilityMode !== "all") {
      groups = groups.filter((g) => {
        const eff = g.effectiveVisibility;
        if (visibilityMode === "public") return eff === "public" || eff === "mixed";
        return eff === "followers_only" || eff === "mixed";
      });
    }
    if (q) {
      groups = groups.filter((g) => {
        const title = (g.title ?? "").toLowerCase();
        const authors = (g.filterAuthors ?? []).join(" ").toLowerCase();
        const tags = (g.tagNames ?? []).join(" ").toLowerCase();
        return title.includes(q) || authors.includes(q) || tags.includes(q);
      });
    }

    groups.sort((a, b) => {
      if (sortMode === "latest") return b.latestCreatedAt - a.latestCreatedAt;
      if (sortMode === "earliest") return a.earliestCreatedAt - b.earliestCreatedAt;
      const cmp = normalizeKeyPart(a.title).localeCompare(normalizeKeyPart(b.title));
      return sortMode === "title_asc" ? cmp : -cmp;
    });

    return groups;
  }, [filteredItems, filterTag, tagMode, filterAuthor, filterSubject, filterPublisher, filterDesigner, filterGroup, filterDecade, filterCategory, categoryMode, visibilityMode, sortMode, searchQuery, profile?.visibility]);

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
              <span>{renderLibraries.length}</span>
            </span>
            <span className="om-stat-pair">
              <span className="text-muted">Books</span>
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
                
                if (activeCategory) pairs.push({ label: "Category", value: activeCategory, key: "category", onClear: () => { setCategoryMode("all"); clearFilter("category"); } });
                if (activeTag) pairs.push({ label: "Tag", value: activeTag, key: "tag", onClear: () => { setTagMode("all"); clearFilter("tag"); } });
                if (filterAuthor) pairs.push({ label: "Author", value: filterAuthor, key: "author", onClear: () => clearFilter("author") });
                if (filterEditor) pairs.push({ label: "Editor", value: filterEditor, key: "editor", onClear: () => clearFilter("editor") });
                if (filterDesigner) pairs.push({ label: "Designer", value: filterDesigner, key: "designer", onClear: () => clearFilter("designer") });
                if (filterSubject) pairs.push({ label: "Subject", value: filterSubject, key: "subject", onClear: () => clearFilter("subject") });
                if (filterPublisher) pairs.push({ label: "Publisher", value: filterPublisher, key: "publisher", onClear: () => clearFilter("publisher") });
                if (filterMaterial) pairs.push({ label: "Material", value: filterMaterial, key: "material", onClear: () => clearFilter("material") });
                if (filterGroup) pairs.push({ label: "Group", value: filterGroup, key: "group", onClear: () => clearFilter("group") });
                if (filterDecade) pairs.push({ label: "Decade", value: filterDecade, key: "decade", onClear: () => clearFilter("decade") });
                return pairs;
              })()}
              onClearAll={() => { setTagMode("all"); setCategoryMode("all"); setSearchQuery(""); router.push("/app"); }}
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
                        <img src={result.cover_url} alt="" width={60} style={{ display: "block", width: "100%", height: "auto", objectFit: "contain" }} />
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
                      {[result.publisher ?? "", result.publish_date ?? ""].filter(Boolean).join(" · ") || "—"}
                    </div>
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
        <div className="om-filter-row" style={{ marginTop: 16, marginBottom: "var(--space-14)", flexWrap: isMobile ? "wrap" : "nowrap", gap: "var(--space-10)", alignItems: "center" }}>
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

          <select className="om-filter-control" value={sortMode} onChange={(e) => setSortMode(e.target.value as any)}>
            <option value="latest">latest</option>
            <option value="earliest">earliest</option>
            <option value="title_asc">title A-Z</option>
            <option value="title_desc">title Z-A</option>
          </select>
          <button ref={tagButtonRef} onClick={() => (tagMenu.open ? closeTagMenu() : openTagMenu())} className={`om-filter-control${tagMenu.open ? " is-open" : ""}`} style={{ minWidth: 120 }}>
            <span>{(filterTag ?? tagMode ?? "tag")}</span>
            <span className="om-filter-caret" />
          </button>
          <button ref={categoryButtonRef} onClick={() => (categoryMenu.open ? closeCategoryMenu() : openCategoryMenu())} className={`om-filter-control${categoryMenu.open ? " is-open" : ""}`} style={{ minWidth: 160 }}>
            <span>{((filterCategory ?? categoryMode) !== "all" ? String(filterCategory ?? categoryMode) : "category")}</span>
            <span className="om-filter-caret" />
          </button>
          <select className="om-filter-control" value={visibilityMode} onChange={(e) => setVisibilityMode(e.target.value as any)}>
            <option value="all">all</option>
            <option value="public">public</option>
            <option value="private">private</option>
          </select>
        </div>
      )}

      {tagMenu.open && (
        <div ref={tagMenuRef} className="om-popover" style={{ position: "fixed", top: tagMenu.top, left: tagMenu.left, minWidth: tagMenu.minWidth, maxHeight: 320, overflow: "auto", zIndex: 1001 }}>
          <input placeholder="Search…" value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} style={{ width: "100%", marginBottom: "var(--space-8)", position: "sticky", top: 0, background: "var(--bg)", zIndex: 2 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <button onClick={() => { setUrlFilters({ tag: null }); closeTagMenu(); }} style={{ textAlign: "left" }}>all</button>
            {availableTags.filter(t => t.toLowerCase().includes(tagSearch.trim().toLowerCase())).slice(0, 400).map(t => (
              <button key={t} onClick={() => { setUrlFilters({ tag: t }); closeTagMenu(); }} style={{ textAlign: "left" }}>{t}</button>
            ))}
          </div>
        </div>
      )}

      {categoryMenu.open && (
        <div ref={categoryMenuRef} className="om-popover" style={{ position: "fixed", top: categoryMenu.top, left: categoryMenu.left, minWidth: categoryMenu.minWidth, maxHeight: 320, overflow: "auto", zIndex: 1001 }}>
          <input placeholder="Search…" value={categorySearch} onChange={(e) => setCategorySearch(e.target.value)} style={{ width: "100%", marginBottom: "var(--space-8)", position: "sticky", top: 0, background: "var(--bg)", zIndex: 2 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <button onClick={() => { setUrlFilters({ category: null }); closeCategoryMenu(); }} style={{ textAlign: "left" }}>all</button>
            {availableCategories.filter(c => c.toLowerCase().includes(categorySearch.trim().toLowerCase())).slice(0, 400).map(c => (
              <button key={c} onClick={() => { setUrlFilters({ category: c }); closeCategoryMenu(); }} style={{ textAlign: "left" }}>{c}</button>
            ))}
          </div>
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

      {renderLibraries.map((lib, idx) => {
        const groups = displayGroupsByLibraryId[lib.id] ?? [];
        const effectiveCols = isMobile ? Math.min(gridCols, 2) : gridCols;
        const showBookSkeleton = booksLoading && groups.length === 0;
        const memberState = membersByCatalogId[lib.id] ?? { busy: false, error: null, members: [], inviteInput: "", inviteBusy: false };
        const acceptedMembers = memberState.members.filter((m) => m.accepted_at);
        const pendingMembers = memberState.members.filter((m) => !m.accepted_at);
        const selfMember = memberState.members.find((m) => m.user_id === userId) ?? null;
        const iAmOwner = (selfMember?.role ?? lib.myRole) === "owner";
        return (
          <div key={lib.id}>
            <LibraryBlock
              libraryId={lib.id}
              libraryName={lib.name}
              memberPreviews={lib.memberPreviews ?? []}
              bookCount={groups.length}
              index={idx}
              total={renderLibraries.length}
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
              onToggleCollapsed={(id) => setCollapsedByLibraryId(prev => { const n = { ...prev }; if (n[id]) delete n[id]; else n[id] = true; return n; })}
              onMoveUp={(id) => moveLibrary(id, -1)}
              onMoveDown={(id) => moveLibrary(id, 1)}
              viewMode={viewMode}
              gridCols={effectiveCols}
              searchQuery={searchQuery}
              renderBooks={(limit) => (
                <div style={{ display: viewMode === "grid" ? "grid" : "flex", flexDirection: viewMode === "list" ? "column" : undefined, gridTemplateColumns: viewMode === "grid" ? `repeat(${effectiveCols}, minmax(0, 1fr))` : undefined, gap: "var(--space-md)" }}>
                  {showBookSkeleton
                    ? Array.from({ length: Math.min(4, Math.max(1, effectiveCols)) }).map((_, i) => (
                        <div key={`skeleton-${lib.id}-${i}`} className="om-cover-placeholder" style={{ width: "100%", aspectRatio: "3/4" }} />
                      ))
                    : null}
                  {groups.slice(0, limit).map(g => (
                    <BookCard
                      key={g.key}
                      viewMode={viewMode}
                      bulkMode={bulkMode}
                      selected={!!bulkSelectedKeys[g.key]}
                      onToggleSelected={() => toggleBulkKey(g.key)}
                      title={g.title}
                      authors={g.filterAuthors}
                      isbn13={g.primary.edition?.isbn13 ?? null}
                      tags={g.tagNames}
                      copiesCount={g.copiesCount}
                      href={`/app/books/${g.primary.id}`}
                      coverUrl={g.primary.media.find(m => m.kind === 'cover')?.storage_path ? (mediaUrlsByPath[g.primary.media.find(m => m.kind === 'cover')!.storage_path] ?? null) : (g.primary.edition?.cover_url ?? null)}
                      cropData={g.primary.cover_crop}
                      onDeleteCopy={() => deleteEntry(g.primary.id)}
                      deleteState={deleteStateByBookId[g.primary.id]}
                      gridCols={effectiveCols}
                    />
                  ))}
                </div>
              )}
            />
            {bulkMode ? (
              <div className="card" style={{ marginTop: "var(--space-sm)" }}>
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
            ) : null}
            {idx < renderLibraries.length - 1 && <hr className="om-hr" />}
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
  const filterTag = searchParams.get("tag");
  const filterAuthor = searchParams.get("author");
  const filterSubject = searchParams.get("subject");
  const filterPublisher = searchParams.get("publisher");
  const filterDesigner = searchParams.get("designer");
  const filterEditor = searchParams.get("editor");
  const filterMaterial = searchParams.get("material");
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
      filterGroup={filterGroup}
      filterDecade={filterDecade}
      filterCategory={filterCategory}
      openAddPanel={openAddPanel}
      openCsvPicker={openCsvPicker}
    />
  );
}

export default function AppPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    if (!supabase) { setSessionLoaded(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setSessionLoaded(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => { setSession(newSession); setSessionLoaded(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <main className="container">
      {!supabase ? (
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.</div>
        </div>
      ) : !sessionLoaded ? (
        <div className="card">Loading…</div>
      ) : session ? (
        <Suspense fallback={<div className="card">Loading…</div>}>
          <AppWithFilters session={session} />
        </Suspense>
      ) : (
        <SignInCard note="Followers-only by default; public is optional later." />
      )}
    </main>
  );
}
