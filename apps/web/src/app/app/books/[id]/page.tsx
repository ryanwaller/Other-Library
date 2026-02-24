"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import Cropper, { type Area } from "react-easy-crop";
import { supabase } from "../../../../lib/supabaseClient";
import { bookIdSlug } from "../../../../lib/slug";
import AlsoOwnedBy from "../../../u/[username]/AlsoOwnedBy";
import SignInCard from "../../../components/SignInCard";

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
  publisher: string | null;
  publish_date: string | null;
  description: string | null;
  subjects: string[];
  isbn10: string | null;
  isbn13: string | null;
  cover_url: string | null;
  cover_candidates: string[];
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
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

function normalizeTagName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function normalizeAuthorName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function normalizeSubjectName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

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

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toProxyImageUrl(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("blob:")) return raw;
  return `/api/image-proxy?url=${encodeURIComponent(raw)}`;
}

function getRadianAngle(deg: number): number {
  return (deg * Math.PI) / 180;
}

function rotateSize(width: number, height: number, rotation: number): { width: number; height: number } {
  const rotRad = getRadianAngle(rotation);
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height)
  };
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}

async function cropCoverToBlob(opts: {
  imageSrc: string;
  crop: Area;
  rotation: number;
  brightness: number;
  contrast: number;
}): Promise<Blob> {
  const image = await loadImage(opts.imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  const { width: bW, height: bH } = rotateSize(image.width, image.height, opts.rotation);
  canvas.width = Math.floor(bW);
  canvas.height = Math.floor(bH);

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(getRadianAngle(opts.rotation));
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.filter = `brightness(${opts.brightness}) contrast(${opts.contrast})`;
  ctx.drawImage(image, 0, 0);

  const pixelCrop = opts.crop;
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.floor(pixelCrop.width);
  cropCanvas.height = Math.floor(pixelCrop.height);
  const cropCtx = cropCanvas.getContext("2d");
  if (!cropCtx) throw new Error("Canvas not supported");

  const data = ctx.getImageData(Math.floor(pixelCrop.x), Math.floor(pixelCrop.y), Math.floor(pixelCrop.width), Math.floor(pixelCrop.height));
  cropCtx.putImageData(data, 0, 0);

  const maxDim = 1400;
  const scale = Math.min(1, maxDim / Math.max(cropCanvas.width, cropCanvas.height));
  const outW = Math.max(1, Math.floor(cropCanvas.width * scale));
  const outH = Math.max(1, Math.floor(cropCanvas.height * scale));
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas not supported");
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(cropCanvas, 0, 0, outW, outH);

  const blob: Blob = await new Promise((resolve, reject) => {
    outCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))), "image/jpeg", 0.9);
  });
  return blob;
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
  const params = useParams();
  const idParam = (params as any)?.id;
  const bookId = Number(Array.isArray(idParam) ? idParam[0] : idParam);
  const [isNarrow, setIsNarrow] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;
  const [editMode, setEditMode] = useState(false);

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
  const [newAuthor, setNewAuthor] = useState("");
  const [formEditors, setFormEditors] = useState("");
  const [newEditor, setNewEditor] = useState("");
  const [formDesigners, setFormDesigners] = useState("");
  const [newDesigner, setNewDesigner] = useState("");
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
  const [saveState, setSaveState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [newTag, setNewTag] = useState("");
  const [tagState, setTagState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [newCategory, setNewCategory] = useState("");
  const [categoryState, setCategoryState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [newSubject, setNewSubject] = useState("");
  const [subjectState, setSubjectState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [lookupInput, setLookupInput] = useState("");
  const [linkState, setLinkState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [searchTitle, setSearchTitle] = useState("");
  const [searchAuthor, setSearchAuthor] = useState("");
  const [searchState, setSearchState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);

  const [importUrl, setImportUrl] = useState("");
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

  const [pendingCover, setPendingCover] = useState<File | null>(null);
  const [coverEditorSrc, setCoverEditorSrc] = useState<string | null>(null);
  const coverEditorObjectUrlRef = useRef<string | null>(null);
  const [coverCrop, setCoverCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [coverZoom, setCoverZoom] = useState<number>(1);
  const [coverRotation, setCoverRotation] = useState<number>(0);
  const [coverBrightness, setCoverBrightness] = useState<number>(1);
  const [coverContrast, setCoverContrast] = useState<number>(1);
  const [coverAspectW, setCoverAspectW] = useState<number>(2);
  const [coverAspectH, setCoverAspectH] = useState<number>(3);
  const [coverCroppedAreaPixels, setCoverCroppedAreaPixels] = useState<Area | null>(null);
  const [coverState, setCoverState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [coverInputKey, setCoverInputKey] = useState(0);

  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [imagesState, setImagesState] = useState<{ busy: boolean; done: number; total: number; error: string | null; message: string | null }>({
    busy: false,
    done: 0,
    total: 0,
    error: null,
    message: null
  });
  const [imagesInputKey, setImagesInputKey] = useState(0);

  const [mergeSource, setMergeSource] = useState<MergeSource | null>(null);
  const [mergeState, setMergeState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [mergeDismissed, setMergeDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const update = () => setIsNarrow(!!mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    try {
      if (!Number.isFinite(bookId) || bookId <= 0) {
        setMergeDismissed(false);
        return;
      }
      const raw = window.localStorage.getItem(`om_mergeDismissed:${bookId}`);
      setMergeDismissed(raw === "1");
    } catch {
      setMergeDismissed(false);
    }
  }, [bookId]);

  useEffect(() => {
    if (!pendingCover) return;
    const url = URL.createObjectURL(pendingCover);
    if (coverEditorObjectUrlRef.current) URL.revokeObjectURL(coverEditorObjectUrlRef.current);
    coverEditorObjectUrlRef.current = url;
    setCoverEditorSrc(url);
    setCoverCrop({ x: 0, y: 0 });
    setCoverZoom(1);
    setCoverRotation(0);
    setCoverBrightness(1);
    setCoverContrast(1);
    setCoverAspectW(2);
    setCoverAspectH(3);
    setCoverCroppedAreaPixels(null);
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
      if (!supabase) return;
      if (!userId) {
        setLibraries([]);
        return;
      }
      if (!book || book.owner_id !== userId) {
        setLibraries([]);
        return;
      }
      const res = await supabase.from("libraries").select("id,name,created_at").eq("owner_id", userId).order("created_at", { ascending: true });
      if (!alive) return;
      if (res.error) {
        setLibraries([]);
        return;
      }
      setLibraries((res.data ?? []) as any);
    })();
    return () => {
      alive = false;
    };
  }, [userId, book?.owner_id]);

  async function refresh() {
    if (!supabase) return;
    if (!Number.isFinite(bookId) || bookId <= 0) return;
    setBusy(true);
    setError(null);
    setOwnerProfile(null);
    setOwnerBorrowDefaults(null);
    setMergeSource(null);
    setMergeState({ busy: false, error: null, message: null });
    setCopiesCount(null);
    setCopiesCountState({ busy: false, error: null });
    try {
      const selectNew =
        "id,owner_id,library_id,visibility,status,borrowable_override,borrow_request_scope_override,group_label,object_type,decade,pages,title_override,authors_override,editors_override,designers_override,publisher_override,printer_override,materials_override,edition_override,publish_date_override,description_override,subjects_override,location,shelf,notes,edition:editions(id,isbn10,isbn13,title,authors,publisher,publish_date,description,subjects,cover_url,raw),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))";
      const selectOld =
        "id,owner_id,library_id,visibility,status,borrowable_override,borrow_request_scope_override,title_override,authors_override,editors_override,designers_override,publisher_override,printer_override,materials_override,edition_override,publish_date_override,description_override,subjects_override,location,shelf,notes,edition:editions(id,isbn10,isbn13,title,authors,publisher,publish_date,description,subjects,cover_url,raw),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))";

      let res = await supabase.from("user_books").select(selectNew).eq("id", bookId).maybeSingle();
      if (res.error) {
        const msg = (res.error.message ?? "").toLowerCase();
        if (msg.includes("group_label") && msg.includes("does not exist")) {
          res = await supabase.from("user_books").select(selectOld).eq("id", bookId).maybeSingle();
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
      setFormTitle(row.title_override ?? "");
      setFormAuthors((row.authors_override ?? []).filter(Boolean).join(", "));
      setFormEditors((row.editors_override ?? []).filter(Boolean).join(", "));
      setFormDesigners((row.designers_override ?? []).filter(Boolean).join(", "));
      setFormPublisher(row.publisher_override ?? row.edition?.publisher ?? "");
      setFormPrinter(row.printer_override ?? "");
      setFormMaterials(row.materials_override ?? "");
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
      setFormVisibility(row.visibility);
      setFormStatus(row.status);
      setFormLibraryId((row as any).library_id ?? null);
      setFormBorrowable(row.borrowable_override === null || row.borrowable_override === undefined ? "inherit" : row.borrowable_override ? "yes" : "no");

      setSearchTitle((row.title_override ?? row.edition?.title ?? "").trim());
      setSearchAuthor(((row.authors_override ?? row.edition?.authors ?? []) as string[]).filter(Boolean).slice(0, 1).join(", "));
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

      const paths = Array.from(
        new Set(
          (row.media ?? [])
            .map((m) => (typeof m?.storage_path === "string" ? m.storage_path : ""))
            .filter(Boolean)
        )
      );
      if (paths.length > 0) {
        const signedRes = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 60);
        const next: Record<string, string> = {};
        for (const s of signedRes.data ?? []) {
          if (s.path && s.signedUrl) next[s.path] = s.signedUrl;
        }
        setMediaUrlsByPath(next);
      }

      // If you own this book and it's missing key metadata/media, look for a visible "source" to merge from.
      try {
        if (userId && row.owner_id === userId && row.edition?.id) {
          const hasCoverMedia = (row.media ?? []).some((m) => m.kind === "cover");
          const hasEditionCover = Boolean(row.edition.cover_url);
          const hasAnyImages = (row.media ?? []).some((m) => m.kind === "image");

          const missingTitle = !(row.title_override ?? "").trim();
          const missingAuthors = (!row.authors_override || row.authors_override.length === 0) && (!row.edition.authors || row.edition.authors.length === 0);
          const missingPublisher = !row.publisher_override && !row.edition.publisher;
          const missingPublishDate = !row.publish_date_override && !row.edition.publish_date;
          const missingDescription = !row.description_override && !row.edition.description;
          const missingSubjects = (!row.subjects_override || row.subjects_override.length === 0) && (!row.edition.subjects || row.edition.subjects.length === 0);

          const needsAny =
            !hasCoverMedia ||
            !hasAnyImages ||
            missingTitle ||
            missingAuthors ||
            missingPublisher ||
            missingPublishDate ||
            missingDescription ||
            missingSubjects;

          if (needsAny) {
            const cand = await supabase
              .from("user_books")
              .select(
                "id,owner_id,title_override,authors_override,editors_override,designers_override,publisher_override,printer_override,materials_override,edition_override,publish_date_override,description_override,subjects_override,media:user_book_media(kind,storage_path)"
              )
              .eq("edition_id", row.edition.id)
              .neq("id", row.id)
              .limit(20);
            if (!cand.error) {
              const rows = (cand.data ?? []) as any[];
              let best: any | null = null;
              let bestScore = -1;
              for (const r of rows) {
                const media = (r.media ?? []) as any[];
                const candHasCover = media.some((m) => m.kind === "cover" && m.storage_path);
                const candHasImgs = media.some((m) => m.kind === "image" && m.storage_path);

                let score = 0;
                // Only count improvements relative to what you're missing.
                if (!hasCoverMedia && candHasCover) score += 100;
                if (!hasAnyImages && candHasImgs) score += 10;
                if (missingPublisher && r.publisher_override) score += 2;
                if (missingPublishDate && r.publish_date_override) score += 1;
                if (missingDescription && r.description_override) score += 1;
                if (missingSubjects && Array.isArray(r.subjects_override) && r.subjects_override.length > 0) score += 1;
                if (missingAuthors && Array.isArray(r.authors_override) && r.authors_override.length > 0) score += 1;
                if (missingTitle && r.title_override) score += 1;

                const missingEditors = (!row.editors_override || row.editors_override.length === 0);
                const missingDesigners = (!row.designers_override || row.designers_override.length === 0);
                const missingPrinter = !row.printer_override;
                const missingMaterials = !row.materials_override;
                const missingEdition = !row.edition_override;

                if (missingEditors && Array.isArray(r.editors_override) && r.editors_override.length > 0) score += 1;
                if (missingDesigners && Array.isArray(r.designers_override) && r.designers_override.length > 0) score += 1;
                if (missingPrinter && r.printer_override) score += 1;
                if (missingMaterials && r.materials_override) score += 1;
                if (missingEdition && r.edition_override) score += 1;

                if (score > bestScore) {
                  bestScore = score;
                  best = r;
                }
              }

              if (best && bestScore > 0) {
                const profileRes = await supabase.from("profiles").select("username").eq("id", best.owner_id).maybeSingle();
                const owner_username = (profileRes.data?.username as string | undefined) ?? null;
                setMergeSource({
                  user_book_id: best.id as number,
                  owner_id: best.owner_id as string,
                  owner_username,
                  title_override: best.title_override ?? null,
                  authors_override: (best.authors_override ?? null) as any,
                  editors_override: (best.editors_override ?? null) as any,
                  designers_override: (best.designers_override ?? null) as any,
                  publisher_override: best.publisher_override ?? null,
                  printer_override: best.printer_override ?? null,
                  materials_override: best.materials_override ?? null,
                  edition_override: best.edition_override ?? null,
                  publish_date_override: best.publish_date_override ?? null,
                  description_override: best.description_override ?? null,
                  subjects_override: (best.subjects_override ?? null) as any,
                  media: ((best.media ?? []) as any[])
                    .filter((m) => (m.kind === "cover" || m.kind === "image") && typeof m.storage_path === "string" && m.storage_path)
                    .map((m) => ({ kind: m.kind as "cover" | "image", storage_path: m.storage_path as string }))
                });
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
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, userId]);

  const effectiveTitle = useMemo(() => {
    return formTitle.trim() ? formTitle.trim() : book?.edition?.title ?? "(untitled)";
  }, [formTitle, book]);

  const effectivePublisher = useMemo(() => {
    return formPublisher.trim() ? formPublisher.trim() : book?.edition?.publisher ?? "";
  }, [formPublisher, book]);

  const effectivePublishDate = useMemo(() => {
    return formPublishDate.trim() ? formPublishDate.trim() : book?.edition?.publish_date ?? "";
  }, [formPublishDate, book]);

  const effectiveDescription = useMemo(() => {
    return formDescription.trim() ? formDescription.trim() : book?.edition?.description ?? "";
  }, [formDescription, book]);

  const effectiveAuthors = useMemo(() => {
    const override = parseAuthorsInput(formAuthors);
    if (override.length > 0) return override;
    return (book?.edition?.authors ?? []).filter(Boolean);
  }, [formAuthors, book]);

  const effectiveEditors = useMemo(() => parseAuthorsInput(formEditors), [formEditors]);
  const effectiveDesigners = useMemo(() => parseAuthorsInput(formDesigners), [formDesigners]);

  const isOwner = Boolean(book && userId && book.owner_id === userId);

  const copiesLabel = useMemo(() => {
    if (!book?.owner_id) return "Copies";
    if (userId && book.owner_id === userId) return "Your copies";
    return "Copies";
  }, [book?.owner_id, userId]);

  const effectiveSubjects = useMemo(() => {
    const override = book?.subjects_override;
    if (override !== null && override !== undefined) return (override ?? []).filter(Boolean);
    return (book?.edition?.subjects ?? []).filter(Boolean);
  }, [book]);

  const tags = useMemo(() => {
    const all = ((book?.book_tags ?? []).map((bt) => bt.tag).filter(Boolean) as any[]).filter((t) => t?.id && t?.name);
    return all
      .filter((t) => t.kind === "tag")
      .map((t) => ({ id: t.id as number, name: String(t.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [book]);

  const categories = useMemo(() => {
    const all = ((book?.book_tags ?? []).map((bt) => bt.tag).filter(Boolean) as any[]).filter((t) => t?.id && t?.name);
    return all
      .filter((t) => t.kind === "category")
      .map((t) => ({ id: t.id as number, name: String(t.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [book]);

  const coverMedia = useMemo(() => (book?.media ?? []).find((m) => m.kind === "cover") ?? null, [book]);
  const coverUrl = coverMedia ? mediaUrlsByPath[coverMedia.storage_path] : suggestedCoverUrl ?? book?.edition?.cover_url ?? null;
  const coverAspect = useMemo(() => aspectFrom(coverAspectW, coverAspectH), [coverAspectW, coverAspectH]);
  const imageMedia = useMemo(() => (book?.media ?? []).filter((m) => m.kind === "image") ?? [], [book]);

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

  const importPreviewIsbn = useMemo(() => {
    if (!importPreview) return "";
    return String(importPreview.isbn13 ?? importPreview.isbn10 ?? "").trim();
  }, [importPreview]);

  const importPreviewHasIsbn = Boolean(importPreviewIsbn);

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

  async function saveEdits() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    setSaveState({ busy: true, error: null, message: "Saving…" });
    const title_override = formTitle.trim() ? formTitle.trim() : null;
    const authors_override = parseAuthorsInput(formAuthors);
    const editors_override = parseAuthorsInput(formEditors);
    const designers_override = parseAuthorsInput(formDesigners);
    const group_label = formGroupLabel.trim() ? formGroupLabel.trim() : null;
    const object_type = formObjectType.trim() ? formObjectType.trim() : null;
    const decade = formDecade.trim() ? formDecade.trim() : null;
    const pagesRaw = formPages.trim();
    const pages = pagesRaw ? Number(pagesRaw) : null;
    if (pages !== null && !Number.isFinite(pages)) {
      setSaveState({ busy: false, error: "Pages must be a number.", message: "Save failed" });
      return;
    }
    const payload: any = {
      group_label,
      object_type,
      decade,
      pages: pages === null ? null : Math.max(1, Math.floor(pages)),
      title_override,
      authors_override: authors_override.length > 0 ? authors_override : null,
      editors_override: editors_override.length > 0 ? editors_override : null,
      designers_override: designers_override.length > 0 ? designers_override : null,
      publisher_override: formPublisher.trim() ? formPublisher.trim() : null,
      printer_override: formPrinter.trim() ? formPrinter.trim() : null,
      materials_override: formMaterials.trim() ? formMaterials.trim() : null,
      edition_override: formEditionOverride.trim() ? formEditionOverride.trim() : null,
      publish_date_override: formPublishDate.trim() ? formPublishDate.trim() : null,
      description_override: formDescription.trim() ? formDescription.trim() : null,
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
      return;
    }
    await refresh();
    setSaveState({ busy: false, error: null, message: "Saved" });
  }

  function setAuthorsFromList(list: string[]) {
    setFormAuthors(list.join(", "));
  }

  function removeAuthor(name: string) {
    const target = name.trim().toLowerCase();
    if (!target) return;
    const next = (effectiveAuthors ?? []).filter((a) => a.trim().toLowerCase() !== target);
    setAuthorsFromList(next);
  }

  function addAuthor() {
    const name = normalizeAuthorName(newAuthor);
    if (!name) return;
    const existing = (effectiveAuthors ?? []).slice();
    const key = name.toLowerCase();
    if (!existing.some((a) => a.trim().toLowerCase() === key)) existing.push(name);
    setAuthorsFromList(existing);
    setNewAuthor("");
  }

  function setEditorsFromList(list: string[]) {
    setFormEditors(list.join(", "));
  }

  function removeEditor(name: string) {
    const target = name.trim().toLowerCase();
    if (!target) return;
    const next = (effectiveEditors ?? []).filter((a) => a.trim().toLowerCase() !== target);
    setEditorsFromList(next);
  }

  function addEditor() {
    const name = normalizeAuthorName(newEditor);
    if (!name) return;
    const existing = (effectiveEditors ?? []).slice();
    const key = name.toLowerCase();
    if (!existing.some((a) => a.trim().toLowerCase() === key)) existing.push(name);
    setEditorsFromList(existing);
    setNewEditor("");
  }

  function setDesignersFromList(list: string[]) {
    setFormDesigners(list.join(", "));
  }

  function removeDesigner(name: string) {
    const target = name.trim().toLowerCase();
    if (!target) return;
    const next = (effectiveDesigners ?? []).filter((a) => a.trim().toLowerCase() !== target);
    setDesignersFromList(next);
  }

  function addDesigner() {
    const name = normalizeAuthorName(newDesigner);
    if (!name) return;
    const existing = (effectiveDesigners ?? []).slice();
    const key = name.toLowerCase();
    if (!existing.some((a) => a.trim().toLowerCase() === key)) existing.push(name);
    setDesignersFromList(existing);
    setNewDesigner("");
  }

  async function moveToLibrary(nextLibraryId: number) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
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

  async function updateCopies() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    const libId = formLibraryId ?? (book as any).library_id ?? null;
    if (!libId) return;
    const desired = Number(copiesDraft);
    if (!Number.isFinite(desired) || desired < 1) {
      setCopiesUpdateState({ busy: false, error: "Copies must be at least 1", message: "Invalid" });
      return;
    }

    setCopiesUpdateState({ busy: true, error: null, message: "Updating…" });
    try {
      let q = supabase.from("user_books").select("id,created_at").eq("owner_id", userId).eq("library_id", libId);
      if (book.edition?.id) {
        q = q.eq("edition_id", book.edition.id);
      } else {
        q = q.is("edition_id", null);
        if (book.title_override) q = q.eq("title_override", book.title_override);
        else q = q.is("title_override", null);
        if (book.authors_override && book.authors_override.length > 0) q = q.eq("authors_override", book.authors_override);
        else q = q.is("authors_override", null);
      }

      const existing = await q.order("created_at", { ascending: false }).limit(200);
      if (existing.error) throw new Error(existing.error.message);
      const ids = ((existing.data ?? []) as any[]).map((r) => r.id as number).filter((n) => Number.isFinite(n));
      const current = ids.length;

      if (desired === current) {
        setCopiesUpdateState({ busy: false, error: null, message: "No change" });
        window.setTimeout(() => setCopiesUpdateState({ busy: false, error: null, message: null }), 1200);
        return;
      }

      if (desired > current) {
        const toAdd = desired - current;
        const payloadBase: any = {
          owner_id: userId,
          library_id: libId,
          edition_id: book.edition?.id ?? null,
          visibility: formVisibility,
          status: formStatus,
          title_override: book.title_override ?? null,
          authors_override: (book.authors_override ?? null) as any,
          editors_override: (book.editors_override ?? null) as any,
          designers_override: (book.designers_override ?? null) as any,
          publisher_override: book.publisher_override ?? null,
          printer_override: book.printer_override ?? null,
          materials_override: book.materials_override ?? null,
          edition_override: book.edition_override ?? null,
          publish_date_override: book.publish_date_override ?? null,
          description_override: book.description_override ?? null,
          subjects_override: book.subjects_override ?? null,
          location: null,
          shelf: null,
          notes: null
        };
        const rows = Array.from({ length: toAdd }, () => ({ ...payloadBase }));
        const ins = await supabase.from("user_books").insert(rows as any);
        if (ins.error) throw new Error(ins.error.message);
      } else {
        const toRemove = current - desired;
        const removable = ids.filter((id) => id !== book.id);
        const idsToDelete = removable.slice(0, toRemove);
        if (idsToDelete.length < toRemove) throw new Error("To reduce copies below 1, use Delete instead.");
        const del = await supabase.from("user_books").delete().in("id", idsToDelete);
        if (del.error) throw new Error(del.error.message);
      }

      await refresh();
      setCopiesUpdateState({ busy: false, error: null, message: "Updated" });
      window.setTimeout(() => setCopiesUpdateState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setCopiesUpdateState({ busy: false, error: e?.message ?? "Update failed", message: "Update failed" });
    }
  }

  async function getOrCreateTagId(name: string, kind: "tag" | "category"): Promise<number> {
    if (!supabase || !userId) throw new Error("Not signed in");
    const normalized = normalizeTagName(name);
    const existing = await supabase.from("tags").select("id").eq("owner_id", userId).eq("name", normalized).eq("kind", kind).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.id) return existing.data.id as number;
    const inserted = await supabase.from("tags").insert({ owner_id: userId, name: normalized, kind }).select("id").single();
    if (inserted.error) throw new Error(inserted.error.message);
    return inserted.data.id as number;
  }

  async function addTag() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    const name = normalizeTagName(newTag);
    if (!name) return;
    setTagState({ busy: true, error: null, message: "Adding…" });
    try {
      const tagId = await getOrCreateTagId(name, "tag");
      const ins = await supabase.from("user_book_tags").insert({ user_book_id: book.id, tag_id: tagId });
      if (ins.error && !ins.error.message.toLowerCase().includes("duplicate")) throw new Error(ins.error.message);
      setNewTag("");
      await refresh();
      setTagState({ busy: false, error: null, message: "Added" });
    } catch (e: any) {
      setTagState({ busy: false, error: e?.message ?? "Add failed", message: "Add failed" });
    }
  }

  async function removeTag(tagId: number) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    setTagState({ busy: true, error: null, message: "Removing…" });
    const del = await supabase.from("user_book_tags").delete().eq("user_book_id", book.id).eq("tag_id", tagId);
    if (del.error) {
      setTagState({ busy: false, error: del.error.message, message: "Remove failed" });
      return;
    }
    await refresh();
    setTagState({ busy: false, error: null, message: "Removed" });
  }

  async function addCategory() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    const name = normalizeTagName(newCategory);
    if (!name) return;
    setCategoryState({ busy: true, error: null, message: "Adding…" });
    try {
      const tagId = await getOrCreateTagId(name, "category");
      const ins = await supabase.from("user_book_tags").insert({ user_book_id: book.id, tag_id: tagId });
      if (ins.error && !ins.error.message.toLowerCase().includes("duplicate")) throw new Error(ins.error.message);
      setNewCategory("");
      await refresh();
      setCategoryState({ busy: false, error: null, message: "Added" });
    } catch (e: any) {
      setCategoryState({ busy: false, error: e?.message ?? "Add failed", message: "Add failed" });
    }
  }

  async function removeCategory(tagId: number) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    setCategoryState({ busy: true, error: null, message: "Removing…" });
    const del = await supabase.from("user_book_tags").delete().eq("user_book_id", book.id).eq("tag_id", tagId);
    if (del.error) {
      setCategoryState({ busy: false, error: del.error.message, message: "Remove failed" });
      return;
    }
    await refresh();
    setCategoryState({ busy: false, error: null, message: "Removed" });
  }

  async function addSubject() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    const name = normalizeSubjectName(newSubject);
    if (!name) return;
    setSubjectState({ busy: true, error: null, message: "Adding…" });
    const current = (effectiveSubjects ?? []).slice();
    const exists = current.some((s) => s.toLowerCase() === name.toLowerCase());
    const next = exists ? current : [...current, name];
    next.sort((a, b) => a.localeCompare(b));
    const upd = await supabase.from("user_books").update({ subjects_override: next }).eq("id", book.id);
    if (upd.error) {
      setSubjectState({ busy: false, error: upd.error.message, message: "Add failed" });
      return;
    }
    setNewSubject("");
    await refresh();
    setSubjectState({ busy: false, error: null, message: "Added" });
  }

  async function removeSubject(name: string) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    setSubjectState({ busy: true, error: null, message: "Removing…" });
    const current = (effectiveSubjects ?? []).slice();
    const next = current.filter((s) => s.toLowerCase() !== name.toLowerCase());
    const upd = await supabase.from("user_books").update({ subjects_override: next }).eq("id", book.id);
    if (upd.error) {
      setSubjectState({ busy: false, error: upd.error.message, message: "Remove failed" });
      return;
    }
    await refresh();
    setSubjectState({ busy: false, error: null, message: "Removed" });
  }

  async function uploadCover() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    if (!coverEditorSrc) return;
    setCoverState({ busy: true, error: null, message: "Uploading cover…" });

    try {
      if (!coverCroppedAreaPixels) {
        setCoverState({ busy: false, error: null, message: "Adjust crop first." });
        return;
      }

      const baseName = pendingCover ? safeFileName(pendingCover.name.replace(/\.[^/.]+$/, "")) : "cover-edit";
      const path = `${userId}/${book.id}/cover-${Date.now()}-${baseName}.jpg`;

      // Remove existing cover(s) so we don't accumulate old covers.
      const existing = (book.media ?? []).filter((m) => m.kind === "cover");
      for (const m of existing) {
        if (m?.storage_path) await supabase.storage.from("user-book-media").remove([m.storage_path]);
        if (m?.id) await supabase.from("user_book_media").delete().eq("id", m.id);
      }

      const body: Blob = await cropCoverToBlob({
        imageSrc: coverEditorSrc,
        crop: coverCroppedAreaPixels,
        rotation: coverRotation,
        brightness: clamp(coverBrightness, 0.5, 2),
        contrast: clamp(coverContrast, 0.5, 2)
      });

      const up = await supabase.storage.from("user-book-media").upload(path, body, {
        cacheControl: "3600",
        upsert: false,
        contentType: "image/jpeg"
      });
      if (up.error) {
        setCoverState({ busy: false, error: up.error.message, message: "Upload failed" });
        return;
      }

      const inserted = await supabase
        .from("user_book_media")
        .insert({ user_book_id: book.id, kind: "cover", storage_path: path, caption: null })
        .select("id")
        .single();
      if (inserted.error) {
        setCoverState({ busy: false, error: inserted.error.message, message: "Upload failed" });
        return;
      }

      await supabase
        .from("user_book_media")
        .update({ kind: "image" })
        .eq("user_book_id", book.id)
        .eq("kind", "cover")
        .neq("id", inserted.data.id);

      setPendingCover(null);
      setCoverEditorSrc(null);
      setCoverInputKey((k) => k + 1);
      await refresh();
      setCoverState({ busy: false, error: null, message: "Cover uploaded" });
    } catch (e: any) {
      setCoverState({ busy: false, error: e?.message ?? "Upload failed", message: "Upload failed" });
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

  async function importCoverFromUrl(url: string) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    const value = url.trim();
    if (!value) return;

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
    if (book.owner_id !== userId) return;
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

  async function deleteMedia(mediaId: number, storagePath: string) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
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
    if (book.owner_id !== userId) return;
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

  async function searchMetadata(titleOverride?: string, authorOverride?: string) {
    const title = (titleOverride ?? searchTitle).trim();
    const author = (authorOverride ?? searchAuthor).trim();
    if (!title) return;
    setSearchState({ busy: true, error: null, message: "Searching…" });
    setSearchResults([]);
    try {
      const res = await fetch(`/api/search?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Search failed");
      setSearchResults((json.results ?? []) as MetadataSearchResult[]);
      setSearchState({ busy: false, error: null, message: (json.results ?? []).length ? "Done" : "No results" });
    } catch (e: any) {
      setSearchState({ busy: false, error: e?.message ?? "Search failed", message: "Search failed" });
    }
  }

  async function previewImportFromUrl(urlOverride?: string) {
    const url = (urlOverride ?? importUrl).trim();
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
      const preview = (json.preview ?? null) as ImportPreview | null;
      setImportPreview(preview);
      setImportMeta({
        final_url: typeof json.final_url === "string" ? json.final_url : null,
        domain: typeof json.domain === "string" ? json.domain : null,
        domain_kind: typeof json.domain_kind === "string" ? json.domain_kind : null,
        scraped_sources: Array.isArray(json.scraped?.sources) ? (json.scraped.sources as string[]) : []
      });
      setImportState({ busy: false, error: null, message: preview ? "Preview ready" : "No preview" });
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
      const preview: ImportPreview = {
        title: typeof edition.title === "string" ? edition.title : null,
        authors: Array.isArray(edition.authors) ? edition.authors.filter(Boolean) : [],
        publisher: typeof edition.publisher === "string" ? edition.publisher : null,
        publish_date: typeof edition.publish_date === "string" ? edition.publish_date : null,
        description: typeof edition.description === "string" ? edition.description : null,
        subjects: Array.isArray(edition.subjects) ? edition.subjects.filter(Boolean) : [],
        isbn10: typeof edition.isbn10 === "string" ? edition.isbn10 : null,
        isbn13: typeof edition.isbn13 === "string" ? edition.isbn13 : null,
        cover_url: typeof edition.cover_url === "string" ? edition.cover_url : null,
        cover_candidates: uniqStrings([typeof edition.cover_url === "string" ? edition.cover_url : null]),
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

  async function smartLookup() {
    const value = lookupInput.trim();
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
      setImportUrl(url);
      await previewImportFromUrl(url);
      return;
    }

    const { title, author } = parseTitleAndAuthor(value);
    if (!title) return;
    setSearchTitle(title);
    setSearchAuthor(author ?? "");
    await searchMetadata(title, author ?? "");
  }

  async function linkEditionByIsbn(isbn: string) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;

    const value = isbn.trim();
    if (!value) return;

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

      const upd = await supabase.from("user_books").update({ edition_id: editionId }).eq("id", book.id);
      if (upd.error) throw new Error(upd.error.message);

      await refresh();
      setLinkState({ busy: false, error: null, message: "Linked" });
      window.setTimeout(() => setLinkState({ busy: false, error: null, message: null }), 1500);
    } catch (e: any) {
      setLinkState({ busy: false, error: e?.message ?? "Link failed", message: "Link failed" });
    }
  }

  async function mergeFromSource() {
    if (!supabase || !book || !mergeSource || !userId) return;
    if (book.owner_id !== userId) return;
    if (!window.confirm(`Merge missing metadata + images from ${mergeSource.owner_username ? `@${mergeSource.owner_username}` : "another user"}? This will only fill missing fields and add media to your copy.`)) {
      return;
    }

    setMergeState({ busy: true, error: null, message: "Merging…" });
    try {
      const updates: any = {};

      const needsTitle = !(book.title_override ?? "").trim();
      const needsAuthors = (!book.authors_override || book.authors_override.length === 0) && (!book.edition?.authors || book.edition.authors.length === 0);
      const needsPublisher = !(book.publisher_override ?? "").trim() && !(book.edition?.publisher ?? "").trim();
      const needsPublishDate = !(book.publish_date_override ?? "").trim() && !(book.edition?.publish_date ?? "").trim();
      const needsDescription = !(book.description_override ?? "").trim() && !(book.edition?.description ?? "").trim();
      const needsSubjects = (!book.subjects_override || book.subjects_override.length === 0) && (!book.edition?.subjects || book.edition.subjects.length === 0);
      const needsEditors = !book.editors_override || book.editors_override.length === 0;
      const needsDesigners = !book.designers_override || book.designers_override.length === 0;
      const needsPrinter = !(book.printer_override ?? "").trim();
      const needsMaterials = !(book.materials_override ?? "").trim();
      const needsEditionOverride = !(book.edition_override ?? "").trim();

      if (needsTitle && mergeSource.title_override) updates.title_override = mergeSource.title_override.trim();
      if (needsAuthors && mergeSource.authors_override && mergeSource.authors_override.length > 0) {
        const base = (book.edition?.authors ?? []).filter(Boolean);
        updates.authors_override = uniqStrings([...base, ...mergeSource.authors_override]);
      }
      if (needsPublisher && mergeSource.publisher_override) updates.publisher_override = mergeSource.publisher_override.trim();
      if (needsPublishDate && mergeSource.publish_date_override) updates.publish_date_override = mergeSource.publish_date_override.trim();
      if (needsDescription && mergeSource.description_override) updates.description_override = mergeSource.description_override.trim();
      if (needsSubjects && mergeSource.subjects_override && mergeSource.subjects_override.length > 0) {
        const base = (book.edition?.subjects ?? []).filter(Boolean);
        updates.subjects_override = uniqStrings([...base, ...mergeSource.subjects_override]);
      }
      if (needsEditors && mergeSource.editors_override && mergeSource.editors_override.length > 0) updates.editors_override = mergeSource.editors_override;
      if (needsDesigners && mergeSource.designers_override && mergeSource.designers_override.length > 0) updates.designers_override = mergeSource.designers_override;
      if (needsPrinter && mergeSource.printer_override) updates.printer_override = mergeSource.printer_override.trim();
      if (needsMaterials && mergeSource.materials_override) updates.materials_override = mergeSource.materials_override.trim();
      if (needsEditionOverride && mergeSource.edition_override) updates.edition_override = mergeSource.edition_override.trim();

      if (Object.keys(updates).length > 0) {
        const upd = await supabase.from("user_books").update(updates).eq("id", book.id);
        if (upd.error) throw new Error(upd.error.message);
      }

      const existingCover = (book.media ?? []).some((m) => m.kind === "cover");
      const existingImages = (book.media ?? []).some((m) => m.kind === "image");
      const toCopy = mergeSource.media.filter((m) => {
        if (m.kind === "cover") return !existingCover;
        return !existingImages;
      });

      for (const m of toCopy) {
        const signed = await supabase.storage.from("user-book-media").createSignedUrl(m.storage_path, 60 * 15);
        if (signed.error || !signed.data?.signedUrl) continue;
        const resp = await fetch(`/api/image-proxy?url=${encodeURIComponent(signed.data.signedUrl)}`);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const fileName = safeFileName(String(m.storage_path.split("/").pop() ?? "image"));
        const destPath = `${userId}/${book.id}/merge-${Date.now()}-${fileName}`;
        const up = await supabase.storage.from("user-book-media").upload(destPath, blob, {
          cacheControl: "3600",
          upsert: false,
          contentType: resp.headers.get("content-type") || "application/octet-stream"
        });
        if (up.error) continue;
        const ins = await supabase.from("user_book_media").insert({ user_book_id: book.id, kind: m.kind, storage_path: destPath, caption: null });
        if (ins.error) {
          // ignore; still uploaded
        }
      }

      await refresh();
      setMergeState({ busy: false, error: null, message: "Merged" });
      window.setTimeout(() => setMergeState({ busy: false, error: null, message: null }), 1500);
    } catch (e: any) {
      setMergeState({ busy: false, error: e?.message ?? "Merge failed", message: "Merge failed" });
    }
  }

  if (!supabase) {
    return (
      <main className="container">
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
        </div>
      </main>
    );
  }

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
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>{effectiveTitle}</div>
            <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {isOwner ? (
                <button onClick={() => setEditMode((v) => !v)} disabled={busy}>
                  {editMode ? "Done" : "Edit"}
                </button>
              ) : null}
              <div className="muted">{busy ? "Loading…" : error ? error : ""}</div>
            </div>
          </div>

          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "220px 1fr", gap: 14 }}>
            <div>
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={effectiveTitle}
                  src={coverUrl}
                  style={{ width: "100%", height: isNarrow ? 360 : 280, objectFit: "contain", border: "1px solid var(--border)" }}
                />
              ) : (
                <div style={{ width: "100%", height: isNarrow ? 360 : 280, border: "1px solid var(--border)" }} />
              )}

              {isOwner && editMode ? (
                <div style={{ marginTop: 10 }}>
                  <div className="muted">Cover override</div>
                  <div className="row" style={{ marginTop: 6, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      key={coverInputKey}
                      type="file"
                      accept="image/*"
                      onChange={(ev) => setPendingCover((ev.target.files ?? [])[0] ?? null)}
                      style={{ marginTop: 0 }}
                    />
                    {coverUrl ? (
                      <button
                        onClick={() => {
                          if (!coverUrl) return;
                          setPendingCover(null);
                          setCoverEditorSrc(toProxyImageUrl(coverUrl));
                          setCoverCrop({ x: 0, y: 0 });
                          setCoverZoom(1);
                          setCoverRotation(0);
                          setCoverBrightness(1);
                          setCoverContrast(1);
                          setCoverAspectW(2);
                          setCoverAspectH(3);
                          setCoverCroppedAreaPixels(null);
                        }}
                        disabled={coverState.busy}
                      >
                        Edit current cover
                      </button>
                    ) : null}
                    {coverEditorSrc ? (
                      <button
                        onClick={() => {
                          if (coverEditorObjectUrlRef.current) {
                            URL.revokeObjectURL(coverEditorObjectUrlRef.current);
                            coverEditorObjectUrlRef.current = null;
                          }
                          setPendingCover(null);
                          setCoverEditorSrc(null);
                          setCoverInputKey((k) => k + 1);
                        }}
                        disabled={coverState.busy}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  {coverEditorSrc ? (
                    <div style={{ marginTop: 8 }}>
                      <div
                        style={{
                          position: "relative",
                          width: "100%",
                          height: 260,
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          filter: `brightness(${coverBrightness}) contrast(${coverContrast})`
                        }}
                      >
                        <Cropper
                          image={coverEditorSrc}
                          crop={coverCrop}
                          zoom={coverZoom}
                          rotation={coverRotation}
                          aspect={coverAspect}
                          onCropChange={setCoverCrop}
                          onZoomChange={setCoverZoom}
                          onRotationChange={setCoverRotation}
                          onCropComplete={(_area, pixels) => setCoverCroppedAreaPixels(pixels)}
                          showGrid={false}
                        />
                      </div>

                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <div className="muted" style={{ width: 72 }}>
                            Aspect
                          </div>
                          <input
                            type="number"
                            value={coverAspectW}
                            min={1}
                            step={1}
                            onChange={(e) => setCoverAspectW(Math.max(1, Number(e.target.value) || 1))}
                            style={{ width: 64 }}
                          />
                          <span className="muted">:</span>
                          <input
                            type="number"
                            value={coverAspectH}
                            min={1}
                            step={1}
                            onChange={(e) => setCoverAspectH(Math.max(1, Number(e.target.value) || 1))}
                            style={{ width: 64 }}
                          />
                          <button
                            onClick={() => {
                              setCoverAspectW(2);
                              setCoverAspectH(3);
                            }}
                          >
                            2:3
                          </button>
                          <button
                            onClick={() => {
                              setCoverAspectW(1);
                              setCoverAspectH(1);
                            }}
                          >
                            1:1
                          </button>
                          <button
                            onClick={() => {
                              setCoverAspectW(3);
                              setCoverAspectH(2);
                            }}
                          >
                            3:2
                          </button>
                        </div>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <div className="muted" style={{ width: 72 }}>
                            Zoom
                          </div>
                          <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.01}
                            value={coverZoom}
                            onChange={(e) => setCoverZoom(Number(e.target.value))}
                            style={{ flex: "1 1 auto" }}
                          />
                        </div>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <div className="muted" style={{ width: 72 }}>
                            Rotate
                          </div>
                          <input
                            type="range"
                            min={-180}
                            max={180}
                            step={1}
                            value={coverRotation}
                            onChange={(e) => setCoverRotation(Number(e.target.value))}
                            style={{ flex: "1 1 auto" }}
                          />
                        </div>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <div className="muted" style={{ width: 72 }}>
                            Bright
                          </div>
                          <input
                            type="range"
                            min={0.7}
                            max={1.3}
                            step={0.01}
                            value={coverBrightness}
                            onChange={(e) => setCoverBrightness(Number(e.target.value))}
                            style={{ flex: "1 1 auto" }}
                          />
                        </div>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <div className="muted" style={{ width: 72 }}>
                            Contrast
                          </div>
                          <input
                            type="range"
                            min={0.7}
                            max={1.3}
                            step={0.01}
                            value={coverContrast}
                            onChange={(e) => setCoverContrast(Number(e.target.value))}
                            style={{ flex: "1 1 auto" }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {coverEditorSrc ? (
                    <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                      <button onClick={uploadCover} disabled={coverState.busy}>
                        {coverState.busy ? "Uploading…" : "Submit cover"}
                      </button>
                    </div>
                  ) : null}
                  {coverState.message ? (
                    <div className="muted" style={{ marginTop: 6 }}>
                      {coverState.error ? `${coverState.message} (${coverState.error})` : coverState.message}
                    </div>
                  ) : null}
                  {suggestedCoverUrl ? (
                    <div style={{ marginTop: 10 }}>
                      <div className="muted">Cover from preview</div>
                      <div className="row" style={{ marginTop: 6, justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={suggestedCoverUrl}
                            alt=""
                            width={44}
                            height={66}
                            style={{ display: "block", objectFit: "cover", border: "1px solid var(--border)" }}
                          />
                          <div className="muted" style={{ maxWidth: 140, wordBreak: "break-word" }}>
                            <a href={suggestedCoverUrl} target="_blank" rel="noreferrer">
                              open
                            </a>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                          <button onClick={() => importCoverFromUrl(suggestedCoverUrl)} disabled={suggestedCoverState.busy}>
                            {suggestedCoverState.busy ? "Importing…" : "Use as cover"}
                          </button>
                          <button onClick={() => setSuggestedCoverUrl(null)} disabled={suggestedCoverState.busy}>
                            Clear
                          </button>
                        </div>
                      </div>
                      {suggestedCoverState.message ? (
                        <div className="muted" style={{ marginTop: 6 }}>
                          {suggestedCoverState.error
                            ? `${suggestedCoverState.message} (${suggestedCoverState.error})`
                            : suggestedCoverState.message}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div>
              {mergeSource && book?.owner_id === userId && !mergeDismissed ? (
                <div style={{ marginBottom: 12 }} className="card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>Merge from community</div>
                    <div className="muted">{mergeSource.owner_username ? `@${mergeSource.owner_username}` : "available"}</div>
                  </div>
                  <div className="muted" style={{ marginTop: 8 }}>
                    Copy missing metadata + images from another visible copy of this same edition.
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <button onClick={mergeFromSource} disabled={mergeState.busy || busy}>
                      {mergeState.busy ? "Merging…" : "Merge"}
                    </button>
                    <button
                      onClick={() => {
                        try {
                          window.localStorage.setItem(`om_mergeDismissed:${bookId}`, "1");
                        } catch {
                          // ignore
                        }
                        setMergeDismissed(true);
                      }}
                      disabled={mergeState.busy || busy}
                    >
                      Dismiss
                    </button>
                    <div className="muted">{mergeState.message ? (mergeState.error ? `${mergeState.message} (${mergeState.error})` : mergeState.message) : ""}</div>
                  </div>
                </div>
              ) : null}

              {!isOwner || (isOwner && !editMode) ? (
                <>
                  <div className="muted">Authors</div>
                  <div style={{ marginTop: 4 }}>
                    {effectiveAuthors.length > 0 ? (
                      <>
                        {effectiveAuthors.map((a, idx) => (
                          <span key={a}>
                            <Link href={`/app?author=${encodeURIComponent(a)}`}>{a}</Link>
                            {idx < effectiveAuthors.length - 1 ? <span>, </span> : null}
                          </span>
                        ))}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>

                  <div style={{ marginTop: 14 }} className="muted">
                    Metadata
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <div className="row">
                      <div style={{ minWidth: 110 }} className="muted">
                        ISBN
                      </div>
                      <div>{book?.edition?.isbn13 ?? book?.edition?.isbn10 ?? "—"}</div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Editors
                      </div>
                      <div>{effectiveEditors.length > 0 ? effectiveEditors.join(", ") : "—"}</div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Designers
                      </div>
                      <div>{effectiveDesigners.length > 0 ? effectiveDesigners.join(", ") : "—"}</div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Printer
                      </div>
                      <div>{formPrinter.trim() ? formPrinter.trim() : "—"}</div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Materials
                      </div>
                      <div>{formMaterials.trim() ? formMaterials.trim() : "—"}</div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Edition
                      </div>
                      <div>{formEditionOverride.trim() ? formEditionOverride.trim() : "—"}</div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Publisher
                      </div>
                      <div>
                        {effectivePublisher ? <Link href={`/app?publisher=${encodeURIComponent(effectivePublisher)}`}>{effectivePublisher}</Link> : "—"}
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Publish date
                      </div>
                      <div>{effectivePublishDate || "—"}</div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Pages
                      </div>
                      <div>{book?.pages ? String(book.pages) : "—"}</div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Group
                      </div>
                      <div>{(book?.group_label ?? "").trim() ? (book?.group_label ?? "").trim() : "—"}</div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Object type
                      </div>
                      <div>{(book?.object_type ?? "").trim() ? (book?.object_type ?? "").trim() : "—"}</div>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Decade
                      </div>
                      <div>{(book?.decade ?? "").trim() ? (book?.decade ?? "").trim() : "—"}</div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <div className="muted">Subjects</div>
                      <div style={{ marginTop: 6 }}>
                        {effectiveSubjects.length > 0 ? (
                          effectiveSubjects.map((s) => (
                            <span key={s} style={{ marginRight: 10 }}>
                              <Link href={`/app?subject=${encodeURIComponent(s)}`}>{s}</Link>
                            </span>
                          ))
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <div className="muted">Description</div>
                      <div className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                        {effectiveDescription || "—"}
                      </div>
                    </div>
                    {book?.edition?.cover_url ? (
                      <div style={{ marginTop: 8 }} className="muted">
                        Online cover:{" "}
                        <a href={book.edition.cover_url} target="_blank" rel="noreferrer">
                          open
                        </a>
                      </div>
                    ) : null}
                    {publicBookUrl ? (
                      <div className="row" style={{ marginTop: 10, justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          URL
                        </div>
                        <div style={{ flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis" }}>
                          <a href={publicBookUrl} target="_blank" rel="noreferrer">
                            {publicBookUrl}
                          </a>
                        </div>
                        <button onClick={copyPublicLink} style={{ flex: "0 0 auto" }}>
                          Copy
                        </button>
                        <div className="muted" style={{ flex: "0 0 auto" }}>
                          {shareState.message ? (shareState.error ? `${shareState.message} (${shareState.error})` : shareState.message) : ""}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {isOwner && editMode ? (
                <details style={{ marginTop: 14 }}>
                  <summary className="muted">Find more metadata</summary>
                  <div style={{ marginTop: 10 }} className="card">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                      <div>Lookup</div>
                      <div className="muted">
                        {importState.busy || searchState.busy ? "Working…" : importState.error || searchState.error ? "Error" : ""}
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <input
                        placeholder='ISBN, URL, or "Title by Author"'
                        value={lookupInput}
                        onChange={(e) => setLookupInput(e.target.value)}
                        onKeyDown={(e) => onEnter(e, smartLookup)}
                        style={{ width: 520, maxWidth: "100%" }}
                      />
                      <button onClick={smartLookup} disabled={(importState.busy || searchState.busy) || !lookupInput.trim()}>
                        Find
                      </button>
                      <span className="muted" style={{ marginLeft: 10 }}>
                        {importState.message
                          ? importState.error
                            ? `${importState.message} (${importState.error})`
                            : importState.message
                          : searchState.message
                            ? searchState.error
                              ? `${searchState.message} (${searchState.error})`
                              : searchState.message
                            : ""}
                      </span>
                    </div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      Enter an ISBN, paste a link, or search by title/author. Review results, then click <span>Link ISBN</span> or <span>Fill fields</span>.
                    </div>
                  </div>

                  {searchResults.length > 0 ? (
                    <div style={{ marginTop: 10 }} className="card">
                      <div className="muted">Title/author results</div>
                      <div style={{ marginTop: 6 }}>
                        {searchResults.map((r, idx) => {
                          const bestIsbn = r.isbn13 ?? r.isbn10 ?? "";
                          const hasIsbn = Boolean(bestIsbn);
                          const title = (r.title ?? "").trim() || "—";
                          const authors = (r.authors ?? []).filter(Boolean).join(", ");
                          const pub = [r.publisher ?? "", r.publish_date ?? (r.publish_year ? String(r.publish_year) : "")]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <div key={`${r.source}:${bestIsbn || title}:${idx}`} className="card" style={{ marginTop: 8 }}>
                              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                                <div style={{ width: 62, flex: "0 0 auto" }}>
                                  {r.cover_url ? (
                                    <img
                                      src={r.cover_url}
                                      alt=""
                                      width={60}
                                      height={90}
                                      style={{ display: "block", objectFit: "cover", border: "1px solid var(--border)" }}
                                    />
                                  ) : (
                                    <div style={{ width: 60, height: 90, border: "1px solid var(--border)" }} />
                                  )}
                                </div>
                                <div>
                                  <div>{title}</div>
                                  <div className="muted" style={{ marginTop: 4 }}>
                                    {authors || "—"}
                                    {pub ? ` · ${pub}` : ""}
                                  </div>
                                  <div className="muted" style={{ marginTop: 4 }}>
                                    {bestIsbn ? `ISBN: ${bestIsbn}` : "No ISBN found"}
                                    {r.cover_url ? (
                                      <>
                                        {" "}
                                        ·{" "}
                                        <a href={r.cover_url} target="_blank" rel="noreferrer">
                                          cover
                                        </a>
                                      </>
                                    ) : null}{" "}
                                    · {r.source}
                                  </div>
                                </div>
                                <div style={{ flex: "0 0 auto" }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                                    {hasIsbn ? (
                                      <button onClick={() => linkEditionByIsbn(bestIsbn)} disabled={linkState.busy || !bestIsbn}>
                                        Link ISBN
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          if (r.title) setFormTitle(r.title);
                                          setFormAuthors((r.authors ?? []).filter(Boolean).join(", "));
                                          if (r.publisher) setFormPublisher(r.publisher);
                                          if (r.publish_date) setFormPublishDate(r.publish_date);
                                          if (r.cover_url) setSuggestedCoverUrl(r.cover_url);
                                          setSearchState((s) => ({ ...s, message: "Filled fields (not saved)" }));
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
                    </div>
                  ) : null}

                  {importPreview
                    ? (() => {
                        const preview = importPreview as ImportPreview;
                        const previewCoverUrl = preview.cover_url ?? undefined;
                        const previewFinalUrl = importMeta.final_url ?? undefined;
                        return (
                          <div style={{ marginTop: 10 }} className="card">
                            <div className="muted">Preview</div>
                            <div style={{ marginTop: 6 }} className="card">
                              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                                <div style={{ width: 62, flex: "0 0 auto" }}>
                                  {previewCoverUrl ? (
                                    <img
                                      src={previewCoverUrl}
                                      alt=""
                                      width={60}
                                      height={90}
                                      style={{ display: "block", objectFit: "cover", border: "1px solid var(--border)" }}
                                    />
                                  ) : (
                                    <div style={{ width: 60, height: 90, border: "1px solid var(--border)" }} />
                                  )}
                                </div>
                                <div style={{ flex: "1 1 auto" }}>
                                  <div>{(preview.title ?? "").trim() || "—"}</div>
                                  <div className="muted" style={{ marginTop: 4 }}>
                                    {(preview.authors ?? []).filter(Boolean).join(", ") || "—"}
                                  </div>
                                  <div className="muted" style={{ marginTop: 4 }}>
                                    {[preview.publisher ?? "", preview.publish_date ?? ""].filter(Boolean).join(" · ") || "—"}
                                  </div>
                                  <div className="muted" style={{ marginTop: 4 }}>
                                    {preview.isbn13 || preview.isbn10 ? `ISBN: ${preview.isbn13 ?? preview.isbn10}` : "No ISBN found"} · sources:{" "}
                                    {(preview.sources ?? []).join(", ") || "—"}
                                  </div>
                                  <div className="muted" style={{ marginTop: 4 }}>
                                    {importMeta.domain ? `${importMeta.domain_kind ?? "generic"} · ${importMeta.domain}` : importMeta.domain_kind ?? ""}
                                    {previewFinalUrl ? (
                                      <>
                                        {" "}
                                        ·{" "}
                                        <a href={previewFinalUrl} target="_blank" rel="noreferrer">
                                          open page
                                        </a>
                                      </>
                                    ) : null}
                                    {previewCoverUrl ? (
                                      <>
                                        {" "}
                                        ·{" "}
                                        <a href={previewCoverUrl} target="_blank" rel="noreferrer">
                                          open cover
                                        </a>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                                <div style={{ flex: "0 0 auto" }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                                    {importPreviewHasIsbn ? (
                                      <button onClick={() => linkEditionByIsbn(importPreviewIsbn)} disabled={linkState.busy || !importPreviewIsbn}>
                                        Link ISBN
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          if (preview.title) setFormTitle(preview.title);
                                          setFormAuthors((preview.authors ?? []).filter(Boolean).join(", "));
                                          if (preview.publisher) setFormPublisher(preview.publisher);
                                          if (preview.publish_date) setFormPublishDate(preview.publish_date);
                                          if (preview.description) setFormDescription(preview.description);
                                          if (preview.cover_url) setSuggestedCoverUrl(preview.cover_url);
                                          setImportState((s) => ({ ...s, message: "Filled fields (not saved)" }));
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
                                    )}
                                  </div>
                                </div>
                              </div>
                              {preview.subjects && preview.subjects.length > 0 ? (
                                <div className="muted" style={{ marginTop: 10 }}>
                                  Subjects found: {preview.subjects.slice(0, 12).join(", ")}
                                  {preview.subjects.length > 12 ? "…" : ""} (you can add them below)
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })()
                    : null}
                </details>
              ) : null}

              {isOwner && editMode ? (
                <>
                  <div style={{ marginTop: 16 }} className="muted">
                    Metadata
                  </div>
                  <div style={{ marginTop: 8 }}>
                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    ISBN
                  </div>
                  <div>{book?.edition?.isbn13 ?? book?.edition?.isbn10 ?? "—"}</div>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Title
                  </div>
                  <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} onKeyDown={(e) => onEnter(e, saveEdits)} style={{ width: 360 }} />
                </div>

                <div style={{ marginTop: 8 }}>
                  <div className="muted">Authors</div>
                  <div style={{ marginTop: 6 }}>
                    {effectiveAuthors.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {effectiveAuthors.map((a) => (
                          <span
                            key={a}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              border: "1px solid var(--border)",
                              padding: "2px 6px"
                            }}
                          >
                            <Link href={`/app?author=${encodeURIComponent(a)}`} style={{ textDecoration: "none" }}>
                              {a}
                            </Link>
                            <button onClick={() => removeAuthor(a)} aria-label={`Remove author ${a}`}>
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="muted">—</div>
                    )}
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <input
                      value={newAuthor}
                      onChange={(e) => setNewAuthor(e.target.value)}
                      onKeyDown={(e) => onEnter(e, addAuthor)}
                      placeholder="Add an author"
                      style={{ width: 220 }}
                    />
                    <button onClick={addAuthor} disabled={!newAuthor.trim()}>
                      Add
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div className="muted">Editors</div>
                  <div style={{ marginTop: 6 }}>
                    {effectiveEditors.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {effectiveEditors.map((a) => (
                          <span
                            key={a}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              border: "1px solid var(--border)",
                              padding: "2px 6px"
                            }}
                          >
                            <span>{a}</span>
                            <button onClick={() => removeEditor(a)} aria-label={`Remove editor ${a}`}>
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="muted">—</div>
                    )}
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <input
                      value={newEditor}
                      onChange={(e) => setNewEditor(e.target.value)}
                      onKeyDown={(e) => onEnter(e, addEditor)}
                      placeholder="Add an editor"
                      style={{ width: 220 }}
                    />
                    <button onClick={addEditor} disabled={!newEditor.trim()}>
                      Add
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div className="muted">Designers</div>
                  <div style={{ marginTop: 6 }}>
                    {effectiveDesigners.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {effectiveDesigners.map((a) => (
                          <span
                            key={a}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              border: "1px solid var(--border)",
                              padding: "2px 6px"
                            }}
                          >
                            <span>{a}</span>
                            <button onClick={() => removeDesigner(a)} aria-label={`Remove designer ${a}`}>
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="muted">—</div>
                    )}
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <input
                      value={newDesigner}
                      onChange={(e) => setNewDesigner(e.target.value)}
                      onKeyDown={(e) => onEnter(e, addDesigner)}
                      placeholder="Add a designer"
                      style={{ width: 220 }}
                    />
                    <button onClick={addDesigner} disabled={!newDesigner.trim()}>
                      Add
                    </button>
                  </div>
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Printer
                  </div>
                  <input
                    value={formPrinter}
                    onChange={(e) => setFormPrinter(e.target.value)}
                    onKeyDown={(e) => onEnter(e, saveEdits)}
                    style={{ width: 360 }}
                  />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Materials
                  </div>
                  <input
                    value={formMaterials}
                    onChange={(e) => setFormMaterials(e.target.value)}
                    onKeyDown={(e) => onEnter(e, saveEdits)}
                    style={{ width: 360 }}
                  />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Edition
                  </div>
                  <input
                    value={formEditionOverride}
                    onChange={(e) => setFormEditionOverride(e.target.value)}
                    onKeyDown={(e) => onEnter(e, saveEdits)}
                    style={{ width: 360 }}
                  />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Publisher
                  </div>
                  <input value={formPublisher} onChange={(e) => setFormPublisher(e.target.value)} onKeyDown={(e) => onEnter(e, saveEdits)} style={{ width: 360 }} />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Publish date
                  </div>
                  <input type="date" value={formPublishDate || ""} onChange={(e) => setFormPublishDate(e.target.value)} onKeyDown={(e) => onEnter(e, saveEdits)} />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Pages
                  </div>
                  <input
                    type="number"
                    value={formPages}
                    onChange={(e) => setFormPages(e.target.value)}
                    onKeyDown={(e) => onEnter(e, saveEdits)}
                    style={{ width: 120 }}
                    min={1}
                  />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Group
                  </div>
                  <input
                    value={formGroupLabel}
                    onChange={(e) => setFormGroupLabel(e.target.value)}
                    onKeyDown={(e) => onEnter(e, saveEdits)}
                    style={{ width: 360 }}
                  />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Object type
                  </div>
                  <select value={formObjectType} onChange={(e) => setFormObjectType(e.target.value)} style={{ width: 220 }}>
                    <option value="">—</option>
                    <option value="book">book</option>
                    <option value="magazine">magazine</option>
                    <option value="ephemera">ephemera</option>
                    <option value="video">video</option>
                    <option value="music">music</option>
                  </select>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Decade
                  </div>
                  <select value={formDecade} onChange={(e) => setFormDecade(e.target.value)} style={{ width: 220 }}>
                    <option value="">—</option>
                    <option value="prewar">Prewar</option>
                    <option value="1950s">1950s</option>
                    <option value="1960s">1960s</option>
                    <option value="1970s">1970s</option>
                    <option value="1980s">1980s</option>
                    <option value="1990s">1990s</option>
                    <option value="2000s">2000s</option>
                    <option value="2010s">2010s</option>
                    <option value="2020s">2020s</option>
                  </select>
                </div>

                <div style={{ marginTop: 8 }}>
                  <div className="muted">Description</div>
                  <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={4} style={{ width: "100%", marginTop: 6 }} />
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Book info
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <div style={{ minWidth: 110 }} className="muted">
                    Catalog
                  </div>
                  <select
                    value={formLibraryId ?? ""}
                    onChange={(e) => moveToLibrary(Number(e.target.value))}
                    disabled={libraryMoveState.busy || libraries.length === 0}
                    style={{ width: 220 }}
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
                  <div className="muted" style={{ marginLeft: 10 }}>
                    {libraryMoveState.message ? (libraryMoveState.error ? `${libraryMoveState.message} (${libraryMoveState.error})` : libraryMoveState.message) : ""}
                  </div>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    {copiesLabel}
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={copiesDraft || ""}
                    onChange={(e) => setCopiesDraft(e.target.value)}
                    onKeyDown={(e) => onEnter(e, updateCopies)}
                    style={{ width: 90 }}
                  />
                  <button onClick={updateCopies} disabled={copiesUpdateState.busy || copiesCountState.busy || !copiesDraft.trim()}>
                    {copiesUpdateState.busy ? "Updating…" : "Update"}
                  </button>
                  <div className="muted" style={{ marginLeft: 10 }}>
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
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Subjects
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <input
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    onKeyDown={(e) => onEnter(e, addSubject)}
                    placeholder="Add a subject"
                    style={{ width: 220 }}
                  />
                  <button onClick={addSubject} disabled={subjectState.busy || !newSubject.trim()}>
                    Add
                  </button>
                  <div className="muted">
                    {subjectState.message ? (subjectState.error ? `${subjectState.message} (${subjectState.error})` : subjectState.message) : ""}
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  {effectiveSubjects.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {effectiveSubjects
                        .slice()
                        .sort((a, b) => a.localeCompare(b))
                        .map((s) => (
                          <span
                            key={s}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              border: "1px solid var(--border)",
                              padding: "2px 6px"
                            }}
                          >
                            <Link href={`/app?subject=${encodeURIComponent(s)}`} style={{ textDecoration: "none" }}>
                              {s}
                            </Link>
                            <button onClick={() => removeSubject(s)} disabled={subjectState.busy} aria-label={`Remove subject ${s}`}>
                              ×
                            </button>
                          </span>
                        ))}
                    </div>
                  ) : (
                    <div className="muted">No subjects yet.</div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Categories
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <input
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    onKeyDown={(e) => onEnter(e, addCategory)}
                    placeholder="Add a category"
                    style={{ width: 220 }}
                  />
                  <button onClick={addCategory} disabled={categoryState.busy || !newCategory.trim()}>
                    Add
                  </button>
                  <div className="muted">{categoryState.message ? (categoryState.error ? `${categoryState.message} (${categoryState.error})` : categoryState.message) : ""}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  {categories.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {categories.map((t) => (
                        <span
                          key={t.id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            border: "1px solid var(--border)",
                            padding: "2px 6px"
                          }}
                        >
                          <Link href={`/app?category=${encodeURIComponent(t.name)}`} style={{ textDecoration: "none" }}>
                            {t.name}
                          </Link>
                          <button onClick={() => removeCategory(t.id)} disabled={categoryState.busy} aria-label={`Remove category ${t.name}`}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="muted">No categories yet.</div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Tags
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => onEnter(e, addTag)}
                    placeholder="Add a tag"
                    style={{ width: 220 }}
                  />
                  <button onClick={addTag} disabled={tagState.busy || !newTag.trim()}>
                    Add
                  </button>
                  <div className="muted">{tagState.message ? (tagState.error ? `${tagState.message} (${tagState.error})` : tagState.message) : ""}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  {tags.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {tags.map((t) => (
                        <span
                          key={t.id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            border: "1px solid var(--border)",
                            padding: "2px 6px"
                          }}
                        >
                          <Link href={`/app?tag=${encodeURIComponent(t.name)}`} style={{ textDecoration: "none" }}>
                            {t.name}
                          </Link>
                          <button onClick={() => removeTag(t.id)} disabled={tagState.busy} aria-label={`Remove tag ${t.name}`}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="muted">No tags yet.</div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Privacy &amp; lending
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <div style={{ minWidth: 110 }} className="muted">
                    Visibility
                  </div>
                  {formVisibility === "inherit" ? (
                    <>
                      <div className="muted" style={{ width: 220 }}>
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
                      <select value={formVisibility} onChange={(e) => setFormVisibility(e.target.value as any)} style={{ width: 220 }}>
                        <option value="followers_only">private</option>
                        <option value="public">public</option>
                      </select>
                      <button onClick={() => setFormVisibility("inherit")}>Revert</button>
                    </>
                  )}
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Status
                  </div>
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as any)} style={{ width: 220 }}>
                    <option value="owned">owned</option>
                    <option value="loaned">loaned</option>
                    <option value="selling">selling</option>
                    <option value="trading">trading</option>
                  </select>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Borrowable
                  </div>
                  {formBorrowable === "inherit" ? (
                    <>
                      <div className="muted" style={{ width: 220 }}>
                        {ownerBorrowDefaults ? `From settings: ${ownerBorrowDefaults.borrowable_default ? "yes" : "no"}` : "From settings: …"}
                      </div>
                      <button onClick={() => setFormBorrowable(ownerBorrowDefaults?.borrowable_default ? "yes" : "no")} disabled={!ownerBorrowDefaults}>
                        Override
                      </button>
                    </>
                  ) : (
                    <>
                      <select value={formBorrowable} onChange={(e) => setFormBorrowable(e.target.value as any)} style={{ width: 220 }}>
                        <option value="yes">yes</option>
                        <option value="no">no</option>
                      </select>
                      <button onClick={() => setFormBorrowable("inherit")}>Revert</button>
                    </>
                  )}
                </div>
              </div>

              {/* Share link is shown in view-mode under metadata */}

              <div style={{ marginTop: 16 }} className="muted">
                Location
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <div style={{ minWidth: 110 }} className="muted">
                    Location
                  </div>
                  <input
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    onKeyDown={(e) => onEnter(e, saveEdits)}
                    placeholder="Home, Studio…"
                    style={{ width: 360 }}
                  />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Shelf
                  </div>
                  <input
                    value={formShelf}
                    onChange={(e) => setFormShelf(e.target.value)}
                    onKeyDown={(e) => onEnter(e, saveEdits)}
                    placeholder="Shelf #"
                    style={{ width: 360 }}
                  />
                </div>

                <div style={{ marginTop: 8 }}>
                  <div className="muted">Notes</div>
                  <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={4} style={{ width: "100%", marginTop: 6 }} />
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Images
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="muted">Upload additional images</div>
                <input key={imagesInputKey} type="file" accept="image/*" multiple onChange={(ev) => selectPendingImages(ev.target.files)} style={{ marginTop: 6 }} />

                {pendingImages.length > 0 ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    <div>Selected (not uploaded yet):</div>
                    <div style={{ marginTop: 6 }}>
                      {pendingImages.map((f) => (
                        <div key={`${f.name}:${f.size}:${f.lastModified}`}>{f.name}</div>
                      ))}
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button onClick={uploadImages} disabled={imagesState.busy}>
                        {imagesState.busy ? "Uploading…" : "Submit"}
                      </button>
                      <button onClick={clearPendingImages} disabled={imagesState.busy} style={{ marginLeft: 8 }}>
                        Clear
                      </button>
                      <div className="muted" style={{ marginLeft: 10 }}>
                        {imagesState.message ? (imagesState.error ? `${imagesState.message} (${imagesState.error})` : imagesState.message) : ""}
                      </div>
                    </div>
                  </div>
                ) : imagesState.message ? (
                  <div className="muted" style={{ marginTop: 6 }}>
                    {imagesState.error ? `${imagesState.message} (${imagesState.error})` : imagesState.message}
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: 6 }}>
                    Select one or more images, then click Submit.
                  </div>
                )}

                {imageMedia.length > 0 ? (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                    {imageMedia.map((m) => {
                      const url = mediaUrlsByPath[m.storage_path];
                      return (
                        <div key={m.id} className="card">
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt="" src={url} style={{ width: "100%", height: 120, objectFit: "cover", border: "1px solid var(--border)" }} />
                          ) : (
                            <div style={{ width: "100%", height: 120, border: "1px solid var(--border)" }} />
                          )}
                          <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                            <button onClick={() => setAsCover(m.id)} disabled={coverState.busy}>
                              Use as cover
                            </button>
                            <button onClick={() => deleteMedia(m.id, m.storage_path)} disabled={imagesState.busy || coverState.busy}>
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: 8 }}>
                    No images yet.
                  </div>
                )}
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={saveEdits} disabled={saveState.busy || !book || book.owner_id !== userId}>
                  {saveState.busy ? "Saving…" : "Save"}
                </button>
                <div className="muted">{saveState.message ? (saveState.error ? `${saveState.message} (${saveState.error})` : saveState.message) : ""}</div>
              </div>
                </>
              ) : null}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            {editionId ? <AlsoOwnedBy editionId={editionId} excludeUserBookId={bookId} excludeOwnerId={userId} /> : null}
          </div>
        </div>
      )}
    </main>
  );
}
