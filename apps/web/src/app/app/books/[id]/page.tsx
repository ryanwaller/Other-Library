"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../../lib/supabaseClient";
import { isValidTrimSize, convertTrimUnit, formatTrimRatio, type TrimUnit } from "../../../../lib/trimSize";
import { bookIdSlug } from "../../../../lib/slug";
import { formatDateShort } from "../../../../lib/formatDate";
import AlsoOwnedBy from "../../../u/[username]/AlsoOwnedBy";
import SignInCard from "../../../components/SignInCard";
import EntityTokenField from "../../components/EntityTokenField";
import CoverImage, { type CoverCrop } from "../../../../components/CoverImage";
import ExpandableContent from "../../../../components/ExpandableContent";
import CustomSlider from "../../../../components/CustomSlider";
import CoverEditor, { type EditorState } from "./components/CoverEditor";
import { useBookScanner } from "../../../../hooks/useBookScanner";
import dynamic from "next/dynamic";
const BookScannerModal = dynamic(() => import("../../../../components/BookScannerModal"), { ssr: false });

type FacetRole =
  | "author"
  | "editor"
  | "designer"
  | "subject"
  | "tag"
  | "category"
  | "material"
  | "printer"
  | "publisher";

type EntityRef = { id: string; name: string; slug: string };

type UserBookDetail = {
  id: number;
  owner_id: string;
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  status: "owned" | "loaned" | "selling" | "trading";
  borrowable_override: boolean | null;
  borrow_request_scope_override: string | null;
  group_label: string | null;
  object_type: string | null;
  decade: string | null;
  pages: number | null;
  title_override: string | null;
  authors_override: string[] | null;
  editors_override: string[] | null;
  designers_override: string[] | null;
  publisher_override: string | null;
  printer_override: string | null;
  materials_override: string | null;
  edition_override: string | null;
  publish_date_override: string | null;
  description_override: string | null;
  subjects_override: string[] | null;
  location: string | null;
  shelf: string | null;
  notes: string | null;
  trim_width: number | null;
  trim_height: number | null;
  trim_unit: string | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: {
    id: number;
    isbn10: string | null;
    isbn13: string | null;
    title: string | null;
    authors: string[] | null;
    publisher: string | null;
    publish_date: string | null;
    description: string | null;
    subjects: string[] | null;
    cover_url: string | null;
    raw: Record<string, unknown> | null;
  } | null;
  media: Array<{ id: number; kind: "cover" | "image"; storage_path: string; caption: string | null; created_at: string }>;
  book_tags: Array<{ tag: { id: number; name: string; kind: "tag" | "category" } | null }>;
  book_entities?: Array<{ role: FacetRole; position: number | null; entity: EntityRef | null }> | null;
};

type MetadataSearchResult = {
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
};

type ImportPreview = {
  title: string | null;
  authors: string[];
  editors: string[];
  designers: string[];
  printers: string[];
  publisher: string | null;
  publish_date: string | null;
  description: string | null;
  subjects: string[];
  isbn10: string | null;
  isbn13: string | null;
  cover_url: string | null;
  cover_candidates: string[];
  trim_width: number | null;
  trim_height: number | null;
  trim_unit: TrimUnit | null;
  sources: string[];
};

type MergeSource = {
  user_book_id: number;
  owner_id: string;
  owner_username: string | null;
  title_override: string | null;
  authors_override: string[] | null;
  editors_override: string[] | null;
  designers_override: string[] | null;
  publisher_override: string | null;
  printer_override: string | null;
  materials_override: string | null;
  edition_override: string | null;
  publish_date_override: string | null;
  description_override: string | null;
  subjects_override: string[] | null;
  pages: number | null;
  trim_width: number | null;
  trim_height: number | null;
  trim_unit: string | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

type FieldCandidate = { value: string; count: number };

type MergeFieldGroup = {
  key: string;
  label: string;
  localValue: string | null;
  candidates: FieldCandidate[];
  isArray: boolean;
};

function uniqStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = (v ?? "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function safeFileName(name: string): string {
  return name.trim().replace(/[^\w.\-]+/g, "_").slice(0, 120) || "image";
}

function toProxyImageUrl(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("blob:")) return raw;
  return `/api/image-proxy?url=${encodeURIComponent(raw)}`;
}

function toFullSizeImageUrl(url: string): string {
  let raw = (url ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("blob:")) return raw;

  try {
    const u = new URL(raw);
    
    // Strip common resizing parameters
    const paramsToStrip = ["h", "w", "fit", "compress", "resize", "width", "height", "scale", "quality", "format", "op"];
    paramsToStrip.forEach(p => u.searchParams.delete(p));

    // Specific service handling
    const host = u.hostname.toLowerCase();

    // Google Books
    if (host.includes("googleusercontent.com") || host.includes("books.google.com")) {
      u.searchParams.set("zoom", "0"); 
      u.searchParams.delete("edge");
    }

    // OpenLibrary
    if (host.includes("covers.openlibrary.org")) {
      u.pathname = u.pathname.replace(/-(S|M|small|medium)\.jpg$/i, "-L.jpg");
    }

    // Amazon
    if (host.includes("amazon.com") || host.includes("ssl-images-amazon.com")) {
      // Amazon thumbnails often have specific tags in the filename like ._SL160_ or ._SX100_
      // We want to strip the entire ._... section before the extension
      u.pathname = u.pathname.replace(/\._[A-Z0-9,_-]+\.(jpg|jpeg|png|gif|webp)$/i, ".$1");
    }

    // CloudFront / generic CDN thumbnails
    if (u.searchParams.has("width") || u.searchParams.has("height")) {
       u.searchParams.delete("width");
       u.searchParams.delete("height");
    }

    raw = u.toString();
  } catch {
    // ignore
  }

  return toProxyImageUrl(raw);
}

function onEnter(e: KeyboardEvent<HTMLInputElement>, fn: () => void) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  fn();
}

