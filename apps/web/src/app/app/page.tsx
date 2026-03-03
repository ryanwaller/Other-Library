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
import type { CoverCrop } from "../../components/CoverImage";
import { useBookScanner } from "../../hooks/useBookScanner";
import dynamic from "next/dynamic";
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
      // Skip completely empty trailing row
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
  filterGroup: string | null;
  filterDecade: string | null;
  filterCategory: string | null;
  openCsvPicker: boolean;
  openAddPanel: boolean;
}) {
  const router = useRouter();
  const tagButtonRef = useRef<HTMLButtonElement | null>(null);
  const categoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const tagMenuRef = useRef<HTMLDivElement | null>(null);
  const categoryMenuRef = useRef<HTMLDivElement | null>(null);
  const userId = session.user.id;
  const [profile, setProfile] = useState<{ username: string; visibility: string; avatar_path: string | null } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userBooksCount, setUserBooksCount] = useState<number | null>(null);
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
  type CatalogItem = {
    id: number;
    library_id: number;
    created_at: string;
    visibility: "inherit" | "followers_only" | "public";
    title_override: string | null;
    authors_override: string[] | null;
    subjects_override: string[] | null;
    publisher_override: string | null;
    designers_override: string[] | null;
    group_label: string | null;
    decade: string | null;
    cover_original_url: string | null;
    cover_crop: CoverCrop | null;
    edition: {
      id: number;
      isbn13: string | null;
      title: string | null;
      authors: string[] | null;
      subjects: string[] | null;
      publisher: string | null;
      cover_url: string | null;
      publish_date: string | null;
    } | null;
    media: Array<{ id: number; kind: "cover" | "image"; storage_path: string; caption: string | null; created_at: string }>;
    book_tags: Array<{ tag: { id: number; name: string; kind: "tag" | "category" } | null }>;
  };
  type CatalogGroup = {
    key: string;
    libraryId: number;
    primary: CatalogItem;
    copies: CatalogItem[];
    copiesCount: number;
    tagNames: string[];
    categoryNames: string[];
    filterAuthors: string[];
    filterSubjects: string[];
    filterPublishers: string[];
    filterDesigners: string[];
    filterGroups: string[];
    filterDecades: string[];
    title: string;
    visibility: "inherit" | "followers_only" | "public" | "mixed";
    effectiveVisibility: "public" | "followers_only" | "mixed";
    latestCreatedAt: number;
    earliestCreatedAt: number;
  };

  const [items, setItems] = useState<CatalogItem[]>([]);
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
  const [deleteStateByBookId, setDeleteStateByBookId] = useState<Record<number, { busy: boolean; error: string | null; message: string | null } | undefined>>(
    {}
  );

  const [libraries, setLibraries] = useState<Array<{ id: number; name: string; created_at: string; sort_order?: number | null }>>([]);
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

  const [bulkMode, setBulkMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<Record<string, true | undefined>>({});
  const [bulkCategoryName, setBulkCategoryName] = useState("");
  const [bulkState, setBulkState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [reorderMode, setReorderMode] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
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
    if (!isMobile) return;
    setGridCols((prev) => (prev === 4 || prev === 8 ? 2 : prev));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function refreshAllBooks() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("user_books")
      .select(
        "id,library_id,created_at,visibility,title_override,authors_override,subjects_override,publisher_override,designers_override,group_label,decade,cover_original_url,cover_crop,edition:editions(id,isbn13,title,authors,subjects,publisher,cover_url,publish_date),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))"
      )
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(800);
    if (error) return;
    const rows = (data ?? []) as any[];
    setItems(rows as any);

    const paths = Array.from(
      new Set([
        ...rows
          .flatMap((r) => (Array.isArray(r.media) ? r.media : []))
          .map((m: any) => (typeof m?.storage_path === "string" ? m.storage_path : ""))
          .filter(Boolean),
        ...rows
          .filter((r: any) => r.cover_crop && typeof r.cover_original_url === "string" && r.cover_original_url)
          .map((r: any) => r.cover_original_url as string)
      ])
    );
    const missing = paths.filter((p) => !mediaUrlsByPath[p]);
    if (missing.length === 0) return;

    const { data: signed, error: signErr } = await supabase.storage.from("user-book-media").createSignedUrls(missing, 60 * 60);
    if (signErr || !signed) return;
    const nextMap: Record<string, string> = {};
    for (const s of signed) {
      if (s.path && s.signedUrl) nextMap[s.path] = s.signedUrl;
    }
    setMediaUrlsByPath((prev) => ({ ...prev, ...nextMap }));
  }

  async function refreshLibraries() {
    if (!supabase) return;
    setLibraryState({ busy: true, error: null, message: null });
    try {
      let list: Array<{ id: number; name: string; created_at: string; sort_order?: number | null }> = [];

      // Prefer DB ordering if the column exists, but gracefully fall back (older schema).
      const resWithOrder = await supabase.from("libraries").select("id,name,created_at,sort_order").eq("owner_id", userId).order("sort_order", { ascending: true });
      if (!resWithOrder.error) {
        list = (resWithOrder.data ?? []) as any;
      } else {
        const msg = (resWithOrder.error.message ?? "").toLowerCase();
        if (msg.includes("sort_order") && msg.includes("does not exist")) {
          const res = await supabase.from("libraries").select("id,name,created_at").eq("owner_id", userId).order("created_at", { ascending: true });
          if (res.error) throw new Error(res.error.message);
          list = (res.data ?? []) as any;
        } else {
          throw new Error(resWithOrder.error.message);
        }
      }

      if (list.length === 0) {
        const created = await supabase.from("libraries").insert({ owner_id: userId, name: "Your catalog" }).select("id").single();
        if (created.error) throw new Error(created.error.message);
        const res2 = await supabase.from("libraries").select("id,name,created_at").eq("owner_id", userId).order("created_at", { ascending: true });
        if (res2.error) throw new Error(res2.error.message);
        list = (res2.data ?? []) as any;
      }

      // Apply local order preference (used even if DB order is present, until we migrate fully).
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
    } catch (e: any) {
      setLibraries([]);
      setAddLibraryId(null);
      setLibraryState({ busy: false, error: e?.message ?? "Failed to load catalogs", message: null });
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
      const { data: profileData } = await supabase
        .from("profiles")
        .select("username,visibility,avatar_path")
        .eq("id", userId)
        .maybeSingle();
      if (!alive) return;
      if (profileData) setProfile(profileData);

      if (profileData?.avatar_path) {
        const signed = await supabase.storage.from("avatars").createSignedUrl(profileData.avatar_path, 60 * 60);
        if (!alive) return;
        setAvatarUrl(signed.data?.signedUrl ?? null);
      } else {
        setAvatarUrl(null);
      }

      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", userId);
      if (!alive) return;
      setUserBooksCount(count ?? 0);

      await Promise.all([refreshLibraries(), refreshAllBooks()]);
      if (alive) setInitialLoadDone(true);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  function normalizeIsbn(input: string): string {
    return input
      .trim()
      .toUpperCase()
      .replace(/[^0-9X]/g, "");
  }

  function looksLikeIsbn(input: string): boolean {
    const n = normalizeIsbn(input);
    return n.length === 10 || n.length === 13;
  }

  function tryParseUrl(input: string): URL | null {
    const raw = input.trim();
    if (!raw) return null;
    try {
      return new URL(raw);
    } catch {
      // allow "www.example.com/..."
      if (raw.startsWith("www.")) {
        try {
          return new URL(`https://${raw}`);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  function parseTitleAndAuthor(input: string): { title: string; author: string | null } {
    const s = input.trim().replace(/\s+/g, " ");
    if (!s) return { title: "", author: null };
    const by = s.split(/\s+by\s+/i);
    if (by.length === 2 && by[0] && by[1]) return { title: by[0].trim(), author: by[1].trim() || null };
    const dash = s.split(" - ");
    if (dash.length === 2 && dash[0] && dash[1]) return { title: dash[0].trim(), author: dash[1].trim() || null };
    const slash = s.split(" / ");
    if (slash.length === 2 && slash[0] && slash[1]) return { title: slash[0].trim(), author: slash[1].trim() || null };
    return { title: s, author: null };
  }

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

      // Find or insert edition (no updates; users can override on user_books later).
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
      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", userId);
      setUserBooksCount(count ?? 0);
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
      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", userId);
      setUserBooksCount(count ?? 0);
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
        // Brief delay to mitigate rate limiting and allow UI updates
        await new Promise(res => setTimeout(res, 20));
      }

      await refreshAllBooks();
      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", userId);
      setUserBooksCount(count ?? 0);
      
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

  async function updateUserBookVisibility(userBookId: number, nextVisibility: "inherit" | "followers_only" | "public") {
    if (!supabase) return;
    const { error } = await supabase.from("user_books").update({ visibility: nextVisibility }).eq("id", userBookId);
    if (error) return;
    setItems((prev) => prev.map((it) => (it.id === userBookId ? { ...it, visibility: nextVisibility } : it)));
  }

  async function updateUserBookVisibilityGroup(userBookIds: number[], nextVisibility: "inherit" | "followers_only" | "public") {
    if (!supabase) return;
    const ids = Array.from(new Set(userBookIds)).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return;
    const { error } = await supabase.from("user_books").update({ visibility: nextVisibility }).in("id", ids);
    if (error) return;
    setItems((prev) => prev.map((it) => (ids.includes(it.id) ? { ...it, visibility: nextVisibility } : it)));
  }

  function safeFileName(name: string): string {
    return name.trim().replace(/[^\w.\-]+/g, "_").slice(0, 120) || "image";
  }

  function selectPendingCover(userBookId: number, files: FileList | null) {
    const picked = Array.from(files ?? []).filter((f) => f.size > 0);
    const first = picked[0];
    setPendingCoverByBookId((prev) => ({ ...prev, [userBookId]: first }));
    setCoverUploadStateByBookId((prev) => ({
      ...prev,
      [userBookId]: first ? { busy: false, error: null, message: `${first.name} selected` } : undefined
    }));
  }

  function clearPendingCover(userBookId: number) {
    setPendingCoverByBookId((prev) => {
      const next = { ...prev };
      delete next[userBookId];
      return next;
    });
    setCoverUploadStateByBookId((prev) => {
      const next = { ...prev };
      delete next[userBookId];
      return next;
    });
    setCoverInputKeyByBookId((prev) => ({ ...prev, [userBookId]: (prev[userBookId] ?? 0) + 1 }));
  }

  async function uploadSelectedCover(userBookId: number) {
    if (!supabase) return;
    const file = pendingCoverByBookId[userBookId];
    if (!file) return;

    setCoverUploadStateByBookId((prev) => ({
      ...prev,
      [userBookId]: { busy: true, error: null, message: "Uploading cover…" }
    }));

    const path = `${userId}/${userBookId}/cover-${Date.now()}-${safeFileName(file.name)}`;
    const up = await supabase.storage.from("user-book-media").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream"
    });
    if (up.error) {
      setCoverUploadStateByBookId((prev) => ({
        ...prev,
        [userBookId]: { busy: false, error: up.error.message, message: "Upload failed" }
      }));
      return;
    }

    const inserted = await supabase
      .from("user_book_media")
      .insert({ user_book_id: userBookId, kind: "cover", storage_path: path, caption: null })
      .select("id")
      .single();
    if (inserted.error) {
      setCoverUploadStateByBookId((prev) => ({
        ...prev,
        [userBookId]: { busy: false, error: inserted.error.message, message: "Upload failed" }
      }));
      return;
    }

    await supabase
      .from("user_book_media")
      .update({ kind: "image" })
      .eq("user_book_id", userBookId)
      .eq("kind", "cover")
      .neq("id", inserted.data.id);

    await refreshAllBooks();
    clearPendingCover(userBookId);
    setCoverUploadStateByBookId((prev) => ({
      ...prev,
      [userBookId]: { busy: false, error: null, message: "Cover uploaded" }
    }));
  }

  async function deleteEntry(userBookId: number) {
    if (!supabase) return;
    if (!window.confirm("Delete this entry?")) return;

    setDeleteStateByBookId((prev) => ({
      ...prev,
      [userBookId]: { busy: true, error: null, message: "Deleting…" }
    }));

    try {
      const it = items.find((x) => x.id === userBookId) ?? null;
      const paths = (it?.media ?? [])
        .map((m) => (typeof m?.storage_path === "string" ? m.storage_path : ""))
        .filter(Boolean);

      if (paths.length > 0) {
        const rm = await supabase.storage.from("user-book-media").remove(paths);
        if (rm.error) {
          // continue; we'll still delete the DB record
        }
      }

      const del = await supabase.from("user_books").delete().eq("id", userBookId);
      if (del.error) throw new Error(del.error.message);

      await refreshAllBooks();
      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", userId);
      setUserBooksCount(count ?? 0);

      setDeleteStateByBookId((prev) => ({
        ...prev,
        [userBookId]: { busy: false, error: null, message: "Deleted" }
      }));
    } catch (e: any) {
      setDeleteStateByBookId((prev) => ({
        ...prev,
        [userBookId]: { busy: false, error: e?.message ?? "Delete failed", message: "Delete failed" }
      }));
    }
  }

  const filteredItems = useMemo(() => {
    return items;
  }, [items]);

  function normalizeKeyPart(input: string): string {
    return (input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function effectiveTitleFor(it: CatalogItem): string {
    const e = it.edition;
    return it.title_override?.trim() ? it.title_override : e?.title ?? "(untitled)";
  }

  function effectiveAuthorsFor(it: CatalogItem): string[] {
    const override = (it.authors_override ?? []).filter(Boolean);
    if (override.length > 0) return override;
    return (it.edition?.authors ?? []).filter(Boolean);
  }

  function effectiveSubjectsFor(it: CatalogItem): string[] {
    if (it.subjects_override !== null && it.subjects_override !== undefined) return (it.subjects_override ?? []).filter(Boolean);
    return ((it.edition?.subjects ?? []) as string[]).filter(Boolean);
  }

  function tagsFor(it: CatalogItem): Array<{ name: string; kind: "tag" | "category" }> {
    return (it.book_tags ?? [])
      .map((bt) => bt.tag)
      .filter(Boolean)
      .map((t) => ({ name: (t as any).name as string, kind: (t as any).kind as "tag" | "category" }))
      .filter((t) => t.name && (t.kind === "tag" || t.kind === "category"));
  }

  function effectivePublisherFor(it: CatalogItem): string {
    const o = (it.publisher_override ?? "").trim();
    if (o) return o;
    return (it.edition?.publisher ?? "").trim();
  }

  function groupKeyFor(it: CatalogItem): string {
    const eId = it.edition?.id ?? null;
    if (eId) return `e:${eId}`;
    const title = normalizeKeyPart(effectiveTitleFor(it));
    const authors = effectiveAuthorsFor(it).map((a) => normalizeKeyPart(a)).filter(Boolean).join("|");
    return `m:${title}|${authors}`;
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

  function clampNumber(n: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, n));
  }

  useEffect(() => {
    if (!tagMenu.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTagMenu();
    };
    window.addEventListener("keydown", onKey);

    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (tagMenuRef.current?.contains(t)) return;
      if (tagButtonRef.current?.contains(t)) return;
      closeTagMenu();
    };
    window.addEventListener("pointerdown", onPointerDownCapture, true);

    if (!isMobile) {
      const onScrollOrResize = () => closeTagMenu();
      window.addEventListener("scroll", onScrollOrResize);
      window.addEventListener("resize", onScrollOrResize);
      return () => {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("pointerdown", onPointerDownCapture, true);
        window.removeEventListener("scroll", onScrollOrResize);
        window.removeEventListener("resize", onScrollOrResize);
      };
    }

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDownCapture, true);
    };
  }, [tagMenu.open, isMobile]);

  useEffect(() => {
    if (!categoryMenu.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCategoryMenu();
    };
    window.addEventListener("keydown", onKey);

    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (categoryMenuRef.current?.contains(t)) return;
      if (categoryButtonRef.current?.contains(t)) return;
      closeCategoryMenu();
    };
    window.addEventListener("pointerdown", onPointerDownCapture, true);

    if (!isMobile) {
      const onScrollOrResize = () => closeCategoryMenu();
      window.addEventListener("scroll", onScrollOrResize);
      window.addEventListener("resize", onScrollOrResize);
      return () => {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("pointerdown", onPointerDownCapture, true);
        window.removeEventListener("scroll", onScrollOrResize);
        window.removeEventListener("resize", onScrollOrResize);
      };
    }

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDownCapture, true);
    };
  }, [categoryMenu.open, isMobile]);

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
      const primary = sorted
        .slice()
        .sort((a, b) => {
          const score = (c: CatalogItem): number => {
            let s = 0;
            const hasCoverMedia = (c.media ?? []).some((m) => m.kind === "cover");
            const hasAnyMedia = (c.media ?? []).some((m) => m.kind === "cover" || m.kind === "image");
            const hasEditionCover = Boolean(c.edition?.cover_url);
            const hasTitle = Boolean(effectiveTitleFor(c));
            const hasAuthors = effectiveAuthorsFor(c).length > 0;
            const hasPublisher = Boolean(effectivePublisherFor(c));
            const hasSubjects = effectiveSubjectsFor(c).length > 0;
            if (hasCoverMedia) s += 1000;
            else if (hasAnyMedia) s += 300;
            if (hasEditionCover) s += 150;
            if (hasTitle) s += 20;
            if (hasAuthors) s += 10;
            if (hasPublisher) s += 5;
            if (hasSubjects) s += 3;
            return s;
          };
          const diff = score(b) - score(a);
          if (diff) return diff;
          return Date.parse(b.created_at) - Date.parse(a.created_at);
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

      const visibility = visSet.size === 1 ? (primary.visibility as any) : "mixed";
      const effectiveVisibility =
        effVisSet.size === 1
          ? ((Array.from(effVisSet.values())[0] as string) === "public" ? "public" : "followers_only")
          : ("mixed" as const);

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
        visibility,
        effectiveVisibility,
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
        const e = g.primary.edition;
        const title = (g.title ?? "").toLowerCase();
        const authors = (g.filterAuthors ?? []).join(" ").toLowerCase();
        const subjects = (g.filterSubjects ?? []).join(" ").toLowerCase();
        const publishers = (g.filterPublishers ?? []).join(" ").toLowerCase();
        const designers = (g.filterDesigners ?? []).join(" ").toLowerCase();
        const tags = (g.tagNames ?? []).join(" ").toLowerCase();
        const isbn = String(e?.isbn13 ?? "").toLowerCase();
        return (
          title.includes(q) ||
          authors.includes(q) ||
          subjects.includes(q) ||
          publishers.includes(q) ||
          designers.includes(q) ||
          tags.includes(q) ||
          (q.length >= 6 && isbn.includes(q))
        );
      });
    }

    const titleKey = (g: CatalogGroup) => normalizeKeyPart(g.title);
    groups.sort((a, b) => {
      if (sortMode === "latest") return b.latestCreatedAt - a.latestCreatedAt;
      if (sortMode === "earliest") return a.earliestCreatedAt - b.earliestCreatedAt;
      const cmp = titleKey(a).localeCompare(titleKey(b));
      return sortMode === "title_asc" ? cmp : -cmp;
    });

    return groups;
  }, [filteredItems, filterTag, tagMode, filterAuthor, filterSubject, filterPublisher, filterDesigner, filterGroup, filterDecade, filterCategory, categoryMode, visibilityMode, sortMode, searchQuery, profile?.visibility]);

  const displayGroupsByLibraryId = useMemo(() => {
    const by: Record<number, CatalogGroup[]> = {};
    for (const g of displayGroups) {
      const id = Number(g.libraryId);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (!by[id]) by[id] = [];
      by[id].push(g);
    }
    return by;
  }, [displayGroups]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      for (const t of tagsFor(it)) {
        if (t.kind === "category") set.add(t.name);
      }
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      for (const t of tagsFor(it)) {
        if (t.kind === "tag") set.add(t.name);
      }
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

  const bulkSelectedCount = useMemo(() => Object.keys(bulkSelectedKeys).length, [bulkSelectedKeys]);
  const bulkSelectedGroups = useMemo(() => displayGroups.filter((g) => bulkSelectedKeys[g.key]), [displayGroups, bulkSelectedKeys]);

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
        const rm = await supabase.storage.from("user-book-media").remove(paths);
        if (rm.error) {
          // continue
        }
      }
      const del = await supabase.from("user_books").delete().in("id", ids);
      if (del.error) throw new Error(del.error.message);
      setBulkSelectedKeys({});
      await refreshAllBooks();
      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", userId);
      setUserBooksCount(count ?? 0);
      setBulkState({ busy: false, error: null, message: "Deleted" });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Bulk delete failed", message: "Bulk delete failed" });
    }
  }

  async function bulkMoveSelected(targetLibraryId: number) {
    if (!supabase) return;
    if (bulkSelectedGroups.length === 0) return;
    if (!Number.isFinite(targetLibraryId) || targetLibraryId <= 0) return;
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
    if (!Number.isFinite(targetLibraryId) || targetLibraryId <= 0) return;
    setBulkState({ busy: true, error: null, message: "Copying…" });
    try {
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));
      const srcRes = await supabase
        .from("user_books")
        .select("id,edition_id,visibility,status,borrowable_override,borrow_request_scope_override,title_override,authors_override,editors_override,designers_override,publisher_override,printer_override,materials_override,edition_override,publish_date_override,description_override,subjects_override,location,shelf,notes")
        .in("id", ids);
      if (srcRes.error) throw new Error(srcRes.error.message);
      const srcRows = (srcRes.data ?? []) as any[];

      const tagRes = await supabase.from("user_book_tags").select("user_book_id,tag_id").in("user_book_id", ids);
      if (tagRes.error) throw new Error(tagRes.error.message);
      const tagsByBookId: Record<number, number[]> = {};
      for (const r of (tagRes.data ?? []) as any[]) {
        const bid = Number(r.user_book_id);
        const tid = Number(r.tag_id);
        if (!Number.isFinite(bid) || !Number.isFinite(tid)) continue;
        (tagsByBookId[bid] ??= []).push(tid);
      }

      const mediaRes = await supabase.from("user_book_media").select("user_book_id,kind,storage_path,caption").in("user_book_id", ids);
      if (mediaRes.error) throw new Error(mediaRes.error.message);
      const mediaByBookId: Record<number, Array<{ kind: "cover" | "image"; storage_path: string; caption: string | null }>> = {};
      for (const m of (mediaRes.data ?? []) as any[]) {
        const bid = Number((m as any).user_book_id);
        const kind = String((m as any).kind ?? "").trim() as any;
        const storage_path = String((m as any).storage_path ?? "").trim();
        const caption = ((m as any).caption ?? null) as any;
        if (!Number.isFinite(bid) || bid <= 0) continue;
        if (!storage_path) continue;
        if (kind !== "cover" && kind !== "image") continue;
        (mediaByBookId[bid] ??= []).push({ kind, storage_path, caption: typeof caption === "string" ? caption : null });
      }

      const idMap = new Map<number, number>();
      let copied = 0;
      for (const r of srcRows) {
        const inserted = await supabase.from("user_books").insert({
          owner_id: userId,
          library_id: targetLibraryId,
          edition_id: (r as any).edition_id ?? null,
          visibility: (r as any).visibility ?? "inherit",
          status: (r as any).status ?? "owned",
          borrowable_override: (r as any).borrowable_override ?? null,
          borrow_request_scope_override: (r as any).borrow_request_scope_override ?? null,
          title_override: (r as any).title_override ?? null,
          authors_override: (r as any).authors_override ?? null,
          editors_override: (r as any).editors_override ?? null,
          designers_override: (r as any).designers_override ?? null,
          subjects_override: (r as any).subjects_override ?? null,
          publisher_override: (r as any).publisher_override ?? null,
          printer_override: (r as any).printer_override ?? null,
          materials_override: (r as any).materials_override ?? null,
          edition_override: (r as any).edition_override ?? null,
          publish_date_override: (r as any).publish_date_override ?? null,
          description_override: (r as any).description_override ?? null,
          location: (r as any).location ?? null,
          shelf: (r as any).shelf ?? null,
          notes: (r as any).notes ?? null
        }).select("id").single();
        if (inserted.error) throw new Error(inserted.error.message);
        copied += 1;
        const newId = Number((inserted.data as any)?.id);
        const oldId = Number((r as any).id);
        if (Number.isFinite(oldId) && Number.isFinite(newId) && newId > 0) idMap.set(oldId, newId);
        const tagIds = (tagsByBookId[oldId] ?? []).filter((t) => Number.isFinite(t) && t > 0);
        if (Number.isFinite(newId) && Number.isFinite(newId) && newId > 0 && tagIds.length > 0) {
          const rows = tagIds.map((tagId) => ({ user_book_id: newId, tag_id: tagId }));
          const insTags = await supabase.from("user_book_tags").insert(rows as any);
          if (insTags.error) { }
        }
      }

      for (const [oldId, newId] of idMap.entries()) {
        const media = (mediaByBookId[oldId] ?? []).slice();
        if (media.length === 0) continue;
        media.sort((a, b) => (a.kind === "cover" ? -1 : 1) - (b.kind === "cover" ? -1 : 1));
        let coverCopied = false;
        for (const m of media) {
          try {
            const base = safeFileName(String(m.storage_path.split("/").pop() ?? "image"));
            const destPath = `${userId}/${newId}/${Date.now()}-${base}`;
            const copiedObj = await supabase.storage.from("user-book-media").copy(m.storage_path, destPath);
            if (copiedObj.error) continue;
            const kind: "cover" | "image" = m.kind === "cover" && !coverCopied ? "cover" : "image";
            if (kind === "cover") coverCopied = true;
            const ins = await supabase.from("user_book_media").insert({ user_book_id: newId, kind, storage_path: destPath, caption: m.caption ?? null });
            if (ins.error) { }
          } catch { }
        }
      }

      setBulkSelectedKeys({});
      await refreshAllBooks();
      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", userId);
      setUserBooksCount(count ?? 0);
      setBulkState({ busy: false, error: null, message: `Copied ${copied}` });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Copy failed", message: "Copy failed" });
    }
  }

  function moveLibrary(libraryId: number, delta: -1 | 1) {
    setLibraries((prev) => {
      const idx = prev.findIndex((l) => l.id === libraryId);
      if (idx < 0) return prev;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(idx, 1);
      next.splice(nextIdx, 0, moved);
      try {
        window.localStorage.setItem("om_libraryOrder", next.map((l) => l.id).filter((n) => Number.isFinite(n) && n > 0).join(","));
      } catch { }
      return next;
    });
  }

  function beginEditLibrary(libraryId: number, currentName: string) {
    setEditingLibraryId(libraryId);
    setLibraryNameDraft(currentName ?? "");
  }

  function cancelEditLibrary() {
    setEditingLibraryId(null);
    setLibraryNameDraft("");
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

  function desiredVisibilityForAction(action: "public" | "private"): "inherit" | "followers_only" | "public" {
    const profileVis = profile?.visibility === "public" ? "public" : "followers_only";
    if (action === "public") return profileVis === "public" ? "inherit" : "public";
    return profileVis === "public" ? "followers_only" : "inherit";
  }

  async function bulkMakePublic() {
    if (!supabase) return;
    if (!bulkSelectedGroups.length) return;
    setBulkState({ busy: true, error: null, message: "Applying…" });
    try {
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));
      await updateUserBookVisibilityGroup(ids, desiredVisibilityForAction("public"));
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
      await updateUserBookVisibilityGroup(ids, desiredVisibilityForAction("private"));
      await refreshAllBooks();
      setBulkState({ busy: false, error: null, message: "Applied" });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Apply failed", message: "Apply failed" });
    }
  }

  const booksContainerStyle = useMemo<CSSProperties>(
    () => ({
      display: viewMode === "grid" ? "grid" : "flex",
      flexDirection: viewMode === "list" ? ("column" as const) : undefined,
      gridTemplateColumns: viewMode === "grid" ? `repeat(${gridCols}, minmax(0, 1fr))` : undefined,
      gap: viewMode === "grid" ? 12 : 12
      }),

    [viewMode, gridCols]
  );

  function renderGroup(g: CatalogGroup) {
    const it = g.primary;
    const e = it.edition;
    const title = g.title;
    const effectiveAuthors = effectiveAuthorsFor(it);
    const tags: string[] = [];
    const selected = !!bulkSelectedKeys[g.key];
    const coverUrl =
      g.copies
        .map((c) => {
          const cover = (c.media ?? []).find((m) => m.kind === "cover");
          if (!cover) return null;
          return mediaUrlsByPath[cover.storage_path] ?? null;
        })
        .find(Boolean) ?? e?.cover_url ?? null;
    const cropData = it.cover_crop ?? null;
    const originalSrc = cropData && it.cover_original_url ? (mediaUrlsByPath[it.cover_original_url] ?? coverUrl) : coverUrl;
    const delState = deleteStateByBookId[it.id];
    return (
      <BookCard
        viewMode={viewMode}
        bulkMode={bulkMode}
        selected={selected}
        onToggleSelected={() => toggleBulkKey(g.key)}
        title={title}
        authors={effectiveAuthors}
        isbn13={e?.isbn13 ?? null}
        tags={tags}
        copiesCount={g.copiesCount}
        href={`/app/books/${it.id}`}
        coverUrl={coverUrl}
        cropData={cropData}
        originalSrc={originalSrc}
        onDeleteCopy={() => deleteEntry(it.id)}
        deleteState={delState as any}
        showDeleteCopy={false}
        gridCols={gridCols}
      />
    );
  }

  const showAddPanel =
    addOpen ||
    Boolean(addUrlPreview) ||
    addSearchResults.length > 0 ||
    Boolean(addSearchState.message) ||
    Boolean(addState.message) ||
    csvRows.length > 0 ||
    Boolean(csvImportState.message) ||
    Boolean(csvImportState.error);

  if (!initialLoadDone) return null;

  return (
    <>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
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
          disabled={csvImportState.busy || addState.busy || addSearchState.busy}
        />

        <div className="row" style={{ justifyContent: "space-between", margin: 0 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted">Catalogs</span>
          <span>{libraries.length}</span>
          <span className="muted">Books</span>
          <span>{displayGroups.length}</span>
          {bulkMode ? (
            <>
              <span className="muted">Selected</span>
              <span>{bulkSelectedCount}</span>
              {displayGroups.length > 0 && bulkSelectedCount < displayGroups.length ? (
                <button
                  type="button"
                  onClick={selectAll}
                  style={{ background: "transparent", border: 0, padding: 0, font: "inherit", color: "inherit", textDecoration: "underline", cursor: "pointer" }}
                >
                  Select all
                </button>
              ) : null}
              {bulkSelectedCount > 0 ? (
                <button
                  type="button"
                  className="om-clear-filter-btn"
                  onClick={() => setBulkSelectedKeys({})}
                  style={{ margin: 0 }}
                >
                  clear
                </button>
              ) : null}
            </>
          ) : null}
          {libraryState.message ? <span className="muted">{libraryState.message}</span> : libraryState.error ? <span className="muted">{libraryState.error}</span> : null}
        </div>
        <div className="row muted" style={{ gap: 10, justifyContent: "flex-end" }}>
          {(filterTag ?? tagMode) !== "all" || filterAuthor || filterSubject || filterPublisher || (filterCategory ?? categoryMode) !== "all" ? (
            <>
              {(() => {
                const activeCategory = (filterCategory ?? categoryMode) !== "all" ? String(filterCategory ?? categoryMode) : null;
                const activeTag = (filterTag ?? tagMode) !== "all" ? String(filterTag ?? tagMode) : null;
                const pairs: Array<{ label: string; value: string }> = [];
                if (activeCategory) pairs.push({ label: "Category", value: activeCategory });
                if (activeTag) pairs.push({ label: "Tag", value: activeTag });
                if (filterAuthor) pairs.push({ label: "Author", value: filterAuthor });
                if (filterSubject) pairs.push({ label: "Subject", value: filterSubject });
                if (filterPublisher) pairs.push({ label: "Publisher", value: filterPublisher });
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
                type="button"
                className="om-clear-filter-btn"
                onClick={() => {
                  setTagMode("all");
                  setCategoryMode("all");
                  setTagSearch("");
                  setCategorySearch("");
                  setSearchQuery("");
                  setVisibilityMode("all");
                  closeTagMenu();
                  closeCategoryMenu();
                  router.push("/app");
                }}
                >clear</button>

            </>
          ) : null}
        </div>
      </div>

      <div className="row" style={{ width: "100%", margin: 0, alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: isMobile ? "wrap" : "nowrap" }}>
        <div className="row" style={{ width: "100%", gap: 12, alignItems: "baseline", minWidth: 0, flex: "1 1 auto", flexWrap: isMobile ? "wrap" : "nowrap", margin: 0 }}>
          <button
            onClick={() => {
              setBulkMode((prev) => {
                const next = !prev;
                if (!next) setBulkSelectedKeys({});
                setBulkState({ busy: false, error: null, message: null });
                setReorderMode(next);
                setSortOpen(false);
                setAddOpen(false);
                closeTagMenu();
                closeCategoryMenu();
                return next;
              });
            }}
          >
            {bulkMode ? "Done" : "Edit"}
          </button>
          <button
            type="button"
            className={sortOpen ? "text-primary" : "muted"}
            onClick={() => {
              setSortOpen((v) => !v);
              setAddOpen(false);
              closeTagMenu();
              closeCategoryMenu();
            }}
          >
            View by
          </button>
          <button
            type="button"
            className={showAddPanel ? "text-primary" : "muted"}
            onClick={() => {
              setAddOpen((prev) => !prev);
              setSortOpen(false);
              closeTagMenu();
              closeCategoryMenu();
            }}
          >
            Add to catalog
          </button>
          <input
            className="om-inline-search-input"
            placeholder="Search your catalog"
            value={searchQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ minWidth: 0, flex: 1, maxWidth: "100%" }}
          />
        </div>
        {(searchFocused || searchQuery.trim()) ? (
          <Link
            href={`/app/discover${searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ""}`}
            className="muted"
            style={{ whiteSpace: "nowrap", flex: "0 0 auto", marginTop: isMobile ? 6 : 0 }}
          >
            Search others
          </Link>
        ) : null}
      </div>
    </div>

      {showAddPanel ? (
        <>
          <div className="row" style={{ width: "100%", marginTop: 6, flexWrap: isMobile ? "wrap" : "nowrap", gap: 8, alignItems: "baseline" }}>
            {stagedCsvData ? (
              <div className="row" style={{ flex: 1, gap: 12, alignItems: "baseline" }}>
                <span style={{ fontWeight: 600 }}>{stagedCsvFilename}</span>
                <div className="row" style={{ gap: 12, marginLeft: "auto" }}>
                  <button
                    onClick={() => {
                      const objects = parseCsvToObjects(stagedCsvData);
                      const normalized: any[] = objects
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
                          };
                        })
                        .filter((r) => Boolean(r.title || r.isbn));
                      setCsvRows(normalized);
                      setStagedCsvData(null);
                      setStagedCsvFilename(null);
                      window.sessionStorage.removeItem("om_staged_csv_data");
                      window.sessionStorage.removeItem("om_staged_csv_filename");
                    }}
                    disabled={csvImportState.busy}
                  >
                    Add CSV
                  </button>
                  <button
                    className="muted"
                    onClick={() => {
                      setStagedCsvData(null);
                      setStagedCsvFilename(null);
                      window.sessionStorage.removeItem("om_staged_csv_data");
                      window.sessionStorage.removeItem("om_staged_csv_filename");
                    }}
                    disabled={csvImportState.busy}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {showScan && (
                  <>
                    <button 
                      className="muted" 
                      onClick={openScanner} 
                      style={{ whiteSpace: "nowrap", padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", textDecoration: "underline" }}
                    >
                      Scan
                    </button>
                    <span className="muted">or</span>
                  </>
                )}
                <input
                  placeholder={showScan ? "enter ISBN, URL, or title" : "Add by ISBN, URL, or title"}
                  value={addInput}
                  onFocus={() => setAddInputFocused(true)}
                  onBlur={() => setAddInputFocused(false)}
                  onChange={(e) => setAddInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    smartAddOrSearch();
                  }}
                  style={{ minWidth: 0, flex: 1 }}
                />
                <div className="row" style={{ marginLeft: "auto", gap: 12, flex: "0 0 auto", justifyContent: "flex-end" }}>
                  {(addInput.trim() || addInputFocused) ? (
                    <button onClick={() => smartAddOrSearch()} disabled={addState.busy || !addInput.trim()}>
                      {addState.busy ? "Working…" : "Go"}
                    </button>
                  ) : null}
                  {addUrlPreview || addSearchResults.length > 0 || addSearchState.message || addState.message ? (
                    <button onClick={cancelAddPreview} disabled={addState.busy || addSearchState.busy}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            {addState.message ? (addState.error ? `${addState.message} (${addState.error})` : addState.message) : ""}
          </div>
        </>
      ) : null}

      {addUrlPreview ? (
        <div style={{ marginTop: 10 }} className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ width: 62, flex: "0 0 auto" }}>
              {addUrlPreview.cover_url && !addPreviewCoverFailed ? (
                <div className="om-cover-slot" style={{ width: 60, height: "auto" }}>
                  <img
                    src={`/api/image-proxy?url=${encodeURIComponent(addUrlPreview.cover_url)}`}
                    alt=""
                    width={60}
                    style={{ display: "block", width: "100%", height: "auto", objectFit: "contain" }}
                    onLoad={(e) => {
                      if (e.currentTarget.naturalWidth < 100 || e.currentTarget.naturalHeight < 100) {
                        setAddPreviewCoverFailed(true);
                      }
                    }}
                    onError={() => setAddPreviewCoverFailed(true)}
                  />
                </div>
              ) : (
                <div className="om-cover-slot" style={{ width: 60, height: "auto" }} />
              )}
            </div>
            <div style={{ flex: "1 1 auto" }}>
              <div>{(addUrlPreview.title ?? "").trim() || "—"}</div>
              <div className="muted" style={{ marginTop: 4 }}>
                {(addUrlPreview.authors ?? []).filter(Boolean).join(", ") || "—"}
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {[addUrlPreview.publisher ?? "", addUrlPreview.publish_date ?? ""].filter(Boolean).join(" · ") || "—"}
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {addUrlPreview.isbn13 || addUrlPreview.isbn10 ? `ISBN: ${addUrlPreview.isbn13 ?? addUrlPreview.isbn10}` : "No ISBN found"}
                {" "}
                · sources: {(addUrlPreview.sources ?? []).join(", ") || "—"}
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {addUrlMeta.domain ? `${addUrlMeta.domain_kind ?? "generic"} · ${addUrlMeta.domain}` : ""}
                {addUrlMeta.final_url ? (
                  <>
                    {" "}
                    ·{" "}
                    <a href={addUrlMeta.final_url} target="_blank" rel="noreferrer">
                      open
                    </a>
                  </>
                ) : null}
              </div>
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <div className="row" style={{ gap: 8 }}>
                <button
                  onClick={async () => {
                    if (!addUrlPreview) return;
                    setAddState({ busy: true, error: null, message: "Adding…" });
                    try {
                      const isbn = String(addUrlPreview.isbn13 ?? addUrlPreview.isbn10 ?? "").trim();
                      let id: number;
                      if (isbn) id = await addByIsbnValue(isbn);
                      else
                        id = await addManualValue({
                          title: (addUrlPreview.title ?? "").trim() || addInput.trim(),
                          authors: (addUrlPreview.authors ?? []).filter(Boolean),
                          publisher: addUrlPreview.publisher ?? null,
                          publish_date: addUrlPreview.publish_date ?? null,
                          description: addUrlPreview.description ?? null
                        });
                      if (addUrlPreview.cover_url) {
                        await importCoverForBook(id, addUrlPreview.cover_url);
                        await refreshAllBooks();
                      }
                      setAddInput("");
                      cancelAddPreview();
                      setAddState({ busy: false, error: null, message: "Added" });
                      window.setTimeout(() => setAddState({ busy: false, error: null, message: null }), 1200);
                    } catch (e: any) {
                      setAddState({ busy: false, error: e?.message ?? "Add failed", message: "Add failed" });
                    }
                  }}
                  disabled={addState.busy}
                >
                  Add
                </button>
                <button onClick={cancelAddPreview} disabled={addState.busy}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {addSearchResults.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          {addSearchResults.map((r, idx) => {
            const bestIsbn = r.isbn13 ?? r.isbn10 ?? "";
            const title = (r.title ?? "").trim() || "—";
            const authors = (r.authors ?? []).filter(Boolean).join(", ");
            const pub = [r.publisher ?? "", r.publish_date ?? (r.publish_year ? String(r.publish_year) : "")].filter(Boolean).join(" · ");
            return (
              <div key={`${r.source}:${bestIsbn || title}:${idx}`} className="card" style={{ marginTop: 8 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ width: 62, flex: "0 0 auto" }}>
                    {r.cover_url ? (
                      <div className="om-cover-slot" style={{ width: 60, height: "auto" }}>
                        <img
                          src={`/api/image-proxy?url=${encodeURIComponent(String(r.cover_url))}`}
                          alt=""
                          width={60}
                          style={{ display: "block", width: "100%", height: "auto", objectFit: "contain" }}
                          onLoad={(e) => {
                            if (e.currentTarget.naturalWidth < 100 || e.currentTarget.naturalHeight < 100) {
                              e.currentTarget.style.display = "none";
                            }
                          }}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      </div>
                    ) : (
                      <div className="om-cover-slot" style={{ width: 60, height: "auto" }} />
                    )}

                  </div>
                  <div style={{ flex: "1 1 auto" }}>
                    <div>{title}</div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {authors || "—"}
                      {pub ? ` · ${pub}` : ""}
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {bestIsbn ? `ISBN: ${bestIsbn}` : "No ISBN found"} · {r.source}
                    </div>
                  </div>
                  <div style={{ flex: "0 0 auto" }}>
                    <button
                      onClick={async () => {
                        setAddState({ busy: true, error: null, message: "Adding…" });
                        try {
                          let id: number;
                          if (bestIsbn) id = await addByIsbnValue(bestIsbn);
                          else
                            id = await addManualValue({
                              title: (r.title ?? addInput).trim() || addInput.trim(),
                              authors: (r.authors ?? []).filter(Boolean),
                              publisher: r.publisher ?? null,
                              publish_date: r.publish_date ?? null,
                              description: null
                            });
                          if (r.cover_url) {
                            await importCoverForBook(id, r.cover_url);
                            await refreshAllBooks();
                          }
                          setAddInput("");
                          cancelAddPreview();
                          setAddState({ busy: false, error: null, message: "Added" });
                          window.setTimeout(() => setAddState({ busy: false, error: null, message: null }), 1200);
                        } catch (e: any) {
                          setAddState({ busy: false, error: e?.message ?? "Add failed", message: "Add failed" });
                        }
                      }}
                      disabled={addState.busy}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="muted" style={{ marginTop: 6 }}>
            {addSearchState.message ? (addSearchState.error ? `${addSearchState.message} (${addSearchState.error})` : addSearchState.message) : ""}
          </div>
        </div>
      ) : addSearchState.message ? (
        <div className="muted" style={{ marginTop: 8 }}>
          {addSearchState.error ? `${addSearchState.message} (${addSearchState.error})` : addSearchState.message}
        </div>
      ) : null}

      {(addUrlPreview || addSearchResults.length > 0 || addSearchState.message || csvRows.length > 0) && libraries.length > 0 ? (
        <div className="row" style={{ marginTop: 6, alignItems: "baseline", gap: 10 }}>
          <span className="muted">Add to catalog</span>
          {libraries.length > 1 ? (
            <select
              value={addLibraryId ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                setAddLibraryId(id);
                try {
                  window.localStorage.setItem("om_addLibraryId", String(id));
                } catch { }
              }}
              disabled={libraryState.busy || !addLibraryId}
            >
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted">{libraries[0]?.name}</span>
          )}
        </div>
      ) : null}

      {csvRows.length > 0 || csvImportState.message || csvImportState.error ? (
        <div className="row" style={{ marginTop: 6, flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {csvRows.length > 0 ? (
            <>
              <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={csvApplyOverrides} onChange={(e) => setCsvApplyOverrides(e.target.checked)} />
                use CSV metadata as overrides
              </label>
              <button onClick={importCsvRows} disabled={csvImportState.busy || !addLibraryId}>
                {csvImportState.busy ? "Importing…" : `Import ${csvRows.length}`}
              </button>
              <button onClick={clearCsvImport} disabled={csvImportState.busy}>
                Clear
              </button>
            </>
          ) : null}
          {csvImportState.message ? <span className="muted">{csvImportState.message}</span> : csvImportState.error ? <span className="muted">{csvImportState.error}</span> : null}
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        {sortOpen ? (
          <div
            className="om-filter-row"
            style={{
              marginTop: 16,
              marginBottom: 14,
              flexWrap: isMobile ? "wrap" : "nowrap",
              gap: 10,
              alignItems: "center",
              overflowX: isMobile ? ("visible" as const) : "auto",
              paddingBottom: 4
            }}
          >
            <select className="om-filter-control" value={viewMode} onChange={(e) => setViewMode(e.target.value as any)}>
              <option value="grid">grid</option>
              <option value="list">list</option>
            </select>
            {viewMode === "grid" ? (
              <select className="om-filter-control" value={gridCols} onChange={(e) => setGridCols(Number(e.target.value) as any)}>
                {isMobile ? <option value={1}>1</option> : null}
                <option value={2}>2</option>
                {!isMobile ? <option value={4}>4</option> : null}
                {!isMobile ? <option value={8}>8</option> : null}
              </select>
            ) : null}
            <select className="om-filter-control" value={sortMode} onChange={(e) => setSortMode(e.target.value as any)}>
              <option value="latest">latest</option>
              <option value="earliest">earliest</option>
              <option value="title_asc">title A-Z</option>
              <option value="title_desc">title Z-A</option>
            </select>
            <button
              ref={tagButtonRef}
              onClick={() => (tagMenu.open ? closeTagMenu() : openTagMenu())}
              className={`om-filter-control${tagMenu.open ? " is-open" : ""}`}
              style={{ minWidth: 120 }}
              aria-haspopup="menu"
              aria-expanded={tagMenu.open}
            >
              <span>
                {(() => {
                  const active = (filterTag ?? tagMode ?? "all").trim();
                  return `${active && active !== "all" ? active : "tag"}`;
                })()}
              </span>
              <span className="om-filter-caret" aria-hidden="true" />
            </button>
            <button
              ref={categoryButtonRef}
              onClick={() => (categoryMenu.open ? closeCategoryMenu() : openCategoryMenu())}
              className={`om-filter-control${categoryMenu.open ? " is-open" : ""}`}
              style={{ minWidth: 160 }}
              aria-haspopup="menu"
              aria-expanded={categoryMenu.open}
            >
              <span>{(filterCategory ?? categoryMode) !== "all" ? String(filterCategory ?? categoryMode) : "category"}</span>
              <span className="om-filter-caret" aria-hidden="true" />
            </button>
            <select className="om-filter-control" value={visibilityMode} onChange={(e) => setVisibilityMode(e.target.value as any)}>
              <option value="all">all</option>
              <option value="public">public</option>
              <option value="private">private</option>
            </select>
          </div>
        ) : null}

        {tagMenu.open ? (
          <div
            ref={tagMenuRef}
            className="om-popover"
            style={{ position: "fixed", top: tagMenu.top, left: tagMenu.left, minWidth: tagMenu.minWidth, maxHeight: 320, overflow: "auto", zIndex: 1001 }}
          >
            <input
              placeholder="Search…"
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              style={{ width: "100%", marginBottom: 8, position: "sticky", top: 0, background: "var(--bg)", zIndex: 2 }}
              autoFocus={!isMobile}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                onClick={() => {
                  setUrlFilters({ tag: null });
                  closeTagMenu();
                }}
                style={{ textAlign: "left" }}
              >
                all
              </button>
              {availableTags
                .filter((t) => t.toLowerCase().includes(tagSearch.trim().toLowerCase()))
                .slice(0, 400)
                .map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setUrlFilters({ tag: t });
                      closeTagMenu();
                    }}
                    style={{ textAlign: "left" }}
                  >
                    {t}
                  </button>
                ))}
            </div>
          </div>
        ) : null}

        {categoryMenu.open ? (
          <div
            ref={categoryMenuRef}
            className="om-popover"
            style={{ position: "fixed", top: categoryMenu.top, left: categoryMenu.left, minWidth: categoryMenu.minWidth, maxHeight: 320, overflow: "auto", zIndex: 1001 }}
          >
            <input
              placeholder="Search…"
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              style={{ width: "100%", marginBottom: 8, position: "sticky", top: 0, background: "var(--bg)", zIndex: 2 }}
              autoFocus={!isMobile}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                onClick={() => {
                  setUrlFilters({ category: null });
                  closeCategoryMenu();
                }}
                style={{ textAlign: "left" }}
              >
                all
              </button>
              {availableCategories
                .filter((c) => c.toLowerCase().includes(categorySearch.trim().toLowerCase()))
                .slice(0, 400)
                .map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setUrlFilters({ category: c });
                      closeCategoryMenu();
                    }}
                    style={{ textAlign: "left" }}
                  >
                    {c}
                  </button>
                ))}
            </div>
          </div>
        ) : null}

        <BulkBar
          bulkMode={bulkMode}
          bulkState={bulkState}
          selectedGroupsCount={bulkSelectedGroups.length}
          libraries={libraries.map((l) => ({ id: l.id, name: l.name }))}
          bulkCategoryName={bulkCategoryName}
          setBulkCategoryName={setBulkCategoryName}
          onClearSelected={() => setBulkSelectedKeys({})}
          onBulkDeleteSelected={bulkDeleteSelected}
          onBulkMakePublic={bulkMakePublic}
          onBulkMakePrivate={bulkMakePrivate}
          onBulkAssignCategory={bulkAssignCategory}
          onBulkMoveSelected={bulkMoveSelected}
          onBulkCopySelected={bulkCopySelected}
          onAnyMenuOpen={() => {
            closeTagMenu();
            closeCategoryMenu();
          }}
        />
      </div>

      <div style={{ marginTop: 32 }} />

      {libraries.map((lib, idx) => {
        const groups = displayGroupsByLibraryId[lib.id] ?? [];
        const isEditing = editingLibraryId === lib.id;
        return (
          <div key={lib.id}>
            <LibraryBlock
              libraryId={lib.id}
              libraryName={lib.name}
              bookCount={groups.length}
              index={idx}
              total={libraries.length}
              busy={libraryState.busy}
              isEditing={isEditing}
              nameDraft={libraryNameDraft}
              reorderMode={bulkMode}
              manageMode={bulkMode}
              onStartEdit={beginEditLibrary}
              onNameDraftChange={setLibraryNameDraft}
              onSaveName={saveLibraryName}
              onCancelEdit={cancelEditLibrary}
              onDelete={deleteLibrary}
              collapsed={!!collapsedByLibraryId[lib.id]}
              onToggleCollapsed={(id) => {
                setCollapsedByLibraryId((prev) => {
                  const next = { ...prev };
                  if (next[id]) delete next[id];
                  else next[id] = true;
                  return next;
                });
              }}
              onMoveUp={(id) => moveLibrary(id, -1)}
              onMoveDown={(id) => moveLibrary(id, 1)}
              viewMode={viewMode}
              gridCols={gridCols}
              searchQuery={searchQuery}
              renderBooks={(limit) => {
                if (groups.length === 0) {
                  return (
                    <div className="muted" style={{ marginTop: 10 }}>
                      No books yet.
                    </div>
                  );
                }
                return (
                  <div style={{ marginTop: 10, ...booksContainerStyle }}>
                    {groups.slice(0, limit).map(renderGroup)}
                  </div>
                );
              }}
            />
            {idx < libraries.length - 1 ? <hr className="om-hr" /> : null}
          </div>
        );
      })}

      <hr className="om-hr" />

      <div style={{ marginTop: 24 }} className="card">
        <div className="row" style={{ marginTop: 6, flexWrap: isMobile ? "wrap" : "nowrap", gap: 10, width: "100%", alignItems: "baseline" }}>
          <input
            placeholder="Add another catalog (e.g. Home, Office)"
            value={newLibraryName}
            onFocus={() => setNewLibraryFocused(true)}
            onBlur={() => setNewLibraryFocused(false)}
            onChange={(e) => setNewLibraryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              createLibrary(newLibraryName);
            }}
            style={{ minWidth: 0, flex: 1 }}
          />
          {(newLibraryName.trim() || newLibraryFocused) ? (
            <button onClick={() => createLibrary(newLibraryName)} disabled={libraryState.busy} style={{ marginLeft: "auto" }}>
              Add
            </button>
          ) : null}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          {libraryState.message ? (libraryState.error ? `${libraryState.message} (${libraryState.error})` : libraryState.message) : libraryState.error ?? ""}
        </div>
      </div>
      <div style={{ height: 24 }} />
      <BookScannerModal
        open={scannerOpen}
        onClose={closeScanner}
        onResult={(query) => {
          setAddInput(query);
          smartAddOrSearch(query);
        }}
      />
    </>
  );
}

export default function AppPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setSessionLoaded(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setSessionLoaded(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <main className="container">
      {!supabase ? (
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
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

function AppWithFilters({ session }: { session: Session }) {
  const searchParams = useSearchParams();
  const filterTag = searchParams.get("tag");
  const filterAuthor = searchParams.get("author");
  const filterSubject = searchParams.get("subject");
  const filterPublisher = searchParams.get("publisher");
  const filterDesigner = searchParams.get("designer");
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
      filterGroup={filterGroup}
      filterDecade={filterDecade}
      filterCategory={filterCategory}
      openAddPanel={openAddPanel}
      openCsvPicker={openCsvPicker}
    />
  );
}