function aspectFrom(w: number, h: number): number {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 2 / 3;
  return w / h;
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

function facetHref(role: string, name: string): string {
  const mapping: Record<string, string> = {
    author: "author",
    subject: "subject",
    publisher: "publisher",
    designer: "designer",
    material: "material",
    category: "category",
    tag: "tag"
  };
  const param = mapping[role] || role;
  return `/app?${param}=${encodeURIComponent(name)}`;
}

function FacetLinks(props: { role: FacetRole; items: EntityRef[] }) {
  const { role, items } = props;
  return (
    <span>
      {items.map((e, idx) => (
        <span key={e.id}>
          <Link href={facetHref(role, e.name)}>{e.name}</Link>
          {idx < items.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

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

export default function BookDetailPage() {
  const router = useRouter();
  const params = useParams();
  const idParam = (params as any)?.id;
  const bookId = Number(Array.isArray(idParam) ? idParam[0] : idParam);
  const [isNarrow, setIsNarrow] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;
  const [memberCanEdit, setMemberCanEdit] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [findMoreOpen, setFindMoreOpen] = useState(false);
  const [coverToolsOpen, setCoverToolsOpen] = useState(false);
  const editSnapshotRef = useRef<{
    formTitle: string;
    formAuthors: string;
    formEditors: string;
    formDesigners: string;
    formPublisher: string;
    formPrinter: string;
    formMaterials: string;
    formEditionOverride: string;
    formPublishDate: string;
    formDescription: string;
    formGroupLabel: string;
    formObjectType: string;
    formDecade: string;
    formPages: string;
    formLocation: string;
    formShelf: string;
    formNotes: string;
    formVisibility: "inherit" | "followers_only" | "public";
    formStatus: "owned" | "loaned" | "selling" | "trading";
    formBorrowable: "inherit" | "yes" | "no";
    formLibraryId: number | null;
    facetDraft: Record<FacetRole, string[]>;
    formTrimWidth: string;
    formTrimHeight: string;
    formTrimUnit: TrimUnit;
    cropTrimWidth: string;
    cropTrimHeight: string;
    cropTrimUnit: TrimUnit | "ratio";
  } | null>(null);

  const [pendingCover, setPendingCover] = useState<File | null>(null);
  const [coverEditorSrc, setCoverEditorSrc] = useState<string | null>(null);
  const coverEditorObjectUrlRef = useRef<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState>({
    x: 0,
    y: 0,
    zoom: 1,
    rotation: 0,
    brightness: 1,
    contrast: 1
  });
  const [minZoomFloor, setMinZoomFloor] = useState<number>(1);
  const [coverState, setCoverState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [coverInputKey, setCoverInputKey] = useState(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<UserBookDetail | null>(null);
  const [mediaUrlsByPath, setMediaUrlsByPath] = useState<Record<string, string>>({});
  const [ownerProfile, setOwnerProfile] = useState<{ username: string; visibility: "followers_only" | "public" } | null>(null);
  const [ownerBorrowDefaults, setOwnerBorrowDefaults] = useState<{
    borrowable_default: boolean;
    borrow_request_scope: "anyone" | "followers" | "following";
  } | null>(null);
  const [shareState, setShareState] = useState<{ error: string | null; message: string | null }>({ error: null, message: null });
  const [copiesCount, setCopiesCount] = useState<number | null>(null);
  const [copiesCountState, setCopiesCountState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [libraries, setLibraries] = useState<Array<{ id: number; name: string; created_at: string }>>([]);
  const [libMemberPreviewsById, setLibMemberPreviewsById] = useState<Record<number, Array<{ userId: string; username: string; avatarUrl: string | null }>>>({});
  const [formLibraryId, setFormLibraryId] = useState<number | null>(null);
  const [libraryMoveState, setLibraryMoveState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [copiesDraft, setCopiesDraft] = useState<string>("");
  const [copiesUpdateState, setCopiesUpdateState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [formTitle, setFormTitle] = useState("");
  const [formAuthors, setFormAuthors] = useState("");
  const [formEditors, setFormEditors] = useState("");
  const [formDesigners, setFormDesigners] = useState("");
  const [formPublisher, setFormPublisher] = useState("");
  const [formPrinter, setFormPrinter] = useState("");
  const [formMaterials, setFormMaterials] = useState("");
  const [formEditionOverride, setFormEditionOverride] = useState("");
  const [formPublishDate, setFormPublishDate] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formGroupLabel, setFormGroupLabel] = useState("");
  const [formObjectType, setFormObjectType] = useState<string>("");
  const [formDecade, setFormDecade] = useState<string>("");
  const [formPages, setFormPages] = useState<string>("");
  const [formLocation, setFormLocation] = useState("");
  const [formShelf, setFormShelf] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formVisibility, setFormVisibility] = useState<"inherit" | "followers_only" | "public">("inherit");
  const [formStatus, setFormStatus] = useState<"owned" | "loaned" | "selling" | "trading">("owned");
  const [formBorrowable, setFormBorrowable] = useState<"inherit" | "yes" | "no">("inherit");
  const [formTrimWidth, setFormTrimWidth] = useState<string>("");
  const [formTrimHeight, setFormTrimHeight] = useState<string>("");
  const [formTrimUnit, setFormTrimUnit] = useState<TrimUnit>("in");
  // Crop-editor-local trim state; syncs to form only when cropTrimUnit is set.
  const [cropTrimWidth, setCropTrimWidth] = useState<string>("");
  const [cropTrimHeight, setCropTrimHeight] = useState<string>("");
  const [cropTrimUnit, setCropTrimUnit] = useState<TrimUnit | "ratio">("ratio");
  const [saveState, setSaveState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteState, setDeleteState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [facetDraft, setFacetDraft] = useState<Record<FacetRole, string[]>>({
    author: [],
    editor: [],
    designer: [],
    subject: [],
    tag: [],
    category: [],
    material: [],
    printer: [],
    publisher: []
  });

  const { scannerOpen, openScanner, closeScanner } = useBookScanner();
  const [showScan, setShowScan] = useState(false);
  useEffect(() => {
    setShowScan(navigator.maxTouchPoints > 0 && window.isSecureContext);
  }, []);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupInputFocused, setLookupInputFocused] = useState(false);
  const [linkState, setLinkState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [searchState, setSearchState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const lookupPageSize = 8;
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [lookupLimit, setLookupLimit] = useState(lookupPageSize);

  useEffect(() => {
    setLookupLimit(lookupPageSize);
  }, [searchResults]);

  const [importState, setImportState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMeta, setImportMeta] = useState<{ final_url: string | null; domain: string | null; domain_kind: string | null; scraped_sources: string[] }>({
    final_url: null,
    domain: null,
    domain_kind: null,
    scraped_sources: []
  });
  const [suggestedCoverUrl, setSuggestedCoverUrl] = useState<string | null>(null);
  const [suggestedCoverState, setSuggestedCoverState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [coverOriginalSrc, setCoverOriginalSrc] = useState<string | null>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [imagesState, setImagesState] = useState<{ busy: boolean; done: number; total: number; error: string | null; message: string | null }>({
    busy: false,
    done: 0,
    total: 0,
    error: null,
    message: null
  });
  const [imagesInputKey, setImagesInputKey] = useState(0);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const imageMedia = useMemo(() => (book?.media ?? []).filter((m) => m.kind === "image") ?? [], [book]);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowLeft") setLightboxIndex(prev => (prev !== null && prev > 0 ? prev - 1 : imageMedia.length - 1));
      if (e.key === "ArrowRight") {
        setLightboxIndex(prev => (prev !== null && prev < imageMedia.length - 1 ? prev + 1 : 0));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxIndex, imageMedia.length]);

  const [mergeSource, setMergeSource] = useState<MergeSource | null>(null);
  const [mergeState, setMergeState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [mergeAllSources, setMergeAllSources] = useState<MergeSource[]>([]);
  const [mergePanelOpen, setMergePanelOpen] = useState(false);
  const [mergeSelections, setMergeSelections] = useState<Record<string, string | null>>({});
  const [mergeCoverUrls, setMergeCoverUrls] = useState<Record<string, string>>({});
  const [mergeUndoSnapshot, setMergeUndoSnapshot] = useState<{
    fields: Record<string, unknown>;
    coverMedia: Array<{ storage_path: string; caption: string | null }>;
    hadCoverMerge: boolean;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const update = () => setIsNarrow(!!mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!pendingCover) return;
    const url = URL.createObjectURL(pendingCover);
    if (coverEditorObjectUrlRef.current) URL.revokeObjectURL(coverEditorObjectUrlRef.current);
    coverEditorObjectUrlRef.current = url;
    setCoverEditorSrc(url);
    setEditorState({
      x: 0,
      y: 0,
      zoom: 1.0, // fit-to-fill
      rotation: 0,
      brightness: 1,
      contrast: 1
    });
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [pendingCover]);

  useEffect(() => {
    return () => {
      if (coverEditorObjectUrlRef.current) {
        URL.revokeObjectURL(coverEditorObjectUrlRef.current);
        coverEditorObjectUrlRef.current = null;
      }
    };
  }, []);

  // Restore last-used crop unit from localStorage on first mount (when no book loaded yet).
  useEffect(() => {
    try {
      const stored = localStorage.getItem("om_trimUnit");
      if (stored === "in" || stored === "mm") setCropTrimUnit(stored);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Metadata panel W/H always syncs into the crop editor (spec: "always syncs to crop editor immediately").
  useEffect(() => {
    setCropTrimWidth(formTrimWidth);
    setCropTrimHeight(formTrimHeight);
  }, [formTrimWidth, formTrimHeight]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setEditMode(false);
  }, [bookId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !userId || !book?.library_id) {
        if (alive) setMemberCanEdit(false);
        return;
      }
      if (book.owner_id === userId) {
        if (alive) setMemberCanEdit(true);
        return;
      }
      const res = await supabase
        .from("catalog_members")
        .select("role")
        .eq("catalog_id", book.library_id)
        .eq("user_id", userId)
        .not("accepted_at", "is", null)
        .maybeSingle();
      if (!alive) return;
      const role = String((res.data as any)?.role ?? "").toLowerCase();
      setMemberCanEdit(!res.error && (role === "owner" || role === "editor"));
    })();
    return () => {
      alive = false;
    };
  }, [userId, book?.library_id, book?.owner_id]);

  useEffect(() => {
    if (!editMode) return;
    const el = descriptionTextareaRef.current;
    if (!el) return;
    try {
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    } catch {
      // ignore
    }
  }, [editMode, formDescription]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Ensure navigation to a new detail page always starts at the top on mobile.
    window.scrollTo(0, 0);
  }, [bookId]);

  useEffect(() => {
    // Avoid briefly showing stale data when navigating between book detail pages.
    setError(null);
    setBook(null);
    setMediaUrlsByPath({});
    setOwnerProfile(null);
    setOwnerBorrowDefaults(null);
    setMergeSource(null);
    setShareState({ error: null, message: null });
    setCopiesCount(null);
    setCopiesCountState({ busy: false, error: null });
  }, [bookId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) return;
      if (!userId) {
        setLibraries([]);
        return;
      }
      if (!book || !(book.owner_id === userId || memberCanEdit)) {
        setLibraries([]);
        return;
      }
      const ownRes = await supabase.from("libraries").select("id,name,created_at").eq("owner_id", userId).order("created_at", { ascending: true });
      if (!alive) return;
      if (!ownRes.error) {
        setLibraries((ownRes.data ?? []) as any);
        return;
      }
      const currentRes = await supabase.from("libraries").select("id,name,created_at").eq("id", book.library_id).maybeSingle();
      if (!alive) return;
      if (currentRes.error || !currentRes.data) {
        setLibraries([]);
        return;
      }
      setLibraries([currentRes.data as any]);
    })();
    return () => {
      alive = false;
    };
  }, [userId, book?.owner_id, book?.library_id, memberCanEdit]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !userId || !formLibraryId) {
        setLibMemberPreviewsById({});
        return;
      }
      const membersRes = await supabase
        .from("catalog_members")
        .select("catalog_id,user_id,accepted_at")
        .eq("catalog_id", formLibraryId)
        .not("accepted_at", "is", null);
      if (!alive) return;
      const memberRows = (membersRes.error ? [] : ((membersRes.data ?? []) as any[])).filter((r) => String(r.user_id) !== userId);
      const memberIds = Array.from(new Set(memberRows.map((r: any) => String(r.user_id)).filter(Boolean)));
      let profileById: Record<string, { username: string; avatar_path: string | null }> = {};
      if (memberIds.length > 0) {
        const pr = await supabase.from("profiles").select("id,username,avatar_path").in("id", memberIds);
        if (!alive) return;
        if (!pr.error) {
          profileById = Object.fromEntries(
            ((pr.data ?? []) as any[]).map((p) => [String(p.id), { username: String(p.username ?? ""), avatar_path: p.avatar_path ? String(p.avatar_path) : null }])
          );
        }
      }
      const avatarByPath: Record<string, string> = {};
      const avatarPaths = Array.from(new Set(Object.values(profileById).map((p) => (p.avatar_path ?? "").trim()).filter(Boolean)));
      const directUrls = avatarPaths.filter((p) => /^https?:\/\//i.test(p));
      for (const p of directUrls) avatarByPath[p] = p;
      const storagePaths = avatarPaths.filter((p) => !/^https?:\/\//i.test(p));
      if (storagePaths.length > 0) {
        const signed = await supabase.storage.from("avatars").createSignedUrls(storagePaths, 60 * 30);
        if (!alive) return;
        if (!signed.error && Array.isArray(signed.data)) {
          for (const row of signed.data) {
            if (row.path && row.signedUrl) avatarByPath[row.path] = row.signedUrl;
          }
        }
      }
      const previews = memberRows
        .sort((a: any, b: any) => Date.parse(String(a.accepted_at ?? "")) - Date.parse(String(b.accepted_at ?? "")))
        .map((r: any) => {
          const uid = String(r.user_id);
          const prof = profileById[uid];
          if (!prof?.username) return null;
          return { userId: uid, username: prof.username, avatarUrl: prof.avatar_path ? avatarByPath[prof.avatar_path] ?? null : null };
        })
        .filter(Boolean) as Array<{ userId: string; username: string; avatarUrl: string | null }>;
      if (!alive) return;
      setLibMemberPreviewsById({ [formLibraryId]: previews });
    })();
    return () => { alive = false; };
  }, [formLibraryId, userId]);

  async function refresh() {
    if (!supabase) return;
    if (!Number.isFinite(bookId) || bookId <= 0) return;
    setBusy(true);
    setError(null);
    setCoverOriginalSrc(null);
    setSuggestedCoverUrl(null);
    setOwnerProfile(null);
    setOwnerBorrowDefaults(null);
    setMergeSource(null);
    setMergeState({ busy: false, error: null, message: null });
    setCopiesCount(null);
    setCopiesCountState({ busy: false, error: null });
    try {
      const baseNew =
        "id,owner_id,library_id,visibility,status,borrowable_override,borrow_request_scope_override,group_label,object_type,decade,pages,trim_width,trim_height,trim_unit,cover_original_url,cover_crop,title_override,authors_override,editors_override,designers_override,publisher_override,printer_override,materials_override,edition_override,publish_date_override,description_override,subjects_override,location,shelf,notes,edition:editions(id,isbn10,isbn13,title,authors,publisher,publish_date,description,subjects,cover_url,raw),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))";
      const baseOld =
        "id,owner_id,library_id,visibility,status,borrowable_override,borrow_request_scope_override,title_override,authors_override,editors_override,designers_override,publisher_override,printer_override,materials_override,edition_override,publish_date_override,description_override,subjects_override,location,shelf,notes,edition:editions(id,isbn10,isbn13,title,authors,publisher,publish_date,description,subjects,cover_url,raw),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))";

      const entitiesSelect = ",book_entities:book_entities(role,position,entity:entities(id,name,slug))";
      const selectNew = baseNew + entitiesSelect;
      const selectOld = baseOld + entitiesSelect;

      let res = await supabase.from("user_books").select(selectNew).eq("id", bookId).maybeSingle();
      if (res.error) {
        const msg = (res.error.message ?? "").toLowerCase();
        if (msg.includes("trim_width") && msg.includes("does not exist")) {
          // trim_width (and possibly cover_original_url/cover_crop) not yet added; strip them and retry.
          const noTrim = (s: string) => s.replace(",trim_width,trim_height,trim_unit,cover_original_url,cover_crop", "").replace(",cover_crop", "");
          res = await supabase.from("user_books").select(noTrim(selectNew)).eq("id", bookId).maybeSingle();
          if (res.error) {
            const msg2 = (res.error.message ?? "").toLowerCase();
            if ((msg2.includes("book_entities") || msg2.includes("entities")) && msg2.includes("does not exist")) {
              res = await supabase.from("user_books").select(noTrim(baseNew)).eq("id", bookId).maybeSingle();
            }
          }
        } else if (msg.includes("cover_crop") && msg.includes("does not exist")) {
          // cover_crop column not yet added; strip it and retry.
          const noCrop = (s: string) => s.replace(",cover_crop", "");
          res = await supabase.from("user_books").select(noCrop(selectNew)).eq("id", bookId).maybeSingle();
        } else if (msg.includes("cover_original_url") && msg.includes("does not exist")) {
          // cover_original_url column not yet added; strip it and retry.
          const noCoverOrig = (s: string) => s.replace(",cover_original_url", "").replace(",cover_crop", "");
          res = await supabase.from("user_books").select(noCoverOrig(selectNew)).eq("id", bookId).maybeSingle();
        } else if ((msg.includes("book_entities") || msg.includes("entities")) && (res.error.message ?? "").toLowerCase().includes("does not exist")) {
          res = await supabase.from("user_books").select(baseNew).eq("id", bookId).maybeSingle();
        } else if (msg.includes("group_label") && msg.includes("does not exist")) {
          res = await supabase.from("user_books").select(selectOld).eq("id", bookId).maybeSingle();
          if (res.error) {
            const msg2 = (res.error.message ?? "").toLowerCase();
            if ((msg2.includes("book_entities") || msg2.includes("entities")) && msg2.includes("does not exist")) {
              res = await supabase.from("user_books").select(baseOld).eq("id", bookId).maybeSingle();
            }
          }
        }
      }
      if (res.error) throw new Error(res.error.message);
      const row = (res.data ?? null) as any as UserBookDetail | null;
      if (!row) {
        setBook(null);
        setError("Not found (or not visible).");
        return;
      }

      setBook(row);

      const nextFacets: Record<FacetRole, string[]> = {
        author: [],
        editor: [],
        designer: [],
        subject: [],
        tag: [],
        category: [],
        material: [],
        printer: [],
        publisher: []
      };

      const entityRows = ((row as any).book_entities as Array<{ role: FacetRole; position: number | null; entity: EntityRef | null }> | null) ?? [];
      if (entityRows.length > 0) {
        const sorted = entityRows
          .filter((r) => r?.role && r?.entity?.name)
          .slice()
          .sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));
        for (const r of sorted) {
          const role = r.role;
          const name = String(r.entity!.name ?? "").trim();
          if (!name) continue;
          const existing = nextFacets[role] ?? [];
          if (!existing.some((x) => x.toLowerCase() === name.toLowerCase())) existing.push(name);
          nextFacets[role] = existing;
        }
      } else {
        // Fallback to legacy fields/tables when entities aren't present yet.
        const authorsFallback =
          row.authors_override && row.authors_override.length > 0 ? row.authors_override : ((row.edition?.authors ?? []) as string[]);
        const subjectsFallback = row.subjects_override !== null && row.subjects_override !== undefined ? row.subjects_override : (row.edition?.subjects ?? []);
        nextFacets.author = (authorsFallback ?? []).filter(Boolean);
        nextFacets.editor = (row.editors_override ?? []).filter(Boolean);
        nextFacets.designer = (row.designers_override ?? []).filter(Boolean);
        nextFacets.subject = (subjectsFallback ?? []).filter(Boolean);
        const publisherFallback = String(row.publisher_override ?? row.edition?.publisher ?? "").trim();
        if (publisherFallback) nextFacets.publisher = [publisherFallback];
        const printerFallback = String(row.printer_override ?? "").trim();
        if (printerFallback) nextFacets.printer = [printerFallback];
        const materialFallback = String(row.materials_override ?? "").trim();
        if (materialFallback) nextFacets.material = [materialFallback];
        const tagRows = ((row as any).book_tags ?? []) as any[];
        const tagsFallback = tagRows.map((bt) => bt?.tag).filter(Boolean);
        nextFacets.tag = tagsFallback.filter((t) => t.kind === "tag").map((t) => String(t.name)).filter(Boolean);
        nextFacets.category = tagsFallback.filter((t) => t.kind === "category").map((t) => String(t.name)).filter(Boolean);
      }

      setFacetDraft(nextFacets);

      setFormTitle(row.title_override ?? "");
      setFormAuthors((nextFacets.author ?? []).join(", "));
      setFormEditors((nextFacets.editor ?? []).join(", "));
      setFormDesigners((nextFacets.designer ?? []).join(", "));
      setFormPublisher((nextFacets.publisher?.[0] ?? row.publisher_override ?? row.edition?.publisher ?? "").trim());
      setFormPrinter((nextFacets.printer?.[0] ?? row.printer_override ?? "").trim());
      setFormMaterials((nextFacets.material?.[0] ?? row.materials_override ?? "").trim());
      setFormEditionOverride(row.edition_override ?? "");
      setFormPublishDate(row.publish_date_override ?? row.edition?.publish_date ?? "");
      setFormDescription(row.description_override ?? row.edition?.description ?? "");
      setFormGroupLabel(((row as any).group_label ?? "") as any);
      setFormObjectType(String((row as any).object_type ?? "").trim());
      setFormDecade(String((row as any).decade ?? "").trim());
      setFormPages((row as any).pages ? String((row as any).pages) : "");
      setFormLocation(row.location ?? "");
      setFormShelf(row.shelf ?? "");
      setFormNotes(row.notes ?? "");
      const loadedTrimW = row.trim_width != null ? String(row.trim_width) : "";
      const loadedTrimH = row.trim_height != null ? String(row.trim_height) : "";
      const loadedTrimU: TrimUnit = (row.trim_unit as TrimUnit | null) === "mm" ? "mm" : "in";
      setFormTrimWidth(loadedTrimW);
      setFormTrimHeight(loadedTrimH);
      setFormTrimUnit(loadedTrimU);
      setCropTrimWidth(loadedTrimW);
      setCropTrimHeight(loadedTrimH);
      // Crop unit: prefer book's stored unit; fall back to localStorage; fall back to "ratio".
      let initCropUnit: TrimUnit | "ratio" = "ratio";
      if (row.trim_unit === "in" || row.trim_unit === "mm") {
        initCropUnit = row.trim_unit;
      } else {
        try {
          const stored = localStorage.getItem("om_trimUnit");
          if (stored === "in" || stored === "mm") initCropUnit = stored;
        } catch { /* ignore */ }
      }
      setCropTrimUnit(initCropUnit);
      setFormVisibility(row.visibility);
      setFormStatus(row.status);
      setFormLibraryId((row as any).library_id ?? null);
      setFormBorrowable(row.borrowable_override === null || row.borrowable_override === undefined ? "inherit" : row.borrowable_override ? "yes" : "no");

      setSearchResults([]);
      setSearchState({ busy: false, error: null, message: null });
      setLinkState({ busy: false, error: null, message: null });

      const ownerId = row.owner_id as string | undefined;
      if (ownerId) {
        const profileRes = await supabase
          .from("profiles")
          .select("username,visibility,borrowable_default,borrow_request_scope")
          .eq("id", ownerId)
          .maybeSingle();
        if (!profileRes.error && profileRes.data?.username) {
          setOwnerProfile({ username: profileRes.data.username, visibility: profileRes.data.visibility as any });
          const rawScope = String((profileRes.data as any).borrow_request_scope ?? "").trim();
          const normalizedScope = (rawScope === "anyone" ? "anyone" : rawScope === "following" ? "following" : "followers") as
            | "anyone"
            | "followers"
            | "following";
          setOwnerBorrowDefaults({
            borrowable_default: Boolean((profileRes.data as any).borrowable_default),
            borrow_request_scope: normalizedScope
          });
        }
      }

      if (ownerId) {
        setCopiesCountState({ busy: true, error: null });
        try {
          const countWithinLibrary = userId && ownerId === userId ? ((row as any).library_id as number | null) : null;
          if (row.edition?.id) {
            let q = supabase
              .from("user_books")
              .select("id", { count: "exact", head: true })
              .eq("owner_id", ownerId)
              .eq("edition_id", row.edition.id);
            if (countWithinLibrary) q = q.eq("library_id", countWithinLibrary);
            const countRes = await q;
            if (countRes.error) throw new Error(countRes.error.message);
            setCopiesCount(countRes.count ?? 0);
            if (userId && ownerId === userId) setCopiesDraft(String(countRes.count ?? 0));
          } else {
            let q = supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).is("edition_id", null);
            if (countWithinLibrary) q = q.eq("library_id", countWithinLibrary);
            if (row.title_override) q = q.eq("title_override", row.title_override);
            else q = q.is("title_override", null);
            if (row.authors_override && row.authors_override.length > 0) q = q.eq("authors_override", row.authors_override);
            else q = q.is("authors_override", null);
            const countRes = await q;
            if ((countRes as any).error) throw new Error((countRes as any).error.message);
            setCopiesCount((countRes as any).count ?? 0);
            if (userId && ownerId === userId) setCopiesDraft(String((countRes as any).count ?? 0));
          }
          setCopiesCountState({ busy: false, error: null });
        } catch (e: any) {
          setCopiesCountState({ busy: false, error: e?.message ?? "Failed to count copies" });
        }
      }

      const origStoragePath = typeof row.cover_original_url === "string" && row.cover_original_url ? row.cover_original_url : null;
      const paths = Array.from(
        new Set([
          ...(row.media ?? [])
            .map((m) => (typeof m?.storage_path === "string" ? m.storage_path : ""))
            .filter(Boolean),
          ...(origStoragePath ? [origStoragePath] : [])
        ])
      );
      if (paths.length > 0) {
        const signedRes = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 60);
        const next: Record<string, string> = {};
        for (const s of signedRes.data ?? []) {
          if (s.path && s.signedUrl) next[s.path] = s.signedUrl;
        }
        setMediaUrlsByPath(next);
        if (origStoragePath && next[origStoragePath]) {
          setCoverOriginalSrc(toFullSizeImageUrl(next[origStoragePath]));
        }
      }

      // If you own this book and it's missing key metadata/media, look for a visible "source" to merge from.
      try {
        if (userId && row.owner_id === userId && row.edition?.id) {
          const hasCoverMedia = (row.media ?? []).some((m) => m.kind === "cover");
          const hasAnyImages = (row.media ?? []).some((m) => m.kind === "image");

          const missingTitle = !(row.title_override ?? "").trim();
          const missingAuthors = (!row.authors_override || row.authors_override.length === 0) && (!row.edition.authors || row.edition.authors.length === 0);
          const missingPublisher = !row.publisher_override && !row.edition.publisher;
          const missingPublishDate = !row.publish_date_override && !row.edition.publish_date;
          const missingDescription = !row.description_override && !row.edition.description;
          const missingSubjects = (!row.subjects_override || row.subjects_override.length === 0) && (!row.edition.subjects || row.edition.subjects.length === 0);
          const missingEditors = !row.editors_override || row.editors_override.length === 0;
          const missingDesigners = !row.designers_override || row.designers_override.length === 0;
          const missingPrinter = !row.printer_override;
          const missingMaterials = !row.materials_override;
          const missingEditionOverride = !row.edition_override;
          const missingPages = !row.pages;
          const missingTrim = !row.trim_width || !row.trim_height;

          const needsAny =
            !hasCoverMedia || !hasAnyImages ||
            missingTitle || missingAuthors || missingPublisher || missingPublishDate ||
            missingDescription || missingSubjects ||
            missingEditors || missingDesigners || missingPrinter ||
            missingMaterials || missingEditionOverride ||
            missingPages || missingTrim;

          if (needsAny) {
            const cand = await supabase
              .from("user_books")
              .select(
                "id,owner_id,title_override,authors_override,editors_override,designers_override,publisher_override,printer_override,materials_override,edition_override,publish_date_override,description_override,subjects_override,pages,trim_width,trim_height,trim_unit,media:user_book_media(kind,storage_path)"
              )
              .eq("edition_id", row.edition.id)
              .neq("id", row.id)
              .limit(50);
            if (!cand.error) {
              const candRows = (cand.data ?? []) as any[];
              const allSources: MergeSource[] = candRows.map((r) => ({
                user_book_id: r.id as number,
                owner_id: r.owner_id as string,
                owner_username: null,
                title_override: r.title_override ?? null,
                authors_override: (r.authors_override ?? null) as any,
                editors_override: (r.editors_override ?? null) as any,
                designers_override: (r.designers_override ?? null) as any,
                publisher_override: r.publisher_override ?? null,
                printer_override: r.printer_override ?? null,
                materials_override: r.materials_override ?? null,
                edition_override: r.edition_override ?? null,
                publish_date_override: r.publish_date_override ?? null,
                description_override: r.description_override ?? null,
                subjects_override: (r.subjects_override ?? null) as any,
                pages: r.pages ?? null,
                trim_width: r.trim_width ?? null,
                trim_height: r.trim_height ?? null,
                trim_unit: r.trim_unit ?? null,
                media: ((r.media ?? []) as any[])
                  .filter((m) => (m.kind === "cover" || m.kind === "image") && typeof m.storage_path === "string" && m.storage_path)
                  .map((m) => ({ kind: m.kind as "cover" | "image", storage_path: m.storage_path as string }))
              }));
              if (allSources.length > 0) {
                setMergeAllSources(allSources);
                setMergeSource(allSources[0] ?? null);
                // Sign URLs for community cover media so panel can render images
                const coverPaths = [...new Set(
                  allSources.flatMap((s) => s.media.filter((m) => m.kind === "cover").map((m) => m.storage_path))
                )];
                if (coverPaths.length > 0) {
                  const sigs = await supabase.storage.from("user-book-media").createSignedUrls(coverPaths, 60 * 60);
                  const coverUrlMap: Record<string, string> = {};
                  for (const d of sigs.data ?? []) {
                    if (d.path && d.signedUrl) coverUrlMap[d.path] = d.signedUrl;
                  }
                  setMergeCoverUrls(coverUrlMap);
                }
              }
            }
          }
        }
      } catch {
        // best-effort only
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load book");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      await refresh();
      setInitialLoadDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, userId]);

  const effectiveTitle = useMemo(() => {
    return formTitle.trim() ? formTitle.trim() : book?.edition?.title ?? "(untitled)";
  }, [formTitle, book]);

  const effectivePublisher = useMemo(() => {
    const fromFacet = (facetDraft.publisher?.[0] ?? "").trim();
    if (fromFacet) return fromFacet;
    return formPublisher.trim() ? formPublisher.trim() : book?.edition?.publisher ?? "";
  }, [facetDraft.publisher, formPublisher, book]);

  const effectivePublishDate = useMemo(() => {
    return formPublishDate.trim() ? formPublishDate.trim() : book?.edition?.publish_date ?? "";
  }, [formPublishDate, book]);
  const displayPublishDate = useMemo(() => formatDateShort(effectivePublishDate || null), [effectivePublishDate]);

  const effectiveDescription = useMemo(() => {
    return formDescription.trim() ? formDescription.trim() : book?.edition?.description ?? "";
  }, [formDescription, book]);

  const effectiveAuthors = useMemo(() => {
    if ((facetDraft.author ?? []).length > 0) return uniqStrings(facetDraft.author);
    const override = parseAuthorsInput(formAuthors);
    if (override.length > 0) return override;
    return (book?.edition?.authors ?? []).filter(Boolean);
  }, [facetDraft.author, formAuthors, book]);

  const effectiveEditors = useMemo(() => {
    if ((facetDraft.editor ?? []).length > 0) return uniqStrings(facetDraft.editor);
    return parseAuthorsInput(formEditors);
  }, [facetDraft.editor, formEditors]);
  const effectiveDesigners = useMemo(() => {
    if ((facetDraft.designer ?? []).length > 0) return uniqStrings(facetDraft.designer);
    return parseAuthorsInput(formDesigners);
  }, [facetDraft.designer, formDesigners]);

  const isOwner = Boolean(book && userId && (book.owner_id === userId || memberCanEdit));

  const copiesLabel = useMemo(() => {
    if (!book?.owner_id) return "Copies";
    if (userId && book.owner_id === userId) return "Your copies";
    return "Copies";
  }, [book?.owner_id, userId]);
  const showNotesSection = editMode || Boolean((formNotes ?? "").trim());
  const showLocationSection = editMode || Boolean((formLocation ?? "").trim());
  const showShelfSection = editMode || Boolean((formShelf ?? "").trim());
  const showLocationBlock = showLocationSection || showShelfSection;

  const effectiveSubjects = useMemo(() => {
    if ((facetDraft.subject ?? []).length > 0) return uniqStrings(facetDraft.subject);
    const override = book?.subjects_override;
    if (override !== null && override !== undefined) return (override ?? []).filter(Boolean);
    return (book?.edition?.subjects ?? []).filter(Boolean);
  }, [facetDraft.subject, book]);

  const tags = useMemo(() => {
    const all = ((book?.book_tags ?? []).map((bt) => bt.tag).filter(Boolean) as any[]).filter((t) => t?.id && t?.name);
    return all
      .filter((t) => t.kind === "tag")
      .map((t) => ({ id: t.id as number, name: String(t.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [book]);

  const mergeFieldGroups = useMemo((): MergeFieldGroup[] => {
    if (!book || mergeAllSources.length === 0) return [];

    function normalizeUrl(url: string | null | undefined): string {
      if (!url) return "";
      try {
        const u = new URL(url);
        u.search = "";
        u.hash = "";
        return u.toString().toLowerCase().trim();
      } catch {
        return (url ?? "").trim().toLowerCase();
      }
    }

    function aggregateStr(key: keyof MergeSource, localValues: Array<string | null | undefined>): MergeFieldGroup | null {
      const normalizedLocals = new Set(localValues.map(v => (v ?? "").trim().toLowerCase()).filter(Boolean));
      const counts: Record<string, number> = {};
      for (const s of mergeAllSources) {
        const v = (s[key] as string | null)?.trim();
        if (!v) continue;
        if (normalizedLocals.has(v.toLowerCase())) continue;
        counts[v] = (counts[v] ?? 0) + 1;
      }
      const candidates: FieldCandidate[] = Object.entries(counts)
        .sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b))
        .slice(0, 4)
        .map(([value, count]) => ({ value, count }));
      if (candidates.length === 0) return null;
      return { key: String(key), label: "", localValue: (localValues[0] ?? "").trim() || null, candidates, isArray: false };
    }

    function aggregateArr(key: keyof MergeSource, localVal: string[] | null | undefined): MergeFieldGroup | null {
      const localSet = new Set((localVal ?? []).filter(Boolean).map((v) => v.toLowerCase()));
      const localJoined = (localVal ?? []).filter(Boolean).join(", ");
      const counts: Record<string, number> = {};
      for (const s of mergeAllSources) {
        const arr = s[key] as string[] | null;
        if (!Array.isArray(arr) || arr.length === 0) continue;
        for (const item of arr) {
          const v = item?.trim();
          if (!v) continue;
          if (localSet.has(v.toLowerCase())) continue;
          counts[v] = (counts[v] ?? 0) + 1;
        }
      }
      const candidates: FieldCandidate[] = Object.entries(counts)
        .sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b))
        .slice(0, 4)
        .map(([value, count]) => ({ value, count }));
      if (candidates.length === 0) return null;
      return { key: String(key), label: "", localValue: localJoined || null, candidates, isArray: true };
    }

    const groups: MergeFieldGroup[] = [];

    function pushStr(key: keyof MergeSource, label: string, localValues: Array<string | null | undefined>) {
      const g = aggregateStr(key, localValues);
      if (g) groups.push({ ...g, label });
    }
    function pushArr(key: keyof MergeSource, label: string, localVal: string[] | null | undefined) {
      const g = aggregateArr(key, localVal);
      if (g) groups.push({ ...g, label });
    }

    // Cover — compare community candidate cover_url against current cover_url (normalized).
    const hasCover = book.media.some((m) => m.kind === "cover");
    const localCoverUrl = book.edition?.cover_url;
    const localCoverOrig = book.cover_original_url;
    const normLocalCover = normalizeUrl(localCoverUrl);
    const normLocalOrig = normalizeUrl(localCoverOrig);

    const userCoverPaths = book.media.filter((m) => m.kind === "cover").map((m) => m.storage_path);
    const userCoverSourceFilenames = new Set<string>();
    for (const p of userCoverPaths) {
      const filename = p.split("/").pop() ?? "";
      const m = filename.match(/^merge-\d+-(.+)$/);
      userCoverSourceFilenames.add(m ? m[1] : filename);
    }

    const coverPathCounts: Record<string, number> = {};
    for (const s of mergeAllSources) {
      for (const m of s.media) {
        if (m.kind !== "cover") continue;
        const communityFilename = m.storage_path.split("/").pop() ?? "";
        if (userCoverSourceFilenames.has(communityFilename)) continue; 
        if (userCoverPaths.includes(m.storage_path)) continue; 

        // Also check against normalized URLs if available in mergeCoverUrls
        const signedUrl = mergeCoverUrls[m.storage_path];
        if (signedUrl) {
          const normCommunity = normalizeUrl(signedUrl);
          if (normLocalCover && normCommunity === normLocalCover) continue;
          if (normLocalOrig && normCommunity === normLocalOrig) continue;
        }

        coverPathCounts[m.storage_path] = (coverPathCounts[m.storage_path] ?? 0) + 1;
      }
    }
    const coverCandidates = Object.entries(coverPathCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([value, count]) => ({ value, count }));
    if (coverCandidates.length > 0) {
      groups.push({ key: "cover", label: "Cover", localValue: hasCover ? "exists" : null, candidates: coverCandidates, isArray: true });
    }

    // Metadata fields in page order
    pushStr("title_override",        "Title",        [book.title_override, book.edition?.title]);
    pushArr("authors_override",       "Authors",      book.authors_override ?? book.edition?.authors);
    pushArr("editors_override",       "Editors",      book.editors_override);
    pushArr("designers_override",     "Designers",    book.designers_override);
    pushStr("printer_override",       "Printer",      [book.printer_override]);
    pushStr("materials_override",     "Materials",    [book.materials_override]);
    pushStr("edition_override",       "Edition",      [book.edition_override]);
    pushStr("publisher_override",     "Publisher",    [book.publisher_override, book.edition?.publisher]);
    pushStr("publish_date_override",  "Publish date", [book.publish_date_override, book.edition?.publish_date]);

    // Pages
    const localPages = book.pages ? String(book.pages) : null;
    const pageCounts: Record<string, number> = {};
    for (const s of mergeAllSources) {
      if (!s.pages) continue;
      const v = String(s.pages);
      if (localPages && v === localPages) continue;
      pageCounts[v] = (pageCounts[v] ?? 0) + 1;
    }
    const pageCandidates = Object.entries(pageCounts)
      .sort(([, ca], [, cb]) => cb - ca)
      .slice(0, 4)
      .map(([value, count]) => ({ value, count }));
    if (pageCandidates.length > 0) {
      groups.push({ key: "pages", label: "Pages", localValue: localPages, candidates: pageCandidates, isArray: false });
    }

    // Trim size
    const localTrim = (book.trim_width && book.trim_height)
      ? `${book.trim_width} × ${book.trim_height}${book.trim_unit ? ` ${book.trim_unit}` : ""}`
      : null;
    const trimCounts: Record<string, number> = {};
    for (const s of mergeAllSources) {
      if (!s.trim_width || !s.trim_height) continue;
      const v = `${s.trim_width} × ${s.trim_height}${s.trim_unit ? ` ${s.trim_unit}` : ""}`;
      if (localTrim && v === localTrim) continue;
      trimCounts[v] = (trimCounts[v] ?? 0) + 1;
    }
    const trimCandidates = Object.entries(trimCounts)
      .sort(([, ca], [, cb]) => cb - ca)
      .slice(0, 4)
      .map(([value, count]) => ({ value, count }));
    if (trimCandidates.length > 0) {
      groups.push({ key: "trim", label: "Trim size", localValue: localTrim, candidates: trimCandidates, isArray: false });
    }

    pushArr("subjects_override",     "Subjects",     book.subjects_override ?? book.edition?.subjects);
    pushStr("description_override",  "Description",  [book.description_override, book.edition?.description]);

    return groups;
  }, [book, mergeAllSources]);

  const updatesCount = useMemo(() => mergeFieldGroups.length, [mergeFieldGroups]);

  const categories = useMemo(() => {
    const all = ((book?.book_tags ?? []).map((bt) => bt.tag).filter(Boolean) as any[]).filter((t) => t?.id && t?.name);
    return all
      .filter((t) => t.kind === "category")
      .map((t) => ({ id: t.id as number, name: String(t.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [book]);

  function slugifyFallback(input: string): string {
    const s = String(input ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "");
    return s;
  }

  const facetView = useMemo(() => {
    const out: Record<FacetRole, EntityRef[]> = {
      author: [],
      editor: [],
      designer: [],
      subject: [],
      tag: [],
      category: [],
      material: [],
      printer: [],
      publisher: []
    };

    const rows = ((book?.book_entities ?? []) as Array<{ role: FacetRole; position: number | null; entity: EntityRef | null }> | null) ?? [];
    const sorted = rows
      .filter((r) => r?.role && r?.entity?.name && r?.entity?.slug)
      .slice()
      .sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));
    for (const r of sorted) {
      const role = r.role;
      const ent = r.entity!;
      if (out[role]) {
        out[role].push({ id: ent.id, name: ent.name, slug: ent.slug });
      }
    }

    // Supplement with fallback slugs generated from effective variables for any roles that are missing local overrides.
    // This ensures that even designers/editors added via CSV (stored in overrides) are clickable.
    const supplement = (role: FacetRole, names: string[]) => {
      for (const name of names) {
        const normalized = name.trim();
        if (!normalized) continue;
        // If we already have this name in out[role] from DB rows, skip it
        if (out[role].some((existing) => existing.name.toLowerCase() === normalized.toLowerCase())) continue;

        const slug = slugifyFallback(normalized) || slugifyFallback(`${role}-${normalized}`);
        out[role].push({ id: `${role}:${slug}`, name: normalized, slug });
      }
    };

    supplement("author", effectiveAuthors);
    supplement("editor", effectiveEditors);
    supplement("designer", effectiveDesigners);
    supplement("subject", effectiveSubjects);
    supplement("tag", tags.map((t) => t.name));
    supplement("category", categories.map((t) => t.name));

    if (effectivePublisher.trim()) {
      supplement("publisher", [effectivePublisher.trim()]);
    }

    const printerName = (facetDraft.printer?.[0] ?? formPrinter).trim();
    if (printerName) supplement("printer", [printerName]);

    const materialName = (facetDraft.material?.[0] ?? formMaterials).trim();
    if (materialName) supplement("material", [materialName]);

    return out;
  }, [
    book?.book_entities,
    categories,
    effectiveAuthors,
    effectiveDesigners,
    effectiveEditors,
    effectivePublisher,
    effectiveSubjects,
    facetDraft.material,
    facetDraft.printer,
    formMaterials,
    formPrinter,
    tags
  ]);

  const coverMedia = useMemo(() => (book?.media ?? []).find((m) => m.kind === "cover") ?? null, [book]);
  const coverUrl = coverMedia ? mediaUrlsByPath[coverMedia.storage_path] : suggestedCoverUrl ?? book?.edition?.cover_url ?? null;

  // Used by metadata panel to decide whether to show the computed display value.
  const trimSizeValid = useMemo(
    () => isValidTrimSize(formTrimWidth, formTrimHeight, formTrimUnit),
    [formTrimWidth, formTrimHeight, formTrimUnit]
  );

  // True when crop W/H are valid positive numbers (regardless of unit mode).
  const cropTrimSizeValid = useMemo(() => {
    const w = parseFloat(cropTrimWidth);
    const h = parseFloat(cropTrimHeight);
    return Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
  }, [cropTrimWidth, cropTrimHeight]);

  const coverAspect = useMemo(() => {
    if (cropTrimSizeValid) {
      return parseFloat(cropTrimWidth) / parseFloat(cropTrimHeight);
    }
    return undefined; // Free aspect
  }, [cropTrimSizeValid, cropTrimWidth, cropTrimHeight]);

  const publicBookPath = useMemo(() => {
    if (!book || !ownerProfile?.username) return null;
    return `/u/${ownerProfile.username}/b/${bookIdSlug(book.id, effectiveTitle)}`;
  }, [book, ownerProfile, effectiveTitle]);

  const publicBookUrl = useMemo(() => {
    if (!publicBookPath) return null;
    if (typeof window === "undefined") return publicBookPath;
    try {
      const url = new URL(window.location.origin);
      if (url.hostname.startsWith("app.")) {
        url.hostname = url.hostname.slice("app.".length);
      }
      return `${url.origin}${publicBookPath}`;
    } catch {
      return publicBookPath;
    }
  }, [publicBookPath]);

  const isPubliclyVisible = useMemo(() => {
    if (!book) return false;
    if (book.visibility === "public") return true;
    if (book.visibility === "inherit" && ownerProfile?.visibility === "public") return true;
    return false;
  }, [book, ownerProfile]);

  const editionId = useMemo(() => {
    return book?.edition?.id ?? null;
  }, [book]);

  async function copyPublicLink() {
    if (!publicBookUrl) return;
    setShareState({ error: null, message: null });
    try {
      await navigator.clipboard.writeText(publicBookUrl);
      setShareState({ error: null, message: "Copied" });
      window.setTimeout(() => setShareState({ error: null, message: null }), 1500);
    } catch (e: any) {
      setShareState({ error: e?.message ?? "Copy failed", message: "Copy failed" });
    }
  }

  /** Metadata panel unit toggle: converts values and syncs formTrimUnit. */
  function handleTrimUnitChange(newUnit: TrimUnit) {
    if (newUnit === formTrimUnit) return;
    const w = parseFloat(formTrimWidth);
    const h = parseFloat(formTrimHeight);
    const nextW = Number.isFinite(w) && w > 0 ? String(convertTrimUnit(w, formTrimUnit, newUnit)) : formTrimWidth;
    const nextH = Number.isFinite(h) && h > 0 ? String(convertTrimUnit(h, formTrimUnit, newUnit)) : formTrimHeight;
    setFormTrimWidth(nextW);
    setFormTrimHeight(nextH);
    setFormTrimUnit(newUnit);
    try { localStorage.setItem("om_trimUnit", newUnit); } catch { /* ignore */ }
  }

  /** Crop editor W input: always updates local crop state; syncs to form only when a real unit is selected. */
  function handleCropTrimWidthChange(val: string) {
    setCropTrimWidth(val);
    if (cropTrimUnit !== "ratio") setFormTrimWidth(val);
  }

  /** Crop editor H input: always updates local crop state; syncs to form only when a real unit is selected. */
  function handleCropTrimHeightChange(val: string) {
    setCropTrimHeight(val);
    if (cropTrimUnit !== "ratio") setFormTrimHeight(val);
  }

  /** Crop editor unit selector (in | mm | ratio). */
  function handleCropTrimUnitChange(newUnit: TrimUnit | "ratio") {
    if (newUnit === cropTrimUnit) return;
    let nextW = cropTrimWidth;
    let nextH = cropTrimHeight;
    // Convert physical values only when switching between two real units.
    if (newUnit !== "ratio" && cropTrimUnit !== "ratio") {
      const w = parseFloat(cropTrimWidth);
      const h = parseFloat(cropTrimHeight);
      if (Number.isFinite(w) && w > 0) nextW = String(convertTrimUnit(w, cropTrimUnit, newUnit));
      if (Number.isFinite(h) && h > 0) nextH = String(convertTrimUnit(h, cropTrimUnit, newUnit));
      setCropTrimWidth(nextW);
      setCropTrimHeight(nextH);
    }
    setCropTrimUnit(newUnit);
    if (newUnit !== "ratio") {
      setFormTrimWidth(nextW);
      setFormTrimHeight(nextH);
      setFormTrimUnit(newUnit);
      try { localStorage.setItem("om_trimUnit", newUnit); } catch { /* ignore */ }
    }
  }

  function enterEditMode() {
    if (!isOwner) return;
    if (editMode) return;

    // Pre-populate formTitle if it's currently empty (no override)
    // so it's selectable/copyable in the input field.
    if (!formTitle.trim()) {
      setFormTitle(effectiveTitle);
    }

    setFindMoreOpen(false);
    setMergePanelOpen(false);
    setMergeUndoSnapshot(null);
    editSnapshotRef.current = {
      formTitle,
      formAuthors,
      formEditors,
      formDesigners,
      formPublisher,
      formPrinter,
      formMaterials,
      formEditionOverride,
      formPublishDate,
      formDescription,
      formGroupLabel,
      formObjectType,
      formDecade,
      formPages,
      formLocation,
      formShelf,
      formNotes,
      formVisibility,
      formStatus,
      formBorrowable,
      formLibraryId,
      facetDraft: JSON.parse(JSON.stringify(facetDraft)),
      formTrimWidth,
      formTrimHeight,
      formTrimUnit,
      cropTrimWidth,
      cropTrimHeight,
      cropTrimUnit
    };
    setDeleteConfirm(false);
    setDeleteState({ busy: false, error: null, message: null });
    setEditMode(true);
  }

  function cancelEditMode() {
    if (!isOwner) return;
    const snap = editSnapshotRef.current;
    if (snap) {
      setFormTitle(snap.formTitle);
      setFormAuthors(snap.formAuthors);
      setFormEditors(snap.formEditors);
      setFormDesigners(snap.formDesigners);
      setFormPublisher(snap.formPublisher);
      setFormPrinter(snap.formPrinter);
      setFormMaterials(snap.formMaterials);
      setFormEditionOverride(snap.formEditionOverride);
      setFormPublishDate(snap.formPublishDate);
      setFormDescription(snap.formDescription);
      setFormGroupLabel(snap.formGroupLabel);
      setFormObjectType(snap.formObjectType);
      setFormDecade(snap.formDecade);
      setFormPages(snap.formPages);
      setFormLocation(snap.formLocation);
      setFormShelf(snap.formShelf);
      setFormNotes(snap.formNotes);
      setFormVisibility(snap.formVisibility);
      setFormStatus(snap.formStatus);
      setFormBorrowable(snap.formBorrowable);
      setFormLibraryId(snap.formLibraryId);
      if (snap.facetDraft) setFacetDraft(snap.facetDraft);
      setFormTrimWidth(snap.formTrimWidth);
      setFormTrimHeight(snap.formTrimHeight);
      setFormTrimUnit(snap.formTrimUnit);
      setCropTrimWidth(snap.cropTrimWidth);
      setCropTrimHeight(snap.cropTrimHeight);
      setCropTrimUnit(snap.cropTrimUnit);
    }
    setCoverToolsOpen(false);
    setPendingCover(null);
    setCoverEditorSrc(null);
    setSaveState({ busy: false, error: null, message: null });
    setEditMode(false);
    setDeleteConfirm(false);
  }

  async function saveEdits(): Promise<boolean> {
    if (!supabase || !book || !userId) return false;
    if (!isOwner) return false;
    setSaveState({ busy: true, error: null, message: "Saving…" });
    const title_override = formTitle.trim() ? formTitle.trim() : null;
    const authors_override = uniqStrings(facetDraft.author ?? parseAuthorsInput(formAuthors));
    const editors_override = uniqStrings(facetDraft.editor ?? parseAuthorsInput(formEditors));
    const designers_override = uniqStrings(facetDraft.designer ?? parseAuthorsInput(formDesigners));
    const publisher_override = (facetDraft.publisher?.[0] ?? formPublisher).trim();
    const printer_override = (facetDraft.printer?.[0] ?? formPrinter).trim();
    const materials_override = (facetDraft.material?.[0] ?? formMaterials).trim();
    const subjects_override = uniqStrings(facetDraft.subject ?? effectiveSubjects);
    const group_label = formGroupLabel.trim() ? formGroupLabel.trim() : null;
    const object_type = formObjectType.trim() ? formObjectType.trim() : null;
    const decade = formDecade.trim() ? formDecade.trim() : null;
    const pagesRaw = formPages.trim();
    const pages = pagesRaw ? Number(pagesRaw) : null;
    if (pages !== null && !Number.isFinite(pages)) {
      setSaveState({ busy: false, error: "Pages must be a number.", message: "Save failed" });
      return false;
    }
    const trimWRaw = parseFloat(formTrimWidth);
    const trimHRaw = parseFloat(formTrimHeight);
    const trim_width = Number.isFinite(trimWRaw) && trimWRaw > 0 ? trimWRaw : null;
    const trim_height = Number.isFinite(trimHRaw) && trimHRaw > 0 ? trimHRaw : null;
    const trim_unit = trim_width !== null && trim_height !== null ? (formTrimUnit || "in") : null;
    const payload: any = {
      group_label,
      object_type,
      decade,
      pages: pages === null ? null : Math.max(1, Math.floor(pages)),
      trim_width,
      trim_height,
      trim_unit,
      title_override,
      authors_override: authors_override.length > 0 ? authors_override : null,
      editors_override: editors_override.length > 0 ? editors_override : null,
      designers_override: designers_override.length > 0 ? designers_override : null,
      publisher_override: publisher_override || null,
      printer_override: printer_override || null,
      materials_override: materials_override || null,
      edition_override: formEditionOverride.trim() ? formEditionOverride.trim() : null,
      publish_date_override: formPublishDate.trim() ? formPublishDate.trim() : null,
      description_override: formDescription.trim() ? formDescription.trim() : null,
      subjects_override: subjects_override.length > 0 ? subjects_override : [],
      location: formLocation.trim() ? formLocation.trim() : null,
      shelf: formShelf.trim() ? formShelf.trim() : null,
      notes: formNotes.trim() ? formNotes.trim() : null,
      visibility: formVisibility,
      status: formStatus,
      borrowable_override: formBorrowable === "inherit" ? null : formBorrowable === "yes"
    };
    let res = await supabase.from("user_books").update(payload).eq("id", book.id);
    if (res.error) {
      const msg = (res.error.message ?? "").toLowerCase();
      if (msg.includes("trim_width") && msg.includes("does not exist")) {
        // Migration 0025 not yet applied; save without trim fields.
        delete payload.trim_width;
        delete payload.trim_height;
        delete payload.trim_unit;
        res = await supabase.from("user_books").update(payload).eq("id", book.id);
      }
    }
    if (res.error) {
      const msg = (res.error.message ?? "").toLowerCase();
      if (msg.includes("group_label") && msg.includes("does not exist")) {
        delete payload.group_label;
        delete payload.object_type;
        delete payload.decade;
        delete payload.pages;
        res = await supabase.from("user_books").update(payload).eq("id", book.id);
      }
    }
    if (res.error) {
      setSaveState({ busy: false, error: res.error.message, message: "Save failed" });
      return false;
    }

    // Sync entity facets (best-effort; won't block save if DB migration hasn't been applied yet).
    try {
      const roles: Array<[FacetRole, string[]]> = [
        ["author", facetDraft.author ?? effectiveAuthors],
        ["editor", facetDraft.editor ?? effectiveEditors],
        ["designer", facetDraft.designer ?? effectiveDesigners],
        ["subject", facetDraft.subject ?? effectiveSubjects],
        ["publisher", facetDraft.publisher ?? (effectivePublisher.trim() ? [effectivePublisher.trim()] : [])],
        ["printer", facetDraft.printer ?? (formPrinter.trim() ? [formPrinter.trim()] : [])],
        ["material", facetDraft.material ?? (formMaterials.trim() ? [formMaterials.trim()] : [])],
        ["tag", facetDraft.tag ?? tags.map((t) => t.name)],
        ["category", facetDraft.category ?? categories.map((t) => t.name)]
      ];
      for (const [role, names] of roles) {
        const rpc = await supabase.rpc("set_book_entities", { p_user_book_id: book.id, p_role: role, p_names: names ?? [] });
        if (rpc.error) {
          const msg = (rpc.error.message ?? "").toLowerCase();
          if (msg.includes("does not exist") || msg.includes("function") || msg.includes("unknown")) {
            break;
          }
        }
      }
    } catch {
      // ignore
    }

    // If a cover URL was staged via Find more info / Fill fields but never uploaded, import it now.
    // importCoverFromUrl uploads to storage, creates user_book_media, and calls refresh() internally.
    if (suggestedCoverUrl) {
      await importCoverFromUrl(suggestedCoverUrl);
    }

    await refresh();
    setSaveState({ busy: false, error: null, message: "Saved" });
    return true;
  }

  async function deleteBook() {
    if (!supabase || !book || !userId) return;
    if (!isOwner) return;
    setDeleteState({ busy: true, error: null, message: "Deleting…" });
    try {
      const paths = (book.media ?? [])
        .map((m) => (typeof m?.storage_path === "string" ? m.storage_path : ""))
        .filter(Boolean);

      if (paths.length > 0) {
        await supabase.storage.from("user-book-media").remove(paths);
      }

      const { error: delErr } = await supabase.from("user_books").delete().eq("id", book.id);
      if (delErr) throw new Error(delErr.message);

      router.push("/app");
    } catch (e: any) {
      setCoverState({ busy: false, error: e?.message ?? "Delete failed", message: "Delete failed" });
    }
    }


  async function doneEditMode() {
    if (!isOwner) return;
    const ok = await saveEdits();
    if (!ok) return;
    const desiredCopies = Number(copiesDraft);
    if (copiesCount !== null && Number.isFinite(desiredCopies) && desiredCopies >= 1 && desiredCopies !== copiesCount) {
      const copiesOk = await updateCopies();
      if (!copiesOk) return;
    }
    editSnapshotRef.current = null;
    setCoverToolsOpen(false);
    setEditMode(false);
  }

  async function moveToLibrary(nextLibraryId: number) {
    if (!supabase || !book || !userId) return;
    if (!isOwner) return;
    if (!nextLibraryId || !Number.isFinite(nextLibraryId)) return;
    setLibraryMoveState({ busy: true, error: null, message: "Moving…" });
    try {
      const upd = await supabase.from("user_books").update({ library_id: nextLibraryId }).eq("id", book.id);
      if (upd.error) throw new Error(upd.error.message);
      setFormLibraryId(nextLibraryId);
      try {
        window.localStorage.setItem("om_currentLibraryId", String(nextLibraryId));
      } catch {
        // ignore
      }
      await refresh();
      setLibraryMoveState({ busy: false, error: null, message: "Moved" });
      window.setTimeout(() => setLibraryMoveState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setLibraryMoveState({ busy: false, error: e?.message ?? "Move failed", message: "Move failed" });
    }
  }

  async function updateCopies(): Promise<boolean> {
    if (!supabase || !book || !userId) return false;
    if (!isOwner) return false;
    const libId = formLibraryId ?? (book as any).library_id ?? null;
    if (!libId) return false;
    const desired = Number(copiesDraft);
    if (!Number.isFinite(desired) || desired < 1) {
      setCopiesUpdateState({ busy: false, error: "Copies must be at least 1", message: "Invalid" });
      return false;
    }
    const matchedTitle = (formTitle.trim() || book.title_override || "").trim() || null;
    const matchedAuthors = uniqStrings(facetDraft.author ?? parseAuthorsInput(formAuthors));
    const matchedEditors = uniqStrings(facetDraft.editor ?? parseAuthorsInput(formEditors));
    const matchedDesigners = uniqStrings(facetDraft.designer ?? parseAuthorsInput(formDesigners));
    const matchedPublisher = (facetDraft.publisher?.[0] ?? formPublisher ?? "").trim() || null;
    const matchedPrinter = (facetDraft.printer?.[0] ?? formPrinter ?? "").trim() || null;
    const matchedMaterials = (facetDraft.material?.[0] ?? formMaterials ?? "").trim() || null;
    const matchedEdition = (formEditionOverride ?? "").trim() || null;
    const matchedPublishDate = (formPublishDate ?? "").trim() || null;
    const matchedDescription = (formDescription ?? "").trim() || null;
    const matchedSubjects = uniqStrings(facetDraft.subject ?? effectiveSubjects);
    const matchedGroup = (formGroupLabel ?? "").trim() || null;
    const matchedObjectType = (formObjectType ?? "").trim() || null;
    const matchedDecade = (formDecade ?? "").trim() || null;
    const matchedPages = (() => {
      const raw = (formPages ?? "").trim();
      if (!raw) return null;
      const num = Number(raw);
      if (!Number.isFinite(num)) return null;
      return Math.max(1, Math.floor(num));
    })();

    setCopiesUpdateState({ busy: true, error: null, message: "Updating…" });
    try {
      let q = supabase.from("user_books").select("id,created_at").eq("owner_id", userId).eq("library_id", libId);
      if (book.edition?.id) {
        q = q.eq("edition_id", book.edition.id);
      } else {
        q = q.is("edition_id", null);
        if (matchedTitle) q = q.eq("title_override", matchedTitle);
        else q = q.is("title_override", null);
        if (matchedAuthors.length > 0) q = q.eq("authors_override", matchedAuthors);
        else q = q.is("authors_override", null);
      }

      const existing = await q.order("created_at", { ascending: false }).limit(200);
      if (existing.error) throw new Error(existing.error.message);
      const ids = ((existing.data ?? []) as any[]).map((r) => r.id as number).filter((n) => Number.isFinite(n));
      const current = ids.length;

      if (desired === current) {
        setCopiesUpdateState({ busy: false, error: null, message: "No change" });
        window.setTimeout(() => setCopiesUpdateState({ busy: false, error: null, message: null }), 1200);
        return true;
      }

      if (desired > current) {
        const toAdd = desired - current;
        const payloadBase: any = {
          owner_id: userId,
          library_id: libId,
          edition_id: book.edition?.id ?? null,
          visibility: formVisibility,
          status: formStatus,
          group_label: matchedGroup,
          object_type: matchedObjectType,
          decade: matchedDecade,
          pages: matchedPages,
          title_override: matchedTitle,
          authors_override: matchedAuthors.length > 0 ? matchedAuthors : [],
          editors_override: matchedEditors.length > 0 ? matchedEditors : [],
          designers_override: matchedDesigners.length > 0 ? matchedDesigners : [],
          publisher_override: matchedPublisher,
          printer_override: matchedPrinter,
          materials_override: matchedMaterials,
          edition_override: matchedEdition,
          publish_date_override: matchedPublishDate,
          description_override: matchedDescription,
          subjects_override: matchedSubjects.length > 0 ? matchedSubjects : [],
          location: (formLocation ?? "").trim() || null,
          shelf: (formShelf ?? "").trim() || null,
          notes: (formNotes ?? "").trim() || null,
          borrowable_override: formBorrowable === "inherit" ? null : formBorrowable === "yes"
        };
        const rows = Array.from({ length: toAdd }, () => ({ ...payloadBase }));
        const ins = await supabase.from("user_books").insert(rows as any);
        if (ins.error) throw new Error(ins.error.message);
      } else {
        const toRemove = current - desired;
        const removable = ids.filter((id) => id !== book.id);
        const idsToDelete = removable.slice(0, toRemove);
        if (idsToDelete.length < toRemove) throw new Error("To reduce copies below 1, remove this entry.");
        const del = await supabase.from("user_books").delete().in("id", idsToDelete);
        if (del.error) throw new Error(del.error.message);
      }

      await refresh();
      setCopiesUpdateState({ busy: false, error: null, message: "Updated" });
      window.setTimeout(() => setCopiesUpdateState({ busy: false, error: null, message: null }), 1200);
      return true;
    } catch (e: any) {
      setCopiesUpdateState({ busy: false, error: e?.message ?? "Update failed", message: "Update failed" });
      return false;
    }
  }

  function cancelCoverEdit() {
    setPendingCover(null);
    setCoverEditorSrc(null);
    setCoverInputKey((k) => k + 1);
    setCoverToolsOpen(false);
  }

  function resetCoverEdit() {
    setEditorState({
      zoom: 1.0,
      x: 0,
      y: 0,
      rotation: 0,
      brightness: 1,
      contrast: 1
    });
    const origSrc = toFullSizeImageUrl((coverOriginalSrc ?? coverUrl) || "");
    setCoverEditorSrc(origSrc);
  }

  async function uploadCover() {
    if (!supabase || !book || !userId) return;
    if (!isOwner) return;

    setCoverState({ busy: true, error: null, message: "Saving…" });
    try {
      // Build crop data to store using the new transform mode
      const cropData: CoverCrop = {
        zoom: editorState.zoom,
        rotation: editorState.rotation,
        brightness: editorState.brightness,
        contrast: editorState.contrast,
        x: editorState.x,
        y: editorState.y,
        mode: "transform"
      };

      // If there's a new file to upload (pendingCover set), upload it as the new original
      if (pendingCover && coverEditorSrc) {
        const baseName = safeFileName(pendingCover.name.replace(/\.[^/.]+$/, ""));
        const ext = extFromContentType(pendingCover.type);
        const path = `${userId}/${book.id}/cover-original-${Date.now()}-${baseName}.${ext}`;

        // Remove existing cover(s) from storage + media table
        const existing = (book.media ?? []).filter((m) => m.kind === "cover");
        for (const m of existing) {
          if (m.storage_path) await supabase.storage.from("user-book-media").remove([m.storage_path]);
          if (m.id) await supabase.from("user_book_media").delete().eq("id", m.id);
        }

        // Upload original file
        const up = await supabase.storage.from("user-book-media").upload(path, pendingCover, {
          cacheControl: "31536000", upsert: false, contentType: pendingCover.type || "image/jpeg"
        });
        if (up.error) throw new Error(up.error.message);

        // Record in user_book_media
        await supabase.from("user_book_media").insert({ user_book_id: book.id, kind: "cover", storage_path: path, caption: null });

        // Update cover_original_url and sign immediately for coverOriginalSrc state
        await supabase.from("user_books").update({ cover_original_url: path }).eq("id", book.id);
        try {
          const { data: sd } = await supabase.storage.from("user-book-media").createSignedUrl(path, 3600);
          if (sd?.signedUrl) setCoverOriginalSrc(toFullSizeImageUrl(sd.signedUrl));
        } catch { /* best-effort */ }
      }

      // Save crop params (always — for both new file and re-edit)
      await supabase.from("user_books").update({ cover_crop: cropData as any }).eq("id", book.id);

      // Persist trim values to the database before refresh() reloads form state from Supabase.
      {
        let tw: number | null = null;
        let th: number | null = null;
        let tu: string | null = null;
        if (cropTrimUnit !== "ratio") {
          const w = parseFloat(cropTrimWidth);
          const h = parseFloat(cropTrimHeight);
          if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
            tw = w; th = h; tu = cropTrimUnit;
          }
        } else {
          const w = parseFloat(formTrimWidth);
          const h = parseFloat(formTrimHeight);
          if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
            tw = w; th = h; tu = formTrimUnit;
          }
        }
        await supabase.from("user_books").update({ trim_width: tw, trim_height: th, trim_unit: tu }).eq("id", book.id);
      }

      setPendingCover(null);
      setCoverEditorSrc(null);
      setCoverInputKey((k) => k + 1);
      await refresh();
      setCoverState({ busy: false, error: null, message: "Saved" });
      setCoverToolsOpen(false);
      setTimeout(() => {
        setCoverState(s => s.message === "Saved" ? { ...s, message: null } : s);
      }, 1000);
    } catch (e: any) {
      setCoverState({ busy: false, error: e?.message ?? "Save failed", message: "Save failed" });
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

  async function importCoverFromUrl(url: string) {
    if (!supabase || !book || !userId) return;
    if (!isOwner) return;
    const value = url.trim();
    if (!value) return;

    const ok = await checkImageDimensions(value);
    if (!ok) {
      setSuggestedCoverState({ busy: false, error: "Image too small (min 100px)", message: "Image too small" });
      return;
    }

    setSuggestedCoverState({ busy: true, error: null, message: "Importing cover…" });
    try {
      const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(value)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? `Fetch failed (${res.status})`);
      }

      const blob = await res.blob();
      const ext = extFromContentType(res.headers.get("content-type"));
      const path = `${userId}/${book.id}/cover-import-${Date.now()}.${ext}`;

      const existing = (book.media ?? []).filter((m) => m.kind === "cover");
      for (const m of existing) {
        if (m?.storage_path) {
          await supabase.storage.from("user-book-media").remove([m.storage_path]);
        }
        if (m?.id) {
          await supabase.from("user_book_media").delete().eq("id", m.id);
        }
      }

      const up = await supabase.storage.from("user-book-media").upload(path, blob, {
        cacheControl: "3600",
        upsert: false,
        contentType: blob.type || "application/octet-stream"
      });
      if (up.error) throw new Error(up.error.message);

      const inserted = await supabase.from("user_book_media").insert({ user_book_id: book.id, kind: "cover", storage_path: path, caption: null });
      if (inserted.error) throw new Error(inserted.error.message);

      // Save the imported blob as the permanent original so the crop editor can always
      // work from the full-resolution source. Always save on import (new cover).
      {
        const origPath = `${userId}/${book.id}/cover-original-${Date.now()}.${ext}`;
        const origUp = await supabase.storage.from("user-book-media").upload(origPath, blob, {
          cacheControl: "31536000",
          upsert: false,
          contentType: blob.type || "application/octet-stream"
        });
        if (!origUp.error) {
          await supabase.from("user_books").update({ cover_original_url: origPath, cover_crop: null }).eq("id", book.id);
        }
      }

      setSuggestedCoverUrl(null);
      await refresh();
      setSuggestedCoverState({ busy: false, error: null, message: "Cover imported" });
      window.setTimeout(() => setSuggestedCoverState({ busy: false, error: null, message: null }), 1500);
    } catch (e: any) {
      setSuggestedCoverState({ busy: false, error: e?.message ?? "Cover import failed", message: "Cover import failed" });
    }
  }

  async function setAsCover(mediaId: number) {
    if (!supabase || !book || !userId) return;
    if (!isOwner) return;
    setCoverState({ busy: true, error: null, message: "Setting cover…" });
    const demote = await supabase.from("user_book_media").update({ kind: "image" }).eq("user_book_id", book.id).eq("kind", "cover");
    if (demote.error) {
      setCoverState({ busy: false, error: demote.error.message, message: "Failed" });
      return;
    }
    const promote = await supabase.from("user_book_media").update({ kind: "cover" }).eq("id", mediaId);
    if (promote.error) {
      setCoverState({ busy: false, error: promote.error.message, message: "Failed" });
      return;
    }
    await refresh();
    setCoverState({ busy: false, error: null, message: "Updated" });
  }

  async function deleteCover() {
    if (!supabase || !book || !userId) return;
    if (!isOwner) return;
    setCoverState({ busy: true, error: null, message: "Deleting cover…" });
    try {
      // Clear cover columns
      const up = await supabase.from("user_books").update({ cover_original_url: null, cover_crop: null }).eq("id", book.id);
      if (up.error) throw new Error(up.error.message);

      // Remove cover entry from media
      const existing = (book.media ?? []).filter((m) => m.kind === "cover");
      for (const m of existing) {
        if (m?.storage_path) {
          await supabase.storage.from("user-book-media").remove([m.storage_path]);
        }
        if (m?.id) {
          await supabase.from("user_book_media").delete().eq("id", m.id);
        }
      }

      setCoverEditorSrc(null);
      setPendingCover(null);
      setCoverOriginalSrc(null);
      setSuggestedCoverUrl(null);
      setCoverToolsOpen(false);
      
      // Also clear the edition cover_url so the grey placeholder shows
      if (book.edition?.id) {
        await supabase.from("editions").update({ cover_url: null }).eq("id", book.edition.id);
      }

      // Clear locally so useMemo updates immediately while refresh() is pending
      setBook(s => s ? { ...s, media: s.media.filter(m => m.kind !== "cover"), cover_original_url: null, cover_crop: null, edition: s.edition ? { ...s.edition, cover_url: null } : null } : null);

      await refresh();
      setCoverState({ busy: false, error: null, message: "Deleted" });
      window.setTimeout(() => setCoverState(s => s.message === "Deleted" ? { ...s, message: null } : s), 1500);
    } catch (e: any) {
      setCoverState({ busy: false, error: e?.message ?? "Delete failed", message: "Delete failed" });
    }
  }

  async function deleteMedia(mediaId: number, storagePath: string) {
    if (!supabase || !book || !userId) return;
    if (!isOwner) return;
    if (!window.confirm("Delete this image?")) return;
    const rm = await supabase.storage.from("user-book-media").remove([storagePath]);
    if (rm.error) {
      setImagesState((s) => ({ ...s, error: rm.error?.message ?? "Delete failed", message: "Delete failed" }));
      return;
    }
    const del = await supabase.from("user_book_media").delete().eq("id", mediaId);
    if (del.error) {
      setImagesState((s) => ({ ...s, error: del.error?.message ?? "Delete failed", message: "Delete failed" }));
      return;
    }
    await refresh();
  }

  function selectPendingImages(files: FileList | null) {
    const picked = Array.from(files ?? []).filter((f) => f.size > 0);
    setPendingImages(picked);
    setImagesState({ busy: false, done: 0, total: picked.length, error: null, message: picked.length ? `${picked.length} selected` : null });
  }

  function clearPendingImages() {
    setPendingImages([]);
    setImagesInputKey((k) => k + 1);
    setImagesState({ busy: false, done: 0, total: 0, error: null, message: null });
  }

  async function uploadImages() {
    if (!supabase || !book || !userId) return;
    if (!isOwner) return;
    if (pendingImages.length === 0) return;

    setImagesState({ busy: true, done: 0, total: pendingImages.length, error: null, message: "Uploading…" });

    let done = 0;
    let lastError: string | null = null;

    for (const file of pendingImages) {
      const path = `${userId}/${book.id}/${Date.now()}-${safeFileName(file.name)}`;
      const up = await supabase.storage.from("user-book-media").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "application/octet-stream"
      });
      if (up.error) {
        lastError = up.error.message;
      } else {
        const ins = await supabase.from("user_book_media").insert({ user_book_id: book.id, kind: "image", storage_path: path, caption: null });
        if (ins.error) lastError = ins.error.message;
      }

      done += 1;
      setImagesState({ busy: true, done, total: pendingImages.length, error: lastError, message: `Uploading ${done}/${pendingImages.length}…` });
    }

    await refresh();
    clearPendingImages();
    setImagesState({
      busy: false,
      done: pendingImages.length,
      total: pendingImages.length,
      error: lastError,
      message: lastError ? "Finished with errors" : "Uploaded"
    });
  }

  async function searchMetadata(titleInput: string, authorInput?: string) {
    const title = titleInput.trim();
    const author = (authorInput ?? "").trim();
    if (!title) return;
    setSearchState({ busy: true, error: null, message: "Searching…" });
    setSearchResults([]);
    try {
      const res = await fetch(`/api/search?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Search failed");
      
      const rawResults = (json.results ?? []) as MetadataSearchResult[];
      // Filter out small covers from search results
      const processed = await Promise.all(rawResults.map(async (r) => {
        if (r.cover_url) {
          const ok = await checkImageDimensions(r.cover_url);
          if (!ok) return { ...r, cover_url: null };
        }
        return r;
      }));

      setSearchResults(processed);
      setSearchState({ busy: false, error: null, message: processed.length ? "Done" : "No results" });
    } catch (e: any) {
      setSearchState({ busy: false, error: e?.message ?? "Search failed", message: "Search failed" });
    }
  }

  async function previewImportFromUrl(urlInput: string) {
    const url = urlInput.trim();
    if (!url) return;
    setImportState({ busy: true, error: null, message: "Importing…" });
    setImportPreview(null);
    setImportMeta({ final_url: null, domain: null, domain_kind: null, scraped_sources: [] });
    try {
      const res = await fetch("/api/import-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Import failed");
      const rawPreview = json.preview ?? null;

      let finalCoverUrl = rawPreview?.cover_url ?? null;
      if (finalCoverUrl) {
        const ok = await checkImageDimensions(finalCoverUrl);
        if (!ok) finalCoverUrl = null;
      }

      const preview: ImportPreview | null = rawPreview
        ? {
            title: rawPreview.title ?? null,
            authors: Array.isArray(rawPreview.authors) ? rawPreview.authors : [],
            editors: Array.isArray(rawPreview.editors) ? rawPreview.editors : [],
            designers: Array.isArray(rawPreview.designers) ? rawPreview.designers : [],
            printers: Array.isArray(rawPreview.printers) ? rawPreview.printers : [],
            publisher: rawPreview.publisher ?? null,
            publish_date: rawPreview.publish_date ?? null,
            description: rawPreview.description ?? null,
            subjects: Array.isArray(rawPreview.subjects) ? rawPreview.subjects : [],
            isbn10: rawPreview.isbn10 ?? null,
            isbn13: rawPreview.isbn13 ?? null,
            cover_url: finalCoverUrl,
            cover_candidates: Array.isArray(rawPreview.cover_candidates) ? rawPreview.cover_candidates : [],
            trim_width: typeof rawPreview.trim_width === "number" ? rawPreview.trim_width : null,
            trim_height: typeof rawPreview.trim_height === "number" ? rawPreview.trim_height : null,
            trim_unit: rawPreview.trim_unit ?? null,
            sources: Array.isArray(rawPreview.sources) ? rawPreview.sources : [],
          }
        : null;
      setImportPreview(preview);
      setImportMeta({
        final_url: typeof json.final_url === "string" ? json.final_url : null,
        domain: typeof json.domain === "string" ? json.domain : null,
        domain_kind: typeof json.domain_kind === "string" ? json.domain_kind : null,
        scraped_sources: Array.isArray(json.scraped?.sources) ? (json.scraped.sources as string[]) : []
      });
      setImportState({ busy: false, error: null, message: json.info ?? (preview ? "Preview ready" : "No preview") });
    } catch (e: any) {
      setImportState({ busy: false, error: e?.message ?? "Import failed", message: "Import failed" });
    }
  }

  async function previewImportFromIsbn(isbn: string) {
    const value = isbn.trim();
    if (!value) return;
    setImportState({ busy: true, error: null, message: "Looking up ISBN…" });
    setImportPreview(null);
    setImportMeta({ final_url: null, domain: null, domain_kind: "isbn", scraped_sources: [] });
    try {
      const res = await fetch(`/api/isbn?isbn=${encodeURIComponent(value)}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "ISBN lookup failed");
      const edition = (json.edition ?? null) as any;
      if (!edition || typeof edition !== "object") throw new Error("No edition returned");

      let finalCoverUrl = typeof edition.cover_url === "string" ? edition.cover_url : null;
      if (finalCoverUrl) {
        const ok = await checkImageDimensions(finalCoverUrl);
        if (!ok) finalCoverUrl = null;
      }

      const preview: ImportPreview = {
        title: typeof edition.title === "string" ? edition.title : null,
        authors: Array.isArray(edition.authors) ? edition.authors.filter(Boolean) : [],
        editors: [],
        designers: [],
        printers: [],
        publisher: typeof edition.publisher === "string" ? edition.publisher : null,
        publish_date: typeof edition.publish_date === "string" ? edition.publish_date : null,
        description: typeof edition.description === "string" ? edition.description : null,
        subjects: Array.isArray(edition.subjects) ? edition.subjects.filter(Boolean) : [],
        isbn10: typeof edition.isbn10 === "string" ? edition.isbn10 : null,
        isbn13: typeof edition.isbn13 === "string" ? edition.isbn13 : null,
        cover_url: finalCoverUrl,
        cover_candidates: uniqStrings([finalCoverUrl]),
        trim_width: null,
        trim_height: null,
        trim_unit: null,
        sources: Array.from(new Set(["isbn", ...(((edition.sources ?? []) as any[]) ?? []).map((s: any) => String(s))])).filter(Boolean)
      };
      setImportPreview(preview);
      setImportMeta({
        final_url: null,
        domain: null,
        domain_kind: "isbn",
        scraped_sources: Array.isArray(edition.sources) ? (edition.sources as any[]).map((s) => String(s)) : []
      });
      setImportState({ busy: false, error: null, message: "Preview ready" });
    } catch (e: any) {
      setImportState({ busy: false, error: e?.message ?? "ISBN lookup failed", message: "ISBN lookup failed" });
    }
  }

  async function smartLookup(override?: string) {
    const value = (override ?? lookupInput).trim();
    if (!value) return;

    setSearchResults([]);
    setSearchState({ busy: false, error: null, message: null });
    setImportPreview(null);
    setImportMeta({ final_url: null, domain: null, domain_kind: null, scraped_sources: [] });
    setImportState({ busy: false, error: null, message: null });
    setLinkState({ busy: false, error: null, message: null });

    if (looksLikeIsbn(value)) {
      await previewImportFromIsbn(value);
      return;
    }

    const parsedUrl = tryParseUrl(value);
    if (parsedUrl) {
      const url = parsedUrl.toString();
      await previewImportFromUrl(url);
      return;
    }

    const { title, author } = parseTitleAndAuthor(value);
    if (!title) return;
    await searchMetadata(title, author ?? "");
  }

  function fillFieldsAdditive(input: {
    title?: string | null;
    authors?: string[] | null;
    editors?: string[] | null;
    designers?: string[] | null;
    printers?: string[] | null;
    publisher?: string | null;
    publish_date?: string | null;
    description?: string | null;
    subjects?: string[] | null;
    cover_url?: string | null;
    trim_width?: number | null;
    trim_height?: number | null;
    trim_unit?: TrimUnit | null;
  }) {
    const nextTitle = String(input.title ?? "").trim();
    const nextPublisher = String(input.publisher ?? "").trim();
    const nextPublishDate = String(input.publish_date ?? "").trim();
    const nextDescription = String(input.description ?? "").trim();
    const nextCover = String(input.cover_url ?? "").trim();
    const nextAuthors = (input.authors ?? []).map((a) => String(a ?? "").trim()).filter(Boolean);
    const nextSubjects = (input.subjects ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);

    const currentEffectiveTitle = (formTitle.trim() || String(book?.edition?.title ?? "").trim()).trim();
    const currentEffectivePublisher = (formPublisher.trim() || String(book?.edition?.publisher ?? "").trim()).trim();
    const currentEffectivePublishDate = (formPublishDate.trim() || String(book?.edition?.publish_date ?? "").trim()).trim();
    const currentEffectiveDescription = (formDescription.trim() || String(book?.edition?.description ?? "").trim()).trim();
    const hasCurrentCover = Boolean((book?.media ?? []).some((m) => m.kind === "cover"));

    if (!currentEffectiveTitle && nextTitle) setFormTitle(nextTitle);
    if (!currentEffectivePublisher && nextPublisher) {
      setFormPublisher(nextPublisher);
      setFacetDraft((s) => ({ ...s, publisher: [nextPublisher] }));
    }
    if (!currentEffectivePublishDate && nextPublishDate) setFormPublishDate(nextPublishDate);
    if (!currentEffectiveDescription && nextDescription) setFormDescription(nextDescription);
    if (nextCover) setSuggestedCoverUrl(nextCover);

    const mergedAuthors = uniqStrings([...(effectiveAuthors ?? []), ...nextAuthors]);
    if (mergedAuthors.length > 0) {
      setFacetDraft((s) => ({ ...s, author: mergedAuthors }));
      setFormAuthors(mergedAuthors.join(", "));
    }

    const mergedSubjects = uniqStrings([...(effectiveSubjects ?? []), ...nextSubjects]);
    if (mergedSubjects.length > 0) {
      setFacetDraft((s) => ({ ...s, subject: mergedSubjects }));
    }

    // Editors (additive)
    const nextEditors = (input.editors ?? []).map((e) => String(e ?? "").trim()).filter(Boolean);
    if (nextEditors.length > 0) {
      const mergedEditors = uniqStrings([...(facetDraft.editor ?? []), ...nextEditors]);
      setFacetDraft((s) => ({ ...s, editor: mergedEditors }));
      setFormEditors(mergedEditors.join(", "));
    }

    // Designers (additive)
    const nextDesigners = (input.designers ?? []).map((d) => String(d ?? "").trim()).filter(Boolean);
    if (nextDesigners.length > 0) {
      const mergedDesigners = uniqStrings([...(facetDraft.designer ?? []), ...nextDesigners]);
      setFacetDraft((s) => ({ ...s, designer: mergedDesigners }));
      setFormDesigners(mergedDesigners.join(", "));
    }

    // Printer (single; only fill if empty)
    const nextPrinters = (input.printers ?? []).map((p) => String(p ?? "").trim()).filter(Boolean);
    if (nextPrinters.length > 0 && !formPrinter.trim()) {
      const only = nextPrinters.slice(0, 1);
      setFacetDraft((s) => ({ ...s, printer: only }));
      setFormPrinter(only[0] ?? "");
    }

    // Trim size (only fill if both dimensions are absent)
    if (input.trim_width && input.trim_height && input.trim_unit) {
      if (!formTrimWidth.trim() && !formTrimHeight.trim()) {
        setFormTrimWidth(String(input.trim_width));
        setFormTrimHeight(String(input.trim_height));
        setFormTrimUnit(input.trim_unit);
      }
    }

    setSearchState((s) => ({ ...s, message: "Filled missing fields (not saved)" }));
    setImportState((s) => ({ ...s, message: "Filled missing fields (not saved)" }));
  }

  async function linkEditionByIsbn(isbn: string, coverUrlHint?: string | null) {
    if (!supabase || !book || !userId) return;
    if (!isOwner) return;

    const value = isbn.trim();
    if (!value) return;

    const hadCover = Boolean((book.media ?? []).some((m) => m.kind === "cover"));
    setLinkState({ busy: true, error: null, message: "Looking up ISBN…" });

    try {
      const res = await fetch(`/api/isbn?isbn=${encodeURIComponent(value)}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "ISBN lookup failed");
      const edition = (json.edition ?? {}) as any;
      const isbn13 = String(edition.isbn13 ?? "").trim();
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
        editionId = inserted.data.id as number;
      }

      // Additive linking: preserve existing effective values via overrides so nothing is "lost" when edition_id changes.
      const currentTitle = (formTitle.trim() ? formTitle.trim() : String(book.edition?.title ?? "").trim()) || null;
      const currentPublisher = (formPublisher.trim() ? formPublisher.trim() : String(book.edition?.publisher ?? "").trim()) || null;
      const currentPublishDate = (formPublishDate.trim() ? formPublishDate.trim() : String(book.edition?.publish_date ?? "").trim()) || null;
      const currentDescription = (formDescription.trim() ? formDescription.trim() : String(book.edition?.description ?? "").trim()) || null;

      const currentAuthors = (effectiveAuthors ?? []).map((a) => String(a ?? "").trim()).filter(Boolean);
      const nextAuthors = (Array.isArray(edition.authors) ? edition.authors : []).map((a: any) => String(a ?? "").trim()).filter(Boolean);
      const mergedAuthors = (() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const a of [...currentAuthors, ...nextAuthors]) {
          const k = a.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(a);
        }
        return out;
      })();

      const currentSubjects = (effectiveSubjects ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
      const nextSubjects = (Array.isArray(edition.subjects) ? edition.subjects : []).map((s: any) => String(s ?? "").trim()).filter(Boolean);
      const mergedSubjects = (() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const s of [...currentSubjects, ...nextSubjects]) {
          const k = s.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(s);
        }
        return out;
      })();

      const updates: any = { edition_id: editionId };
      if (currentTitle) updates.title_override = currentTitle;
      if (currentPublisher) updates.publisher_override = currentPublisher;
      if (currentPublishDate) updates.publish_date_override = currentPublishDate;
      if (currentDescription) updates.description_override = currentDescription;
      if (currentAuthors.length > 0) updates.authors_override = mergedAuthors;
      if (currentSubjects.length > 0) updates.subjects_override = mergedSubjects;

      const upd = await supabase.from("user_books").update(updates).eq("id", book.id);
      if (upd.error) throw new Error(upd.error.message);

      await refresh();

      const hintedCover = String(coverUrlHint ?? "").trim();
      const resolvedCover = hintedCover || String(edition.cover_url ?? "").trim();
      const shouldImportCover = Boolean(resolvedCover);
      if (shouldImportCover && resolvedCover) {
        setSuggestedCoverUrl(resolvedCover);
        await importCoverFromUrl(resolvedCover);
      }

      setLinkState({ busy: false, error: null, message: "Linked" });
      window.setTimeout(() => setLinkState({ busy: false, error: null, message: null }), 1500);
    } catch (e: any) {
      setLinkState({ busy: false, error: e?.message ?? "Link failed", message: "Link failed" });
    }
  }

  async function applyMerge(selections: Record<string, string | null>) {
    if (!supabase || !book || !userId) return;
    if (!isOwner) return;

    setMergeUndoSnapshot(null);
    const preFields: Record<string, unknown> = {
      title_override: book.title_override,
      publisher_override: book.publisher_override,
      printer_override: book.printer_override,
      materials_override: book.materials_override,
      edition_override: book.edition_override,
      publish_date_override: book.publish_date_override,
      description_override: book.description_override,
      authors_override: book.authors_override ? [...book.authors_override] : null,
      editors_override: book.editors_override ? [...book.editors_override] : null,
      designers_override: book.designers_override ? [...book.designers_override] : null,
      subjects_override: book.subjects_override ? [...book.subjects_override] : null,
      pages: book.pages,
      trim_width: book.trim_width,
      trim_height: book.trim_height,
      trim_unit: book.trim_unit,
    };
    const preCoverMedia = book.media.filter((m) => m.kind === "cover").map((m) => ({ storage_path: m.storage_path, caption: m.caption }));

    setMergeState({ busy: true, error: null, message: "Merging…" });
    try {
      const updates: any = {};

      // String scalar fields
      const strKeys = ["title_override", "publisher_override", "printer_override", "materials_override", "edition_override", "publish_date_override", "description_override"] as const;
      for (const key of strKeys) {
        if (selections[key] != null) updates[key] = selections[key];
      }

      // Array fields — additive: append selected net-new items keyed as "field::value"
      const arrKeys = ["authors_override", "editors_override", "designers_override", "subjects_override"] as const;
      const localArrays: Record<string, string[]> = {
        authors_override: [...(book.authors_override ?? book.edition?.authors ?? [])],
        editors_override: [...(book.editors_override ?? [])],
        designers_override: [...(book.designers_override ?? [])],
        subjects_override: [...(book.subjects_override ?? book.edition?.subjects ?? [])],
      };
      for (const key of arrKeys) {
        const existingItems = localArrays[key].filter(Boolean);
        const existingSet = new Set(existingItems.map((s) => s.toLowerCase()));
        const newItems: string[] = [];
        const prefix = `${key}::`;
        for (const [selKey, selVal] of Object.entries(selections)) {
          if (!selKey.startsWith(prefix)) continue;
          if (selVal == null) continue;
          const item = selKey.slice(prefix.length).trim();
          if (!item || existingSet.has(item.toLowerCase())) continue;
          newItems.push(item);
          existingSet.add(item.toLowerCase());
        }
        if (newItems.length > 0) {
          updates[key] = [...existingItems, ...newItems];
        }
      }

      // Numeric/physical fields
      if (selections["pages"] != null) {
        const p = Number(selections["pages"]);
        if (Number.isFinite(p) && p > 0) updates.pages = p;
      }
      if (selections["trim"] != null) {
        // value is "W × H unit" — find first matching source
        const matchingSrc = mergeAllSources.find((s) => {
          if (!s.trim_width || !s.trim_height) return false;
          const v = `${s.trim_width} × ${s.trim_height}${s.trim_unit ? ` ${s.trim_unit}` : ""}`;
          return v === selections["trim"];
        });
        if (matchingSrc) {
          updates.trim_width = matchingSrc.trim_width;
          updates.trim_height = matchingSrc.trim_height;
          if (matchingSrc.trim_unit) updates.trim_unit = matchingSrc.trim_unit;
        }
      }

      if (Object.keys(updates).length > 0) {
        const upd = await supabase.from("user_books").update(updates).eq("id", book.id);
        if (upd.error) throw new Error(upd.error.message);
      }

      // Sync entity facets for merged fields — mirrors saveEdits (best-effort)
      try {
        const roleSyncs: Array<[FacetRole, string[]]> = [];
        if (updates.authors_override) roleSyncs.push(["author", updates.authors_override]);
        if (updates.editors_override) roleSyncs.push(["editor", updates.editors_override]);
        if (updates.designers_override) roleSyncs.push(["designer", updates.designers_override]);
        if (updates.subjects_override) roleSyncs.push(["subject", updates.subjects_override]);
        if (updates.publisher_override) roleSyncs.push(["publisher", [updates.publisher_override]]);
        if (updates.printer_override) roleSyncs.push(["printer", [updates.printer_override]]);
        if (updates.materials_override) roleSyncs.push(["material", [updates.materials_override]]);
        for (const [role, names] of roleSyncs) {
          const rpc = await supabase.rpc("set_book_entities", { p_user_book_id: book.id, p_role: role, p_names: names });
          if (rpc.error) {
            const msg = (rpc.error.message ?? "").toLowerCase();
            if (msg.includes("does not exist") || msg.includes("function") || msg.includes("unknown")) break;
          }
        }
      } catch { /* ignore */ }

      // Cover — copy the specifically selected cover storage_path
      const selectedCoverEntry = Object.entries(selections).find(([k, v]) => k.startsWith("cover::") && v != null);
      const selectedCoverPath = selectedCoverEntry ? selectedCoverEntry[0].slice("cover::".length) : null;
      if (selectedCoverPath) {
        const signed = await supabase.storage.from("user-book-media").createSignedUrl(selectedCoverPath, 60 * 15);
        if (!signed.error && signed.data?.signedUrl) {
          const resp = await fetch(`/api/image-proxy?url=${encodeURIComponent(signed.data.signedUrl)}`);
          if (resp.ok) {
            const blob = await resp.blob();
            const fileName = safeFileName(String(selectedCoverPath.split("/").pop() ?? "image"));
            const destPath = `${userId}/${book.id}/merge-${Date.now()}-${fileName}`;
            const up = await supabase.storage.from("user-book-media").upload(destPath, blob, {
              cacheControl: "3600",
              upsert: false,
              contentType: resp.headers.get("content-type") || "application/octet-stream"
            });
            if (!up.error) {
              // Replace any existing cover entries with the new one
              await supabase.from("user_book_media").delete().eq("user_book_id", book.id).eq("kind", "cover");
              await supabase.from("user_book_media").insert({ user_book_id: book.id, kind: "cover", storage_path: destPath, caption: null });
            }
          }
        }
      }

      setMergePanelOpen(false);
      setMergeSelections({});
      await refresh();
      setMergeState({ busy: false, error: null, message: "Merged" });
      const undoData = { fields: preFields, coverMedia: preCoverMedia, hadCoverMerge: !!selectedCoverPath };
      window.setTimeout(() => {
        setMergeState({ busy: false, error: null, message: null });
        setMergeUndoSnapshot(undoData);
      }, 1500);
    } catch (e: any) {
      setMergeState({ busy: false, error: e?.message ?? "Merge failed", message: "Merge failed" });
    }
  }

  async function undoMerge() {
    if (!supabase || !book || !userId || !mergeUndoSnapshot) return;
    if (!isOwner) return;
    setMergeState({ busy: true, error: null, message: "Undoing…" });
    try {
      const { fields, coverMedia, hadCoverMerge } = mergeUndoSnapshot;
      const upd = await supabase.from("user_books").update(fields).eq("id", book.id);
      if (upd.error) throw new Error(upd.error.message);
      // Sync entities for restored array fields (best-effort)
      try {
        const roleSyncs: Array<[FacetRole, string[]]> = [];
        if (fields.authors_override != null) roleSyncs.push(["author", fields.authors_override as string[]]);
        if (fields.editors_override != null) roleSyncs.push(["editor", fields.editors_override as string[]]);
        if (fields.designers_override != null) roleSyncs.push(["designer", fields.designers_override as string[]]);
        if (fields.subjects_override != null) roleSyncs.push(["subject", fields.subjects_override as string[]]);
        if (fields.publisher_override != null) roleSyncs.push(["publisher", [fields.publisher_override as string]]);
        if (fields.printer_override != null) roleSyncs.push(["printer", [fields.printer_override as string]]);
        if (fields.materials_override != null) roleSyncs.push(["material", [fields.materials_override as string]]);
        for (const [role, names] of roleSyncs) {
          await supabase.rpc("set_book_entities", { p_user_book_id: book.id, p_role: role, p_names: names });
        }
      } catch { /* ignore */ }
      // Restore cover media
      if (hadCoverMerge) {
        await supabase.from("user_book_media").delete().eq("user_book_id", book.id).eq("kind", "cover");
        for (const m of coverMedia) {
          await supabase.from("user_book_media").insert({ user_book_id: book.id, kind: "cover", storage_path: m.storage_path, caption: m.caption });
        }
      }
      setMergeUndoSnapshot(null);
      await refresh();
      setMergeState({ busy: false, error: null, message: "Undone" });
      window.setTimeout(() => setMergeState({ busy: false, error: null, message: null }), 1500);
    } catch (e: any) {
      setMergeState({ busy: false, error: e?.message ?? "Undo failed", message: "Undo failed" });
    }
  }

  if (!supabase) {
    return (
      <main className="container">
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
        </div>
      </main>
    );
  }

  if (!initialLoadDone) return null;
  const showUrlSection = Boolean(publicBookUrl);
  const showDividerBorrowableLocation = showLocationBlock || showUrlSection;
  const showDividerShelfUrl = showShelfSection && showUrlSection;

  return (
    <main className="container">
      {!session ? (
        <SignInCard note="Sign in to view and edit this book." />
      ) : !Number.isFinite(bookId) || bookId <= 0 ? (
        <div className="card">
          <div>Invalid book id.</div>
        </div>
      ) : (
        <div className="card">
          <div
            className="om-book-detail-grid"
            style={{ marginTop: "var(--space-10)", rowGap: 24, columnGap: 14, alignItems: "start", gridTemplateColumns: isNarrow ? "1fr" : "220px minmax(0, 1fr)" }}
          >
            <div style={{ gridColumn: "1 / -1", marginBottom: 16 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "nowrap", gap: "var(--space-10)" }}>
                {/* Left group: primary action + updates indicator */}
                {isOwner ? (
                  <div className="row" style={{ gap: "var(--space-md)", alignItems: "baseline", flexWrap: "nowrap" }}>
                    {editMode ? (
                      deleteConfirm ? (
                        <div className="row" style={{ gap: "var(--space-md)", alignItems: "baseline", flexWrap: "nowrap" }}>
                          <span className="text-muted">Are you sure?</span>
                          <button onClick={() => deleteBook()} disabled={deleteState.busy}>Yes</button>
                          <button onClick={() => setDeleteConfirm(false)} disabled={deleteState.busy} className="text-muted">No</button>
                        </div>
                      ) : (
                        <>
                          <button onClick={doneEditMode} disabled={busy || saveState.busy}>
                            {saveState.busy ? "Saving..." : "Save"}
                          </button>
                          <button onClick={cancelEditMode} disabled={busy || saveState.busy} className="text-muted">Cancel</button>
                          <button onClick={() => setDeleteConfirm(true)} disabled={busy || saveState.busy} className="text-muted">Delete</button>
                        </>
                      )
                    ) : (
                      <button onClick={enterEditMode} disabled={busy}>Edit</button>
                    )}
                    {updatesCount > 0 ? (
                      <button
                        onClick={() => { cancelEditMode(); setFindMoreOpen(false); setMergePanelOpen((v) => !v); }}
                        className={mergePanelOpen ? "" : "text-muted"}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        <span>Updates available</span><span style={{ marginLeft: "0.5em" }}>{updatesCount}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* Right group: merge controls + Find more info / Cancel */}
                {isOwner ? (
                  <div className="row" style={{ gap: 16, alignItems: "baseline", flexWrap: "nowrap", justifyContent: "flex-end" }}>
                    {mergePanelOpen ? (
                      <>
                        <button
                          onClick={() => {
                            const sels: Record<string, string | null> = {};
                            const userHasCoverForApply = (book?.media ?? []).some((m) => m.kind === "cover");
                            for (const group of mergeFieldGroups) {
                              if (group.isArray) {
                                const defaultChecked = group.key === "cover" ? !userHasCoverForApply : true;
                                for (const cand of group.candidates) {
                                  const selKey = `${group.key}::${cand.value}`;
                                  const stored = mergeSelections[selKey];
                                  const isChecked = stored !== undefined ? stored != null : defaultChecked;
                                  if (isChecked) sels[selKey] = cand.value;
                                }
                              } else {
                                const topCand = group.candidates[0];
                                if (!topCand) continue;
                                const stored = mergeSelections[group.key];
                                const isChecked = stored !== undefined ? (stored != null && stored !== "") : true;
                                if (isChecked) sels[group.key] = stored != null && stored !== "" ? stored : topCand.value;
                              }
                            }
                            void applyMerge(sels);
                          }}
                          disabled={mergeState.busy || busy}
                        >
                          {mergeState.busy ? "Merging…" : "Apply merge"}
                        </button>
                        <button onClick={() => setMergePanelOpen(false)} className="text-muted" style={{ whiteSpace: "nowrap" }}>
                          Close
                        </button>
                      </>
                    ) : null}
                    <button
                      onClick={() => { if (!findMoreOpen) { cancelEditMode(); setMergePanelOpen(false); } setFindMoreOpen((v) => !v); }}
                      className="text-muted"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {findMoreOpen ? "Cancel" : "Find more info"}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="text-muted" style={{ marginTop: "var(--space-sm)", textAlign: "right" }}>
                {mergeState.message
                  ? mergeState.error
                    ? `${mergeState.message} (${mergeState.error})`
                    : mergeState.message
                  : mergeUndoSnapshot
                    ? <button onClick={() => void undoMerge()} disabled={mergeState.busy} className="text-muted">Undo merge</button>
                    : saveState.message
                      ? saveState.error
                        ? `${saveState.message} (${saveState.error})`
                        : saveState.message
                      : busy
                        ? "Loading…"
                        : error
                          ? error
                          : ""}
              </div>

              {isOwner && mergePanelOpen && mergeAllSources.length > 0 ? (
                <div style={{ marginTop: "var(--space-14)", paddingBottom: 24 }}>
                  {/* Sources column header */}
                  <div style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", gap: "var(--space-8)", marginBottom: 0, alignItems: "baseline" }}>
                    <span />
                    <span />
                    <span className="text-muted" style={{ textAlign: "right" }}>Sources</span>
                  </div>
                  {/* Field rows — spacing matches metadata list (marginTop: "var(--space-8)") */}
                  {mergeFieldGroups.flatMap((group): ReactNode[] => {
                    if (group.isArray) {
                      // Cover gets a special image-grid row
                      if (group.key === "cover") {
                        const userHasCover = (book?.media ?? []).some((m) => m.kind === "cover");
                        return [(
                          <div key="cover-row" style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", gap: "var(--space-8)", marginTop: "var(--space-8)", alignItems: "start" }}>
                            <span className="text-muted" style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>Cover</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-8)" }}>
                              {group.candidates.map((cand) => {
                                const selKey = `cover::${cand.value}`;
                                const stored = mergeSelections[selKey];
                                const isChecked = stored !== undefined ? stored != null : !userHasCover;
                                const imgUrl = mergeCoverUrls[cand.value];
                                return (
                                  <div
                                    key={selKey}
                                    onClick={() => setMergeSelections((s) => ({ ...s, [selKey]: isChecked ? null : cand.value }))}
                                    style={{ cursor: "pointer", opacity: isChecked ? 1 : 0.4, outline: isChecked ? "2px solid currentColor" : "2px solid transparent", outlineOffset: 2, borderRadius: 2 }}
                                  >
                                    {imgUrl
                                      ? <img
                                          src={imgUrl}
                                          alt="Cover variant"
                                          style={{ width: 48, height: 72, objectFit: "cover", display: "block", borderRadius: 2 }}
                                          onLoad={(e) => {
                                            if (e.currentTarget.naturalWidth < 100 || e.currentTarget.naturalHeight < 100) {
                                              e.currentTarget.style.display = "none";
                                            }
                                          }}
                                          onError={(e) => {
                                            e.currentTarget.style.display = "none";
                                          }}
                                        />
                                      : <div style={{ width: 48, height: 72, background: "var(--muted, #888)", opacity: 0.3, borderRadius: 2 }} />
                                    }
                                  </div>
                                );
                              })}
                            </div>
                            <span className="text-muted" style={{ textAlign: "right", paddingTop: 2 }}>{group.candidates.length}</span>
                          </div>
                        )];
                      }

                      return group.candidates.map((cand, i) => {
                        const selKey = `${group.key}::${cand.value}`;
                        const stored = mergeSelections[selKey];
                        const isChecked = stored !== undefined ? stored != null : true;
                        return (
                          <div
                            key={selKey}
                            onClick={() => setMergeSelections((s) => ({ ...s, [selKey]: isChecked ? null : cand.value }))}
                            style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", gap: "var(--space-8)", marginTop: "var(--space-8)", alignItems: "baseline", cursor: "pointer" }}
                          >
                            <span className="text-muted" style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{i === 0 ? group.label : ""}</span>
                            <span style={{ display: "flex", alignItems: "baseline", gap: "var(--space-sm)", minWidth: 0 }}>
                              <span style={{ flexShrink: 0, width: "1em", display: "inline-block" }}>{isChecked ? "+" : "–"}</span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, opacity: isChecked ? 1 : 0.45 }}>{cand.value}</span>
                            </span>
                            <span className="text-muted" style={{ textAlign: "right" }}>{cand.count}</span>
                          </div>
                        );
                      });
                    } else {
                      const cand = group.candidates[0];
                      if (!cand) return [];
                      const stored = mergeSelections[group.key];
                      const isChecked = stored !== undefined ? (stored != null && stored !== "") : true;
                      return [(
                        <div
                          key={group.key}
                          onClick={() => setMergeSelections((s) => ({ ...s, [group.key]: isChecked ? null : cand.value }))}
                          style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", gap: "var(--space-8)", marginTop: "var(--space-8)", alignItems: "baseline", cursor: "pointer" }}
                        >
                          <span className="text-muted" style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{group.label}</span>
                          <span style={{ display: "flex", alignItems: "baseline", gap: "var(--space-sm)", minWidth: 0 }}>
                            <span style={{ flexShrink: 0, width: "1em", display: "inline-block" }}>{isChecked ? "+" : "–"}</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, opacity: isChecked ? 1 : 0.45 }}>{cand.value}</span>
                          </span>
                          <span className="text-muted" style={{ textAlign: "right" }}>{cand.count}</span>
                        </div>
                      )];
                    }
                  })}
                </div>
              ) : null}

              {isOwner && findMoreOpen ? (
                <div style={{ marginTop: "var(--space-14)" }}>
                  <div className="om-lookup-controls" style={{ marginTop: "var(--space-8)", gridTemplateColumns: "1fr", gap: 0 }}>
                    <div className="row" style={{ width: "100%", gap: "var(--space-md)", alignItems: "baseline" }}>
                      {showScan && (
                        <div className="row" style={{ gap: "var(--space-md)", flex: "0 0 auto", alignItems: "baseline" }}>
                          <button 
                            className="text-muted" 
                            onClick={openScanner} 
                            style={{ whiteSpace: "nowrap", padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", textDecoration: "underline" }}
                          >
                            Scan
                          </button>
                          <span className="text-muted">or</span>
                        </div>
                      )}
                      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                        <input
                          className="om-inline-search-input"
                          placeholder={showScan ? "enter ISBN, URL, or title" : "Scan or enter ISBN, URL, or title"}
                          value={lookupInput}
                          onFocus={() => setLookupInputFocused(true)}
                          onBlur={() => setTimeout(() => setLookupInputFocused(false), 150)}
                          onChange={(e) => setLookupInput(e.target.value)}
                          onKeyDown={(e) => onEnter(e, smartLookup)}
                          style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
                        />
                      </div>
                      {(lookupInput.trim() || lookupInputFocused) ? (
                        <button
                          onClick={() => smartLookup()}
                          disabled={(importState.busy || searchState.busy) || !lookupInput.trim()}
                          style={{ whiteSpace: "nowrap", marginLeft: "var(--space-md)" }}
                        >
                          Find
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                    {importState.busy || searchState.busy
                      ? "Working…"
                      : importState.error
                        ? `Import failed (${importState.error})`
                        : searchState.error
                          ? `Search failed (${searchState.error})`
                          : ""}
                  </div>

                  {searchResults.length > 0 ? (
                    <div style={{ marginTop: "var(--space-10)" }}>
                      <div className="text-muted">Title/author results</div>
                      <div style={{ marginTop: "var(--space-sm)" }}>
                        {searchResults.slice(0, lookupLimit).map((r, idx) => {
                          const bestIsbn = r.isbn13 ?? r.isbn10 ?? "";
                          const hasIsbn = Boolean(bestIsbn);
                          const title = (r.title ?? "").trim() || "—";
                          const authors = (r.authors ?? []).filter(Boolean).join(", ");
                          const pub = [r.publisher ?? "", r.publish_date ?? (r.publish_year ? String(r.publish_year) : "")]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <div key={`${r.source}:${bestIsbn || title}:${idx}`} className="om-lookup-item">
                              <div className="om-lookup-row">
                                <div style={{ width: 62, flex: "0 0 auto" }}>
                                  {r.cover_url ? (
                                    <div className="om-cover-slot" style={{ width: 60, height: "auto" }}>
                                      <img
                                        src={r.cover_url}
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
                                    <div className="om-cover-slot" style={{ width: 60, height: "auto" }}><div className="om-cover-placeholder" style={{ width: "100%", aspectRatio: "3/4" }} /></div>
                                  )}
                                </div>
                                <div className="om-lookup-main">
                                  <div>{title}</div>
                                  <div className="text-muted" style={{ marginTop: 4 }}>
                                    {authors || "—"}
                                    {pub ? ` · ${pub}` : ""}
                                  </div>
                                  <div className="text-muted" style={{ marginTop: 4 }}>
                                    {bestIsbn ? `ISBN: ${bestIsbn}` : "No ISBN found"} · {r.source}
                                  </div>
                                </div>
                                <div className="om-lookup-actions">
                                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", alignItems: "flex-end" }}>
                                    {hasIsbn ? (
                                      <button
                                        onClick={() => {
                                          enterEditMode();
                                          linkEditionByIsbn(bestIsbn, r.cover_url ?? null);
                                        }}
                                        disabled={linkState.busy || !bestIsbn}
                                      >
                                        Link ISBN
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          enterEditMode();
                                          fillFieldsAdditive({
                                            title: r.title,
                                            authors: r.authors,
                                            publisher: r.publisher,
                                            publish_date: r.publish_date,
                                            subjects: r.subjects,
                                            cover_url: r.cover_url
                                          });
                                        }}
                                        disabled={!r.title && (!r.authors || r.authors.length === 0) && !r.publisher && !r.publish_date}
                                      >
                                        Fill fields
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {searchResults.length > lookupLimit || lookupLimit > lookupPageSize ? (
                        <div className="row" style={{ marginTop: "var(--space-md)", justifyContent: "center" }}>
                          {searchResults.length > lookupLimit ? (
                            <button onClick={() => setLookupLimit((prev) => prev + lookupPageSize)} className="text-muted">
                              Load more
                            </button>
                          ) : null}
                          {lookupLimit > lookupPageSize ? (
                            <button onClick={() => setLookupLimit(lookupPageSize)} className="text-muted">
                              See less
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {importPreview
                    ? (() => {
                        const preview = importPreview as ImportPreview;
                        const previewCoverUrl = preview.cover_url ?? undefined;
                        const previewFinalUrl = importMeta.final_url ?? undefined;
                        return (
                          <div style={{ marginTop: "var(--space-10)" }}>
                            <div style={{ marginTop: "var(--space-sm)" }} className="om-lookup-item">
                              <div className="om-lookup-row">
                                <div style={{ width: 62, flex: "0 0 auto" }}>
                                  {previewCoverUrl ? (
                                    <div className="om-cover-slot" style={{ width: 60, height: "auto" }}>
                                      <img
                                        src={previewCoverUrl}
                                        alt=""
                                        width={60}
                                        style={{ display: "block", width: "100%", height: "auto", objectFit: "contain" }}
                                      />
                                    </div>

                                  ) : (
                                    <div className="om-cover-slot" style={{ width: 60, height: "auto" }}><div className="om-cover-placeholder" style={{ width: "100%", aspectRatio: "3/4" }} /></div>
                                  )}
                                </div>
                                <div className="om-lookup-main" style={{ minWidth: 0 }}>
                                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(preview.title ?? "").trim() || "—"}</div>
                                  <div className="text-muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {(preview.authors ?? []).filter(Boolean).join(", ") || "—"}
                                  </div>
                                  {(preview.editors ?? []).length > 0 ? (
                                    <div className="text-muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      ed. {preview.editors!.join(", ")}
                                    </div>
                                  ) : null}
                                  {(preview.designers ?? []).length > 0 ? (
                                    <div className="text-muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      design: {preview.designers!.join(", ")}
                                    </div>
                                  ) : null}
                                  {(preview.printers ?? []).length > 0 ? (
                                    <div className="text-muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      print: {preview.printers!.join(", ")}
                                    </div>
                                  ) : null}
                                  <div className="text-muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {[preview.publisher ?? "", preview.publish_date ?? ""].filter(Boolean).join(" · ") || "—"}
                                    {preview.trim_width && preview.trim_height ? ` · ${preview.trim_width} × ${preview.trim_height} ${preview.trim_unit ?? ""}`.trim() : ""}
                                  </div>
                                  {(importMeta.domain || previewFinalUrl) && (
                                    <div className="text-muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {importMeta.domain ? `${importMeta.domain_kind ?? "generic"} · ${importMeta.domain}` : importMeta.domain_kind ?? ""}
                                      {previewFinalUrl ? (
                                        <>{" "}· <a href={previewFinalUrl} target="_blank" rel="noreferrer">open page</a></>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                                <div className="om-lookup-actions">
                                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", alignItems: "flex-end" }}>
                                    {(() => {
                                      const importPreviewIsbn = String(preview.isbn13 ?? preview.isbn10 ?? "").trim();
                                      const importPreviewHasIsbn = Boolean(importPreviewIsbn);
                                      return importPreviewHasIsbn ? (
                                        <button
                                          onClick={() => {
                                            enterEditMode();
                                            linkEditionByIsbn(importPreviewIsbn, preview.cover_url ?? null);
                                          }}
                                          disabled={linkState.busy || !importPreviewIsbn}
                                        >
                                          Link ISBN
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            enterEditMode();
                                            fillFieldsAdditive({
                                              title: preview.title,
                                              authors: preview.authors,
                                              editors: preview.editors,
                                              designers: preview.designers,
                                              printers: preview.printers,
                                              publisher: preview.publisher,
                                              publish_date: preview.publish_date,
                                              description: preview.description,
                                              subjects: preview.subjects,
                                              cover_url: preview.cover_url,
                                              trim_width: preview.trim_width,
                                              trim_height: preview.trim_height,
                                              trim_unit: preview.trim_unit,
                                            });
                                          }}
                                          disabled={
                                            !preview.title &&
                                            (!preview.authors || preview.authors.length === 0) &&
                                            !preview.publisher &&
                                            !preview.publish_date &&
                                            !preview.description
                                          }
                                        >
                                          Fill fields
                                        </button>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    : null}
                </div>
              ) : null}
            </div>
            <div>
              <div
                className="om-cover-slot"
                style={{
                  position: "relative",
                  width: "100%",
                  height: "auto",
                  padding: 0,
                  overflow: "hidden",
                  display: coverEditorSrc ? "block" : "flex",
                  filter: coverEditorSrc
                    ? `brightness(${editorState.brightness}) contrast(${editorState.contrast})`
                    : undefined
                }}
              >
                {coverEditorSrc ? (
                  <CoverEditor
                    src={coverEditorSrc}
                    state={editorState}
                    onChange={(next) => setEditorState(s => ({ ...s, ...next }))}
                    onLoad={({ minZoom }) => setMinZoomFloor(minZoom)}
                    aspectRatio={coverAspect ?? (2/3)}
                    style={{ width: "100%", height: "auto", aspectRatio: `${coverAspect ?? (2/3)}` }}
                  />
                ) : (
                  <CoverImage
                    alt={effectiveTitle}
                    src={coverOriginalSrc ?? coverUrl}
                    cropData={book?.cover_crop ?? null}
                    style={{ width: "100%", height: "auto", display: "block" }}
                    objectFit="contain"
                  />
                )}
              </div>

              {isOwner ? (
                <details
                  open={coverToolsOpen}
                  onToggle={(e) => {
                    const open = (e.currentTarget as HTMLDetailsElement).open;
                    setCoverToolsOpen(open);
                    
                    // Initialize editor if opening and we have a cover
                    if (open && coverUrl && !coverEditorSrc && !pendingCover) {
                      const origSrc = toFullSizeImageUrl((coverOriginalSrc ?? coverUrl) || "");
                      setCoverEditorSrc(origSrc);
                      const crop = book?.cover_crop;
                      const isTransform = crop?.mode === "transform";
                      setEditorState({
                        zoom: isTransform ? (crop.zoom ?? 1.0) : 1.0,
                        x: isTransform ? (crop.x ?? 0) : 0,
                        y: isTransform ? (crop.y ?? 0) : 0,
                        rotation: crop?.rotation ?? 0,
                        brightness: crop?.brightness ?? 1,
                        contrast: crop?.contrast ?? 1
                      });
                    }
                  }}
                  style={{ marginTop: "var(--space-10)", border: "none", outline: "none", boxShadow: "none" }}
                >
                  <summary className="om-disclosure-summary" style={{ listStyle: "none", border: "none", outline: "none", boxShadow: "none", display: "flex", width: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                      {coverToolsOpen ? (
                        <button 
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void uploadCover(); }} 
                          disabled={coverState.busy}
                        >
                          {coverState.busy ? "Saving…" : "Save"}
                        </button>
                      ) : (
                        <span className="text-muted" style={{ cursor: "pointer" }}>
                          {coverUrl ? "Edit cover" : "Add cover"}
                        </span>
                      )}
                      
                      {coverToolsOpen && (
                        <button 
                          className="text-muted" 
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelCoverEdit(); }}
                          disabled={coverState.busy}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </summary>
                  <div style={{ marginTop: 0 }}>
                      {coverEditorSrc ? (
                        <div style={{ marginTop: 0 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                            {/* Trim size — crop-local state; syncs to metadata when a real unit is selected */}
                            <div className="row" style={{ marginTop: "var(--space-8)", alignItems: "center" }}>
                              <div className="text-muted" style={{ minWidth: 110 }}>Trim size</div>
                              <div className="row" style={{ gap: "var(--space-sm)", alignItems: "center" }}>
                                <input
                                  type="number"
                                  value={cropTrimWidth}
                                  min={0.01}
                                  step={0.01}
                                  onChange={(e) => setCropTrimWidth(e.target.value)}
                                  placeholder="W"
                                  style={{ width: 68 }}
                                />
                                <span className="text-muted">×</span>
                                <input
                                  type="number"
                                  value={cropTrimHeight}
                                  min={0.01}
                                  step={0.01}
                                  onChange={(e) => setCropTrimHeight(e.target.value)}
                                  placeholder="H"
                                  style={{ width: 68 }}
                                />
                                <select
                                  value={cropTrimUnit}
                                  onChange={(e) => setCropTrimUnit(e.target.value as any)}
                                  style={{ width: "auto", minWidth: 0 }}
                                >
                                  <option value="ratio">ratio</option>
                                  <option value="in">in</option>
                                  <option value="mm">mm</option>
                                </select>
                              </div>
                            </div>

                            <div className="row no-wrap" style={{ marginTop: "var(--space-8)", alignItems: "center" }}>
                              <div className="text-muted" style={{ minWidth: 110 }}>Zoom</div>
                              <CustomSlider
                                min={1}
                                max={4}
                                step={0.01}
                                value={editorState.zoom}
                                onChange={(zoom) => setEditorState(s => ({ ...s, zoom }))}
                                style={{ flex: "1 1 auto" }}
                              />
                            </div>
                            <div className="row no-wrap" style={{ marginTop: "var(--space-8)", alignItems: "center" }}>
                              <div className="text-muted" style={{ minWidth: 110 }}>Rotate</div>
                              <CustomSlider
                                min={-180}
                                max={180}
                                step={1}
                                value={editorState.rotation}
                                onChange={(rotation) => setEditorState(s => ({ ...s, rotation }))}
                                style={{ flex: "1 1 auto" }}
                              />
                            </div>
                            <div className="row no-wrap" style={{ marginTop: "var(--space-8)", alignItems: "center" }}>
                              <div className="text-muted" style={{ minWidth: 110 }}>Bright</div>
                              <CustomSlider
                                min={0.5}
                                max={1.5}
                                step={0.01}
                                value={editorState.brightness}
                                onChange={(brightness) => setEditorState(s => ({ ...s, brightness }))}
                                style={{ flex: "1 1 auto" }}
                              />
                            </div>
                            <div className="row no-wrap" style={{ marginTop: "var(--space-8)", alignItems: "center" }}>
                              <div className="text-muted" style={{ minWidth: 110 }}>Contrast</div>
                              <CustomSlider
                                min={0.5}
                                max={1.5}
                                step={0.01}
                                value={editorState.contrast}
                                onChange={(contrast) => setEditorState(s => ({ ...s, contrast }))}
                                style={{ flex: "1 1 auto" }}
                              />
                            </div>
                          </div>
                        </div>
                      ) : coverUrl ? (
                        <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>Click Replace or wait for cover to load.</div>
                      ) : (
                        <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>No cover image. Click “Add cover” to upload.</div>
                      )}
                      {coverToolsOpen && (
                        <div className="row" style={{ marginTop: "var(--space-md)", gap: 16 }}>
                          <label 
                            className="text-muted" 
                            style={{ cursor: "pointer", textDecoration: "underline" }}
                          >
                            Replace
                            <input
                              key={coverInputKey}
                              type="file"
                              accept="image/*"
                              onChange={(ev) => {
                                setPendingCover((ev.target.files ?? [])[0] ?? null);
                              }}
                              style={{ display: "none" }}
                            />
                          </label>

                          {coverUrl && (
                            <button 
                              className="text-muted" 
                              style={{ textDecoration: "underline" }}
                              onClick={resetCoverEdit}
                            >
                              Reset
                            </button>
                          )}

                          {coverUrl && (
                            <button 
                              className="text-muted" 
                              style={{ textDecoration: "underline" }}
                              onClick={() => void deleteCover()}
                              disabled={coverState.busy}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                      {coverState.message ? (
                        <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                          {coverState.error ? `${coverState.message} (${coverState.error})` : coverState.message}
                        </div>
                      ) : null}
                    </div>
                </details>
              ) : null}
            </div>

            <div style={{ alignSelf: "start" }}>
              <div style={{ minHeight: "1.4em" }}>
                {editMode ? (
                  <input
                    className="om-inline-control"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    onKeyDown={(e) => onEnter(e, () => void saveEdits())}
                    placeholder={effectiveTitle}
                    autoFocus
                  />
                ) : (
                  <div>{effectiveTitle}</div>
                )}
              </div>

              <div style={{ marginTop: "var(--space-14)" }}>
                {editMode || facetView.author.length > 0 ? <hr className="divider" /> : null}
                {editMode || facetView.author.length > 0 ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Authors
                    </div>
                    <div className="om-hanging-value">
                      {editMode ? (
                        <EntityTokenField
                          role="author"
                          value={facetDraft.author}
                          onChange={(next) => {
                            setFacetDraft((s) => ({ ...s, author: next }));
                            setFormAuthors(next.join(", "));
                          }}
                          placeholder="Add an author"
                          disabled={!isOwner || busy || saveState.busy}
                        />
                      ) : (
                        <FacetLinks role="author" items={facetView.author} />
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || facetView.editor.length > 0 ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Editors
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <EntityTokenField
                          role="editor"
                          value={facetDraft.editor}
                          onChange={(next) => {
                            setFacetDraft((s) => ({ ...s, editor: next }));
                            setFormEditors(next.join(", "));
                          }}
                          placeholder="Add an editor"
                          disabled={!isOwner || busy || saveState.busy}
                        />
                      ) : (
                        <FacetLinks role="editor" items={facetView.editor} />
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || facetView.designer.length > 0 ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Designers
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <EntityTokenField
                          role="designer"
                          value={facetDraft.designer}
                          onChange={(next) => {
                            setFacetDraft((s) => ({ ...s, designer: next }));
                            setFormDesigners(next.join(", "));
                          }}
                          placeholder="Add a designer"
                          disabled={!isOwner || busy || saveState.busy}
                        />
                      ) : (
                        <FacetLinks role="designer" items={facetView.designer} />
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || facetView.printer.length > 0 ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Printer
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <EntityTokenField
                          role="printer"
                          value={facetDraft.printer}
                          onChange={(next) => {
                            const only = next.slice(0, 1);
                            setFacetDraft((s) => ({ ...s, printer: only }));
                            setFormPrinter(only[0] ?? "");
                          }}
                          placeholder="Add a printer"
                          disabled={!isOwner || busy || saveState.busy}
                        />
                      ) : (
                        <FacetLinks role="printer" items={facetView.printer} />
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || facetView.material.length > 0 ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Materials
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <EntityTokenField
                          role="material"
                          value={facetDraft.material}
                          onChange={(next) => {
                            const only = next.slice(0, 1);
                            setFacetDraft((s) => ({ ...s, material: only }));
                            setFormMaterials(only[0] ?? "");
                          }}
                          placeholder="Add materials"
                          disabled={!isOwner || busy || saveState.busy}
                        />
                      ) : (
                        <FacetLinks role="material" items={facetView.material} />
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || Boolean((formEditionOverride ?? "").trim()) ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Edition
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <input
                          className="om-inline-control"
                          value={formEditionOverride}
                          onChange={(e) => setFormEditionOverride(e.target.value)}
                          onKeyDown={(e) => onEnter(e, () => void saveEdits())}
                          placeholder="Add edition"
                        />
                      ) : (
                        (formEditionOverride ?? "").trim()
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || facetView.publisher.length > 0 ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Publisher
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <EntityTokenField
                          role="publisher"
                          value={facetDraft.publisher}
                          onChange={(next) => {
                            const only = next.slice(0, 1);
                            setFacetDraft((s) => ({ ...s, publisher: only }));
                            setFormPublisher(only[0] ?? "");
                          }}
                          placeholder="Add a publisher"
                          disabled={!isOwner || busy || saveState.busy}
                        />
                      ) : (
                        <FacetLinks role="publisher" items={facetView.publisher} />
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || Boolean(effectivePublishDate) ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Publish date
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <input
                          className="om-inline-control"
                          value={formPublishDate}
                          onChange={(e) => setFormPublishDate(e.target.value)}
                          onKeyDown={(e) => onEnter(e, () => void saveEdits())}
                        />
                      ) : (
                        displayPublishDate
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || Boolean(book?.pages) ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Pages
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <input
                          className="om-inline-control"
                          value={formPages}
                          onChange={(e) => setFormPages(e.target.value)}
                          onKeyDown={(e) => onEnter(e, () => void saveEdits())}
                          placeholder="Add page count"
                        />
                      ) : book?.pages ? (
                        String(book.pages)
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {editMode || Boolean((book as any)?.trim_width) ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Trim size
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <div className="row" style={{ gap: "var(--space-sm)", alignItems: "center" }}>
                          <input
                            className="om-inline-control"
                            type="number"
                            min={0.01}
                            step={0.01}
                            value={formTrimWidth}
                            onChange={(e) => setFormTrimWidth(e.target.value)}
                            placeholder="W"
                            style={{ width: 72 }}
                          />
                          <span className="text-muted">×</span>
                          <input
                            className="om-inline-control"
                            type="number"
                            min={0.01}
                            step={0.01}
                            value={formTrimHeight}
                            onChange={(e) => setFormTrimHeight(e.target.value)}
                            placeholder="H"
                            style={{ width: 72 }}
                          />
                          <select
                            className="om-inline-control"
                            value={formTrimUnit}
                            onChange={(e) => handleTrimUnitChange(e.target.value as TrimUnit)}
                            style={{ width: "auto", minWidth: 0 }}
                          >
                            <option value="in">in</option>
                            <option value="mm">mm</option>
                          </select>
                        </div>
                      ) : (book as any)?.trim_width && (book as any)?.trim_height ? (
                        `${(book as any).trim_width} × ${(book as any).trim_height} ${(book as any).trim_unit ?? "in"}`
                      ) : null}
                    </div>
                  </div>
                ) : null}


                {editMode || Boolean((book?.object_type ?? "").trim()) ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Object type
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <select className="om-inline-control" value={formObjectType || "book"} onChange={(e) => setFormObjectType(e.target.value)}>
                          <option value="book">book</option>
                          <option value="magazine">magazine</option>
                          <option value="ephemera">ephemera</option>
                          <option value="video">video</option>
                          <option value="music">music</option>
                        </select>
                      ) : (
                        (book?.object_type ?? "").trim()
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || Boolean((book?.decade ?? "").trim()) ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Decade
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <select className="om-inline-control" value={formDecade || ""} onChange={(e) => setFormDecade(e.target.value)}>
                          <option value="">Choose a decade</option>
                          <option value="Prewar">Prewar</option>
                          <option value="1950s">1950s</option>
                          <option value="1960s">1960s</option>
                          <option value="1970s">1970s</option>
                          <option value="1980s">1980s</option>
                          <option value="1990s">1990s</option>
                          <option value="2000s">2000s</option>
                          <option value="2010s">2010s</option>
                          <option value="2020s">2020s</option>
                        </select>
                      ) : (
                        <Link href={`/app?decade=${encodeURIComponent((book?.decade ?? "").trim())}`}>
                          {(book?.decade ?? "").trim()}
                        </Link>
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || facetView.subject.length > 0 ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Subjects
                    </div>
                    <div style={{ flex: "1 1 auto" }}>
                      {editMode ? (
                        <EntityTokenField
                          role="subject"
                          value={facetDraft.subject}
                          onChange={(next) => setFacetDraft((s) => ({ ...s, subject: next }))}
                          placeholder="Add a subject"
                          disabled={!isOwner || busy || saveState.busy}
                        />
                      ) : (
                        <ExpandableContent
                          items={facetView.subject}
                          limit={15}
                          renderVisible={(visible, isExpanded) => (
                            <>
                              <FacetLinks role="subject" items={visible} />
                              {!isExpanded && facetView.subject.length > 15 ? " …" : ""}
                            </>
                          )}
                        />
                      )}
                    </div>
                  </div>
                ) : null}

                {editMode || Boolean(book?.edition?.isbn13 ?? book?.edition?.isbn10) ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      ISBN
                    </div>
                    <div>{book?.edition?.isbn13 ?? book?.edition?.isbn10}</div>
                  </div>
                ) : null}

                {editMode || Boolean(effectiveDescription.trim()) ? (
                  <div style={{ marginTop: "var(--space-8)" }}>
                    <div className="text-muted">Description</div>
                    {editMode ? (
                      <textarea
                        ref={descriptionTextareaRef}
                        className="om-inline-control"
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        rows={1}
                        style={{ overflow: "hidden", resize: "none", marginTop: "var(--space-sm)" }}
                      />
                    ) : (
                      <div style={{ marginTop: "var(--space-sm)" }}>
                        <ExpandableContent
                          items={effectiveDescription.trim().split(/\s+/)}
                          limit={100}
                          renderVisible={(visible, isExpanded) => (
                            <div style={{ whiteSpace: "pre-wrap" }}>
                              {isExpanded ? effectiveDescription : visible.join(" ") + (effectiveDescription.trim().split(/\s+/).length > 100 ? "…" : "")}
                            </div>
                          )}
                        />
                      </div>
                    )}
                  </div>
                ) : null}

              </div>

              {isOwner ? (
                <>
                  <hr className="divider" />
                  <div className="meta-list" style={{ gap: 0 }}>
                    <div className="row om-row-baseline">
                      <div style={{ minWidth: 110 }} className="text-muted">
                        Catalog
                      </div>
                      {editMode ? (
                        <>
                          <select
                            className="om-inline-control"
                            value={formLibraryId ?? ""}
                            onChange={(e) => moveToLibrary(Number(e.target.value))}
                            disabled={libraryMoveState.busy || libraries.length === 0}
                            style={{ width: isNarrow ? "100%" : 220, maxWidth: "100%" }}
                          >
                            <option value="" disabled>
                              —
                            </option>
                            {libraries.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                          <div className="text-muted" style={{ marginLeft: "var(--space-10)" }}>
                            {libraryMoveState.message ? (libraryMoveState.error ? `${libraryMoveState.message} (${libraryMoveState.error})` : libraryMoveState.message) : ""}
                          </div>
                        </>
                      ) : (
                        <div className="row" style={{ alignItems: "center", gap: "var(--space-sm)", flexWrap: "nowrap" }}>
                          <span>{libraries.find((l) => l.id === formLibraryId)?.name ?? "—"}</span>
                          {(libMemberPreviewsById[formLibraryId ?? 0] ?? []).length > 0 ? (
                            <span className="om-member-stack" aria-label="Shared catalog members">
                              {(libMemberPreviewsById[formLibraryId ?? 0] ?? []).slice(0, 6).map((m) =>
                                m.avatarUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={m.userId} alt={m.username} src={m.avatarUrl} className="om-member-stack-avatar" />
                                ) : (
                                  <span key={m.userId} className="om-member-stack-avatar" title={m.username} />
                                )
                              )}
                              {(libMemberPreviewsById[formLibraryId ?? 0] ?? []).length > 6 ? (
                                <span className="om-member-stack-overflow" title={`${(libMemberPreviewsById[formLibraryId ?? 0] ?? []).length - 6} more members`}>
                                  +{(libMemberPreviewsById[formLibraryId ?? 0] ?? []).length - 6}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">
                        {copiesLabel}
                      </div>
                      {editMode ? (
                        <>
                          <input
                            type="number"
                            min={1}
                            className="om-inline-control"
                            value={copiesDraft || ""}
                            onChange={(e) => setCopiesDraft(e.target.value)}
                            style={{ width: 90 }}
                          />
                          <div className="text-muted" style={{ marginLeft: "var(--space-10)" }}>
                            {copiesUpdateState.message
                              ? copiesUpdateState.error
                                ? `${copiesUpdateState.message} (${copiesUpdateState.error})`
                                : copiesUpdateState.message
                              : copiesCountState.error
                                ? copiesCountState.error
                                : copiesCountState.busy
                                  ? "…"
                                  : copiesCount !== null
                                    ? `${copiesCount}`
                                    : ""}
                          </div>
                        </>
                      ) : (
                        <div>{copiesCountState.busy ? "…" : copiesCount !== null ? String(copiesCount) : "—"}</div>
                      )}
                    </div>
                    {editMode || facetView.category.length > 0 ? (
                      <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                        <div style={{ minWidth: 110 }} className="text-muted">
                          Categories
                        </div>
                        <div style={{ flex: "1 1 auto" }}>
                          {editMode ? (
                            <EntityTokenField
                              role="category"
                              value={facetDraft.category}
                              onChange={(next) => setFacetDraft((s) => ({ ...s, category: next }))}
                              placeholder="Add a category"
                              disabled={!isOwner || busy || saveState.busy}
                            />
                          ) : (
                            <FacetLinks role="category" items={facetView.category} />
                          )}
                        </div>
                      </div>
                    ) : null}

                    {editMode || facetView.tag.length > 0 ? (
                      <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                        <div style={{ minWidth: 110 }} className="text-muted">
                          Tags
                        </div>
                        <div style={{ flex: "1 1 auto" }}>
                          {editMode ? (
                            <EntityTokenField
                              role="tag"
                              value={facetDraft.tag}
                              onChange={(next) => setFacetDraft((s) => ({ ...s, tag: next }))}
                              placeholder="Add a tag"
                              disabled={!isOwner || busy || saveState.busy}
                            />
                          ) : (
                            <FacetLinks role="tag" items={facetView.tag} />
                          )}
                        </div>
                      </div>
                    ) : null}

                    {showNotesSection ? (
                      <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                        <div style={{ minWidth: 110 }} className="text-muted">
                          Notes
                        </div>
                        <div style={{ flex: "1 1 auto" }}>
                          {editMode ? (
                            <textarea
                              className="om-inline-control"
                              value={formNotes}
                              onChange={(e) => setFormNotes(e.target.value)}
                              rows={1}
                              style={{ width: "100%", resize: "none" }}
                              placeholder="Add notes"
                            />
                          ) : (
                            <div style={{ whiteSpace: "pre-wrap" }}>
                              {(formNotes ?? "").trim()}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <hr className="divider" />
                  <div className="meta-list" style={{ gap: 0 }}>
                    <div className="row om-row-baseline">
                      <div style={{ minWidth: 110 }} className="text-muted">
                        Visibility
                      </div>
                      {editMode ? (
                        formVisibility === "inherit" ? (
                          <>
                            <div className="text-muted" style={{ width: isNarrow ? "100%" : 220, maxWidth: "100%" }}>
                              {ownerProfile ? `From settings: ${ownerProfile.visibility === "public" ? "public" : "private"}` : "From settings: …"}
                            </div>
                            <button
                              onClick={() => setFormVisibility(ownerProfile?.visibility === "public" ? "public" : "followers_only")}
                              disabled={!ownerProfile}
                            >
                              Override
                            </button>
                          </>
                        ) : (
                          <>
                            <select
                              className="om-inline-control"
                              value={formVisibility}
                              onChange={(e) => setFormVisibility(e.target.value as any)}
                              style={{ width: isNarrow ? "100%" : 220, maxWidth: "100%" }}
                            >
                              <option value="followers_only">private</option>
                              <option value="public">public</option>
                            </select>
                            <button onClick={() => setFormVisibility("inherit")}>Revert</button>
                          </>
                        )
                      ) : (
                        <div>{formVisibility === "inherit" ? (ownerProfile?.visibility === "public" ? "public" : "private") : formVisibility === "public" ? "public" : "private"}</div>
                      )}
                    </div>

                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">
                        Status
                      </div>
                      {editMode ? (
                        <select
                          className="om-inline-control"
                          value={formStatus}
                          onChange={(e) => setFormStatus(e.target.value as any)}
                          style={{ width: isNarrow ? "100%" : 220, maxWidth: "100%" }}
                        >
                          <option value="owned">owned</option>
                          <option value="loaned">loaned</option>
                          <option value="selling">selling</option>
                          <option value="trading">trading</option>
                        </select>
                      ) : (
                        <div>{formStatus}</div>
                      )}
                    </div>

                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">
                        Borrowable
                      </div>
                      {editMode ? (
                        formBorrowable === "inherit" ? (
                          <>
                            <div className="text-muted" style={{ width: isNarrow ? "100%" : 220, maxWidth: "100%" }}>
                              {ownerBorrowDefaults ? `From settings: ${ownerBorrowDefaults.borrowable_default ? "yes" : "no"}` : "From settings: …"}
                            </div>
                            <button onClick={() => setFormBorrowable(ownerBorrowDefaults?.borrowable_default ? "yes" : "no")} disabled={!ownerBorrowDefaults}>
                              Override
                            </button>
                          </>
                        ) : (
                          <>
                            <select
                              className="om-inline-control"
                              value={formBorrowable}
                              onChange={(e) => setFormBorrowable(e.target.value as any)}
                              style={{ width: isNarrow ? "100%" : 220, maxWidth: "100%" }}
                            >
                              <option value="yes">yes</option>
                              <option value="no">no</option>
                            </select>
                            <button onClick={() => setFormBorrowable("inherit")}>Revert</button>
                          </>
                        )
                      ) : (
                        <div>{formBorrowable === "inherit" ? (ownerBorrowDefaults?.borrowable_default ? "yes" : "no") : formBorrowable}</div>
                      )}
                    </div>

                  </div>

                  {showDividerBorrowableLocation ? <hr className="divider" /> : null}
                  {showLocationBlock ? (
                    <>
                    <div className="meta-list" style={{ gap: 0 }}>
                      {showLocationSection ? (
                        <div className="row om-row-baseline">
                          <div style={{ minWidth: 110 }} className="text-muted">
                            Location
                          </div>
                            <div style={{ flex: "1 1 auto" }}>
                              {editMode ? (
                                <input
                                  className="om-inline-control"
                                  value={formLocation}
                                  onChange={(e) => setFormLocation(e.target.value)}
                                  placeholder="Home, Studio…"
                                />
                              ) : (
                                (formLocation ?? "").trim()
                              )}
                            </div>
                          </div>
                        ) : null}

                        {showShelfSection ? (
                          <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                            <div style={{ minWidth: 110 }} className="text-muted">
                              Shelf
                            </div>
                            <div style={{ flex: "1 1 auto" }}>
                              {editMode ? (
                                <input
                                  className="om-inline-control"
                                  value={formShelf}
                                  onChange={(e) => setFormShelf(e.target.value)}
                                  placeholder="Shelf #"
                                />
                              ) : (
                                (formShelf ?? "").trim()
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}

                  {showDividerShelfUrl ? <hr className="divider" /> : null}
                  {publicBookUrl ? (
                    <div style={{ marginTop: 16 }}>
                      <div className="om-edit-label">URL</div>
                      <div className="row" style={{ marginTop: "var(--space-sm)", gap: "var(--space-10)", flexWrap: "nowrap", alignItems: "flex-end" }}>
                        <a
                          href={publicBookUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}
                        >
                          {publicBookUrl.replace(/^https?:\/\//, "")}
                        </a>
                        {shareState.message === "Copied" ? (
                          <span style={{ flex: "0 0 auto", marginLeft: 2 }}>Copied</span>
                        ) : (
                          <button onClick={copyPublicLink} style={{ flex: "0 0 auto", marginLeft: 2 }}>
                            Copy
                          </button>
                        )}
                      </div>
                      {shareState.error ? (
                        <div className="text-muted" style={{ marginTop: "var(--space-sm)", textAlign: "right" }}>
                          {shareState.message} ({shareState.error})
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                </>
              ) : null}
            </div>
          </div>

          {(isOwner && editMode) || imageMedia.length > 0 ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <hr className="divider" />
              {isOwner && editMode ? (
                <details style={{ marginTop: "var(--space-8)", border: "none", outline: "none", boxShadow: "none" }}>
                  <summary className="text-muted" style={{ listStyle: "none", border: "none", outline: "none", boxShadow: "none", cursor: "pointer" }}>Add images…</summary>
                  <div style={{ marginTop: "var(--space-8)" }}>
                    <input key={imagesInputKey} type="file" accept="image/*" multiple onChange={(ev) => selectPendingImages(ev.target.files)} />

                    {pendingImages.length > 0 ? (
                      <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                        <div>Selected (not uploaded yet):</div>
                        <div style={{ marginTop: "var(--space-sm)" }}>
                          {pendingImages.map((f) => (
                            <div key={`${f.name}:${f.size}:${f.lastModified}`}>{f.name}</div>
                          ))}
                        </div>
                        <div className="row" style={{ marginTop: "var(--space-8)" }}>
                          <button onClick={uploadImages} disabled={imagesState.busy}>
                            {imagesState.busy ? "Uploading…" : "Submit"}
                          </button>
                          <button onClick={clearPendingImages} disabled={imagesState.busy} className="text-muted">
                            Clear
                          </button>
                          <div className="text-muted" style={{ marginLeft: "var(--space-10)" }}>
                            {imagesState.message ? (imagesState.error ? `${imagesState.message} (${imagesState.error})` : imagesState.message) : ""}
                          </div>
                        </div>
                      </div>
                    ) : imagesState.message ? (
                      <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                        {imagesState.error ? `${imagesState.message} (${imagesState.error})` : imagesState.message}
                      </div>
                    ) : (
                      <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                        Select one or more images, then click Submit.
                      </div>
                    )}
                  </div>
                </details>
              ) : null}

              {imageMedia.length > 0 ? (
                <div className="om-images-grid" style={{ marginTop: "var(--space-10)" }}>
                  {imageMedia.map((m, idx) => {
                    const url = mediaUrlsByPath[m.storage_path];
                    return (
                      <div key={m.id}>
                        {url ? (
                          <div 
                            onClick={() => setLightboxIndex(idx)}
                            className="om-cover-slot" 
                            style={{ width: "100%", height: isNarrow ? 140 : 180, padding: 0, cursor: "pointer" }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt="" src={url} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                          </div>
                        ) : (
                          <div className="om-cover-slot" style={{ width: "100%", height: isNarrow ? 140 : 180, padding: 0 }} />
                        )}
                        {editMode ? (
                          <div className="row" style={{ marginTop: "var(--space-8)", justifyContent: "space-between" }}>
                            <button onClick={() => setAsCover(m.id)} disabled={coverState.busy}>
                              Use as cover
                            </button>
                            <button onClick={() => deleteMedia(m.id, m.storage_path)} disabled={imagesState.busy || coverState.busy}>
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : editMode ? (
                <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                  No images yet.
                </div>
              ) : null}
            </div>
          ) : null}
        {editionId ? (
          <>
            <AlsoOwnedBy editionId={editionId} excludeUserBookId={bookId} excludeOwnerId={userId} />
          </>
        ) : null}
        </div>
      )}

      {lightboxIndex !== null && imageMedia[lightboxIndex] && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
            background: "rgba(0,0,0,0.85)", zIndex: 2000,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}
          onClick={() => setLightboxIndex(null)}
        >
          <div
            style={{
              position: "absolute", top: 24, right: 24, zIndex: 2001,
              display: "flex", gap: 16, alignItems: "baseline"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(lightboxIndex ?? 0) > 0 && (
              <button
                style={{ color: "#fff" }}
                onClick={() => setLightboxIndex(prev => prev !== null ? prev - 1 : 0)}
              >
                Prev
              </button>
            )}
            {(lightboxIndex ?? 0) < imageMedia.length - 1 && (
              <button
                style={{ color: "#fff" }}
                onClick={() => setLightboxIndex(prev => prev !== null ? prev + 1 : 0)}
              >
                Next
              </button>
            )}
            <button
              style={{ color: "#fff" }}
              onClick={() => setLightboxIndex(null)}
            >
              Close
            </button>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrlsByPath[imageMedia[lightboxIndex]!.storage_path]}
            alt=""
            style={{ maxWidth: "calc(100% - 64px)", maxHeight: "calc(100% - 64px)", objectFit: "contain" }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <BookScannerModal
        open={scannerOpen}
        onClose={closeScanner}
        onResult={(query) => {
          setLookupInput(query);
          smartLookup(query);
        }}
      />
    </main>
  );
}
