"use client";

import { useRef, useEffect, useState, useMemo, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../../lib/supabaseClient";
import { formatDateShort } from "../../../../lib/formatDate";
import { bookIdSlug } from "../../../../lib/slug";
import ScrollToTopOnMount from "../../../components/ScrollToTopOnMount";
import ExpandableContent from "../../../../components/ExpandableContent";
import FollowControls from "../../../u/[username]/FollowControls";
import EntityTokenField from "../../components/EntityTokenField";
import CoverImage, { type CoverCrop } from "../../../../components/CoverImage";
import CoverEditor, { type EditorState } from "./components/CoverEditor";
import AlsoOwnedBy from "../../../u/[username]/AlsoOwnedBy";
import AddToLibraryButton from "../../../u/[username]/AddToLibraryButton";
import AddToLibraryProvider from "../../../u/[username]/AddToLibraryProvider";
import BorrowRequestWidget from "../../../u/[username]/BorrowRequestWidget";
import { 
  isValidTrimSize, 
  convertTrimUnit, 
  type TrimUnit 
} from "../../../../lib/trimSize";
import {
  looksLikeIsbn,
  tryParseUrl,
  parseTitleAndAuthor
} from "../../../../lib/isbn";

function onEnter(e: React.KeyboardEvent, fn: () => void) {
  if (e.key === "Enter") {
    e.preventDefault();
    fn();
  }
}

function parseAuthorsInput(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatTrimSize(w: string, h: string, unit: string): string {
  const fw = parseFloat(w);
  const fh = parseFloat(h);
  if (Number.isFinite(fw) && Number.isFinite(fh)) {
    return `${fw} × ${fh} ${unit}`;
  }
  return "";
}

type UserBookDetail = {
  id: number;
  owner_id: string;
  created_at: string;
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  status: "owned" | "loaned" | "selling" | "trading";
  location: string | null;
  shelf: string | null;
  notes: string | null;
  title_override: string | null;
  authors_override: string[] | null;
  editors_override: string[] | null;
  designers_override: string[] | null;
  subjects_override: string[] | null;
  publisher_override: string | null;
  printer_override: string | null;
  materials_override: string | null;
  edition_override: string | null;
  publish_date_override: string | null;
  description_override: string | null;
  pages: number | null;
  group_label: string | null;
  object_type: string | null;
  decade: string | null;
  borrowable_override: "inherit" | "yes" | "no";
  borrow_request_scope_override: "inherit" | "anyone" | "followers" | "following";
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: {
    id: number;
    isbn13: string | null;
    isbn10: string | null;
    title: string | null;
    authors: string[] | null;
    publisher: string | null;
    publish_date: string | null;
    description: string | null;
    subjects: string[] | null;
    cover_url: string | null;
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

export default function BookDetailPage() {
  const params = useParams();
  const bookId = Number(params.id);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;
  const [editMode, setEditMode] = useState(false);
  const [findMoreOpen, setFindMoreOpen] = useState(false);

  const [book, setBook] = useState<UserBookDetail | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<{ username: string; display_name: string | null; bio: string | null; visibility: string; avatar_path: string | null } | null>(null);
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [libraries, setLibraries] = useState<Array<{ id: number; name: string }>>([]);
  const [mediaUrlsByPath, setMediaUrlsByPath] = useState<Record<string, string>>({});

  const [showScan, setShowScan] = useState(false);
  useEffect(() => {
    setShowScan(navigator.maxTouchPoints > 0 && window.isSecureContext);
  }, []);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupInputFocused, setLookupInputFocused] = useState(false);
  const [importState, setImportState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [searchState, setSearchState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);

  const [coverToolsOpen, setCoverToolsOpen] = useState(false);
  const [coverEditorSrc, setCoverEditorSrc] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState>({
    x: 0,
    y: 0,
    zoom: 1,
    rotation: 0,
    brightness: 1,
    contrast: 1
  });

  const [coverState, setCoverState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [coverOriginalSrc, setCoverOriginalSrc] = useState<string | null>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [formTitle, setFormTitle] = useState("");
  const [formAuthors, setFormAuthors] = useState<string[]>([]);
  const [formEditors, setFormEditors] = useState<string[]>([]);
  const [formDesigners, setFormDesigners] = useState<string[]>([]);
  const [formPrinter, setFormPrinter] = useState("");
  const [formMaterials, setFormMaterials] = useState("");
  const [formEdition, setFormEdition] = useState("");
  const [formPublishDate, setFormPublishDate] = useState("");
  const [formPublisher, setFormPublisher] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSubjects, setFormSubjects] = useState<string[]>([]);
  const [formGroup, setFormGroup] = useState("");
  const [formObjectType, setFormObjectType] = useState("");
  const [formDecade, setFormDecade] = useState("");
  const [formPages, setFormPages] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formShelf, setFormShelf] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formVisibility, setFormVisibility] = useState<"inherit" | "followers_only" | "public">("inherit");
  const [formStatus, setFormStatus] = useState<"owned" | "loaned" | "selling" | "trading">("owned");
  const [formBorrowable, setFormBorrowable] = useState<"inherit" | "yes" | "no">("inherit");
  const [formLibraryId, setFormLibraryId] = useState<number | null>(null);

  const [formTrimWidth, setFormTrimWidth] = useState("");
  const [formTrimHeight, setFormTrimHeight] = useState("");
  const [formTrimUnit, setFormTrimUnit] = useState<TrimUnit>("in");

  const [cropTrimWidth, setCropTrimWidth] = useState("");
  const [cropTrimHeight, setCropTrimHeight] = useState("");
  const [cropTrimUnit, setCropTrimUnit] = useState<TrimUnit | "ratio">("ratio");

  const [saveState, setBulkState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [imagesState, setImagesState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const imagesInputKey = useMemo(() => String(Date.now()), [pendingImages.length === 0]);

  const [shareState, setShareState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function refresh() {
    if (!supabase) return;
    if (!Number.isFinite(bookId) || bookId <= 0) return;
    const { data, error } = await supabase
      .from("user_books")
      .select(
        "*,edition:editions(id,isbn13,isbn10,title,authors,publisher,publish_date,description,subjects,cover_url),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))"
      )
      .eq("id", bookId)
      .maybeSingle();

    if (error || !data) {
      setBook(null);
      return;
    }
    const b = data as any as UserBookDetail;
    setBook(b);

    const ownerId = b.owner_id;
    const { data: profileData } = await supabase
      .from("profiles")
      .select("username,display_name,bio,visibility,avatar_path")
      .eq("id", ownerId)
      .maybeSingle();
    if (profileData) setOwnerProfile(profileData);

    if (profileData?.avatar_path) {
      const signed = await supabase.storage.from("avatars").createSignedUrl(profileData.avatar_path, 60 * 60);
      setAvatarUrl(signed.data?.signedUrl ?? null);
    } else {
      setAvatarUrl(null);
    }

    const [followersRes, followingRes] = await Promise.all([
      supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", ownerId).eq("status", "approved"),
      supabase.from("follows").select("followee_id", { count: "exact", head: true }).eq("follower_id", ownerId).eq("status", "approved")
    ]);
    setFollowersCount(followersRes.count);
    setFollowingCount(followingRes.count);

    const paths = Array.from(
      new Set([
        ...b.media.map((m) => m.storage_path).filter(Boolean),
        ...(b.cover_original_url ? [b.cover_original_url] : [])
      ])
    );
    if (paths.length > 0) {
      const signed = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 60);
      const nextMap: Record<string, string> = {};
      for (const s of signed.data ?? []) {
        if (s.path && s.signedUrl) nextMap[s.path] = s.signedUrl;
      }
      setMediaUrlsByPath(nextMap);
    }

    const libsRes = await supabase.from("libraries").select("id,name").eq("owner_id", ownerId).order("created_at", { ascending: true });
    setLibraries((libsRes.data ?? []) as any);

    if (b.cover_original_url) {
      const signed = await supabase.storage.from("user-book-media").createSignedUrl(b.cover_original_url, 60 * 60);
      setCoverOriginalSrc(signed.data?.signedUrl ?? null);
    } else {
      setCoverOriginalSrc(null);
    }
  }

  useEffect(() => {
    void refresh();
  }, [bookId]);

  useEffect(() => {
    if (!book) return;
    setFormTitle(book.title_override ?? "");
    setFormAuthors(book.authors_override ?? []);
    setFormEditors(book.editors_override ?? []);
    setFormDesigners(book.designers_override ?? []);
    setFormPrinter(book.printer_override ?? "");
    setFormMaterials(book.materials_override ?? "");
    setFormEdition(book.edition_override ?? "");
    setFormPublishDate(book.publish_date_override ?? "");
    setFormPublisher(book.publisher_override ?? "");
    setFormDescription(book.description_override ?? "");
    setFormSubjects(book.subjects_override ?? []);
    setFormGroup(book.group_label ?? "");
    setFormObjectType(book.object_type ?? "");
    setFormDecade(book.decade ?? "");
    setFormPages(book.pages ? String(book.pages) : "");
    setFormLocation(book.location ?? "");
    setFormShelf(book.shelf ?? "");
    setFormNotes(book.notes ?? "");
    setFormVisibility(book.visibility ?? "inherit");
    setFormStatus(book.status ?? "owned");
    setFormBorrowable(book.borrowable_override ?? "inherit");
    setFormLibraryId(book.library_id);

    const meta = (book as any).metadata ?? {};
    const tw = String(meta.trim_width ?? "");
    const th = String(meta.trim_height ?? "");
    const tu = (meta.trim_unit as TrimUnit) || "in";
    setFormTrimWidth(tw);
    setFormTrimHeight(th);
    setFormTrimUnit(tu);
  }, [book, editMode]);

  const isOwner = userId && book && userId === book.owner_id;
  const effectiveTitle = book?.title_override?.trim() ? book.title_override : book?.edition?.title ?? "(untitled)";
  const effectiveAuthors = (book?.authors_override ?? []).length > 0 ? (book?.authors_override ?? []) : (book?.edition?.authors ?? []);
  const effectiveEditors = (book?.editors_override ?? []);
  const effectiveDesigners = (book?.designers_override ?? []);
  const effectivePrinter = (book?.printer_override ?? "").trim();
  const effectiveMaterials = (book?.materials_override ?? "").trim();
  const effectiveEdition = (book?.edition_override ?? "").trim();
  const effectivePublisher = (book?.publisher_override ?? "").trim() || book?.edition?.publisher || "";
  const effectivePublishDate = (book?.publish_date_override ?? "").trim() || book?.edition?.publish_date || "";
  const displayPublishDate = formatDateShort(effectivePublishDate || null);
  const effectiveDescription = (book?.description_override ?? "").trim() || book?.edition?.description || "";
  const effectiveSubjects = (book?.subjects_override ?? []).length > 0 ? (book?.subjects_override ?? []) : (book?.edition?.subjects ?? []);
  const subjects = effectiveSubjects.slice().sort((a, b) => a.localeCompare(b));

  const coverMedia = (book?.media ?? []).find((m) => m.kind === "cover");
  const coverUrl = coverMedia ? (mediaUrlsByPath[coverMedia.storage_path] ?? null) : (book?.edition?.cover_url ?? null);
  const coverSrc = book?.cover_original_url ? (mediaUrlsByPath[book.cover_original_url] ?? coverUrl) : coverUrl;
  const images = (book?.media ?? []).filter((m) => m.kind === "image");

  function toFullSizeImageUrl(url: string): string {
    if (!url) return "";
    try {
      const u = new URL(url);
      if (u.hostname.includes("googlebooks.com") || u.hostname.includes("googleapis.com")) {
        u.searchParams.set("zoom", "3");
        return u.toString();
      }
      return url;
    } catch {
      return url;
    }
  }

  const trimSizeValid = useMemo(
    () => isValidTrimSize(formTrimWidth, formTrimHeight, formTrimUnit),
    [formTrimWidth, formTrimHeight, formTrimUnit]
  );

  const cropTrimSizeValid = useMemo(() => {
    const w = parseFloat(cropTrimWidth);
    const h = parseFloat(cropTrimHeight);
    return Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
  }, [cropTrimWidth, cropTrimHeight]);

  const coverAspect = useMemo(() => {
    if (cropTrimSizeValid) {
      return parseFloat(cropTrimWidth) / parseFloat(cropTrimHeight);
    }
    return undefined;
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

  async function copyPublicLink() {
    if (!publicBookUrl) return;
    setShareState({ busy: false, error: null, message: null });
    try {
      await navigator.clipboard.writeText(publicBookUrl);
      setShareState({ busy: false, error: null, message: "Copied" });
      window.setTimeout(() => setShareState({ busy: false, error: null, message: null }), 1500);
    } catch (e: any) {
      setShareState({ busy: false, error: e?.message ?? "Copy failed", message: "Copy failed" });
    }
  }

  function handleTrimUnitChange(newUnit: TrimUnit) {
    if (newUnit === formTrimUnit) return;
    const w = parseFloat(formTrimWidth);
    const h = parseFloat(formTrimHeight);
    const nextW = Number.isFinite(w) && w > 0 ? String(convertTrimUnit(w, formTrimUnit, newUnit)) : formTrimWidth;
    const nextH = Number.isFinite(h) && h > 0 ? String(convertTrimUnit(h, formTrimUnit, newUnit)) : formTrimHeight;
    setFormTrimWidth(nextW);
    setFormTrimHeight(nextH);
    setFormTrimUnit(newUnit);
  }

  function handleCropTrimWidthChange(val: string) {
    setCropTrimWidth(val);
    if (cropTrimUnit !== "ratio") setFormTrimWidth(val);
  }

  function handleCropTrimHeightChange(val: string) {
    setCropTrimHeight(val);
    if (cropTrimUnit !== "ratio") setFormTrimHeight(val);
  }

  function handleCropTrimUnitChange(newUnit: TrimUnit | "ratio") {
    if (newUnit === cropTrimUnit) return;
    let nextW = cropTrimWidth;
    let nextH = cropTrimHeight;
    if (newUnit !== "ratio" && cropTrimUnit !== "ratio") {
      const w = parseFloat(cropTrimWidth);
      const h = parseFloat(cropTrimHeight);
      if (Number.isFinite(w) && w > 0) nextW = String(convertTrimUnit(w, (cropTrimUnit as TrimUnit), newUnit));
      if (Number.isFinite(h) && h > 0) nextH = String(convertTrimUnit(h, (cropTrimUnit as TrimUnit), newUnit));
      setCropTrimWidth(nextW);
      setCropTrimHeight(nextH);
    }
    setCropTrimUnit(newUnit);
  }

  async function cancelCoverEdit() {
    setCoverEditorSrc(null);
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
    if (book.owner_id !== userId) return;

    setCoverState({ busy: true, error: null, message: "Saving…" });
    try {
      let finalOriginalUrl = book.cover_original_url;

      if (coverEditorSrc && coverEditorSrc.startsWith("blob:")) {
        const res = await fetch(coverEditorSrc);
        const blob = await res.blob();
        const ext = extFromContentType(blob.type);
        const fileName = `cover-original-${Date.now()}.${ext}`;
        const destPath = `${userId}/${book.id}/${fileName}`;
        const up = await supabase.storage.from("user-book-media").upload(destPath, blob, {
          cacheControl: "3600",
          upsert: false,
          contentType: blob.type || "application/octet-stream"
        });
        if (up.error) throw new Error(up.error.message);
        finalOriginalUrl = destPath;
      }

      const cropData: CoverCrop = {
        mode: "transform",
        x: editorState.x,
        y: editorState.y,
        zoom: editorState.zoom,
        rotation: editorState.rotation,
        brightness: editorState.brightness,
        contrast: editorState.contrast
      };

      const { error: upErr } = await supabase
        .from("user_books")
        .update({
          cover_original_url: finalOriginalUrl,
          cover_crop: cropData
        })
        .eq("id", book.id);
      if (upErr) throw new Error(upErr.message);

      setCoverEditorSrc(null);
      setCoverToolsOpen(false);
      await refresh();
      setCoverState({ busy: false, error: null, message: "Saved" });
      window.setTimeout(() => setCoverState((s) => ({ ...s, message: null })), 1200);
    } catch (e: any) {
      setCoverState({ busy: false, error: e?.message ?? "Save failed", message: "Save failed" });
    }
  }

  async function deleteCover() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    setCoverState({ busy: true, error: null, message: "Deleting cover…" });
    try {
      const up = await supabase.from("user_books").update({ cover_original_url: null, cover_crop: null }).eq("id", book.id);
      if (up.error) throw new Error(up.error.message);

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
      setCoverOriginalSrc(null);
      setCoverToolsOpen(false);
      
      setBook(s => s ? { ...s, media: s.media.filter(m => m.kind !== "cover"), cover_original_url: null, cover_crop: null } : null);

      await refresh();
      setCoverState({ busy: false, error: null, message: "Deleted" });
      window.setTimeout(() => setCoverState(s => s.message === "Deleted" ? { ...s, message: null } : s), 1500);
    } catch (e: any) {
      setCoverState({ busy: false, error: e?.message ?? "Delete failed", message: "Delete failed" });
    }
  }

  async function saveEdits(): Promise<boolean> {
    if (!supabase || !book || !userId) return false;
    setBulkState({ busy: true, error: null, message: "Saving…" });
    try {
      const updates: any = {
        title_override: formTitle.trim() || null,
        authors_override: formAuthors,
        editors_override: formEditors,
        designers_override: formDesigners,
        printer_override: formPrinter.trim() || null,
        materials_override: formMaterials.trim() || null,
        edition_override: formEdition.trim() || null,
        publish_date_override: formPublishDate.trim() || null,
        publisher_override: formPublisher.trim() || null,
        description_override: formDescription.trim() || null,
        subjects_override: formSubjects,
        group_label: formGroup.trim() || null,
        object_type: formObjectType.trim() || null,
        decade: formDecade.trim() || null,
        location: formLocation.trim() || null,
        shelf: formShelf.trim() || null,
        notes: formNotes.trim() || null,
        visibility: formVisibility,
        status: formStatus,
        borrowable_override: formBorrowable,
        library_id: formLibraryId
      };

      const pages = Number(formPages);
      updates.pages = Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : null;

      const meta = {
        trim_width: formTrimWidth.trim() || null,
        trim_height: formTrimHeight.trim() || null,
        trim_unit: formTrimUnit
      };
      updates.metadata = meta;

      const { error } = await supabase.from("user_books").update(updates).eq("id", book.id);
      if (error) throw new Error(error.message);

      await refresh();
      setBulkState({ busy: false, error: null, message: "Saved" });
      window.setTimeout(() => setBulkState((s) => ({ ...s, message: null })), 1200);
      return true;
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Save failed", message: "Save failed" });
      return false;
    }
  }

  async function deleteBook() {
    if (!supabase || !book || !userId) return;
    if (!window.confirm("Delete this book entirely? This cannot be undone.")) return;
    setBulkState({ busy: true, error: null, message: "Deleting…" });
    try {
      const paths = (book.media ?? []).map((m) => m.storage_path).filter(Boolean);
      if (paths.length > 0) {
        await supabase.storage.from("user-book-media").remove(paths);
      }
      const del = await supabase.from("user_books").delete().eq("id", book.id);
      if (del.error) throw new Error(del.error.message);
      router.push("/app");
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Delete failed", message: "Delete failed" });
    }
  }

  function selectPendingImages(files: FileList | null) {
    const list = Array.from(files ?? []).filter((f) => f.size > 0);
    setPendingImages(list);
  }

  function clearPendingImages() {
    setPendingImages([]);
  }

  async function uploadImages() {
    if (!supabase || !book || !userId) return;
    if (pendingImages.length === 0) return;
    setImagesState({ busy: true, error: null, message: "Uploading…" });
    try {
      for (const file of pendingImages) {
        const ext = extFromContentType(file.type);
        const path = `${userId}/${book.id}/image-${Date.now()}-${safeFileName(file.name)}.${ext}`;
        const up = await supabase.storage.from("user-book-media").upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "application/octet-stream"
        });
        if (up.error) continue;
        await supabase.from("user_book_media").insert({ user_book_id: book.id, kind: "image", storage_path: path, caption: null });
      }
      clearPendingImages();
      await refresh();
      setImagesState({ busy: false, error: null, message: "Uploaded" });
      window.setTimeout(() => setImagesState((s) => ({ ...s, message: null })), 1200);
    } catch (e: any) {
      setImagesState({ busy: false, error: e?.message ?? "Upload failed", message: "Upload failed" });
    }
  }

  async function deleteMedia(mediaId: number, storagePath: string) {
    if (!supabase || !book || !userId) return;
    if (!window.confirm("Delete this image?")) return;
    const rm = await supabase.storage.from("user-book-media").remove([storagePath]);
    const del = await supabase.from("user_book_media").delete().eq("id", mediaId);
    if (del.error) {
      setImagesState((s) => ({ ...s, error: del.error?.message ?? "Delete failed", message: "Delete failed" }));
      return;
    }
    await refresh();
  }

  function extFromContentType(ct: string): string {
    if (ct.includes("png")) return "png";
    if (ct.includes("webp")) return "webp";
    if (ct.includes("gif")) return "gif";
    return "jpg";
  }

  function safeFileName(n: string): string {
    return n.replace(/[^\w\.\-]/g, "_").slice(0, 80);
  }

  function openScanner() {
    // scanner logic handled by modal
  }

  async function smartLookup(override?: string) {
    const val = (override ?? lookupInput).trim();
    if (!val) return;
    setImportState({ busy: false, error: null, message: null });
    setSearchState({ busy: false, error: null, message: null });
    setSearchResults([]);

    if (looksLikeIsbn(val)) {
      setImportState({ busy: true, error: null, message: "Looking up ISBN…" });
      try {
        const res = await fetch(`/api/isbn?isbn=${encodeURIComponent(val)}`);
        const json = await res.json();
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Lookup failed");
        const edition = json.edition as EditionMetadata;
        const isbn13 = edition.isbn13?.trim();
        if (!isbn13) throw new Error("No ISBN-13 found");

        const existing = await supabase!.from("editions").select("id").eq("isbn13", isbn13).maybeSingle();
        let eId = existing.data?.id;
        if (!eId) {
          const ins = await supabase!.from("editions").insert({
            isbn13,
            isbn10: edition.isbn10 || null,
            title: edition.title || null,
            authors: edition.authors || [],
            publisher: edition.publisher || null,
            publish_date: edition.publish_date || null,
            description: edition.description || null,
            subjects: edition.subjects || [],
            cover_url: edition.cover_url || null,
            raw: edition.raw || null
          }).select("id").single();
          if (ins.error) throw new Error(ins.error.message);
          eId = ins.data.id;
        }

        const upd = await supabase!.from("user_books").update({ edition_id: eId }).eq("id", book!.id);
        if (upd.error) throw new Error(upd.error.message);

        setLookupInput("");
        setFindMoreOpen(false);
        await refresh();
        setImportState({ busy: false, error: null, message: "Linked!" });
        window.setTimeout(() => setImportState(s => ({ ...s, message: null })), 1500);
      } catch (e: any) {
        setImportState({ busy: false, error: e?.message ?? "Lookup failed", message: "Lookup failed" });
      }
      return;
    }

    const parsedUrl = tryParseUrl(val);
    if (parsedUrl) {
      setImportState({ busy: true, error: null, message: "Importing from URL…" });
      try {
        const res = await fetch("/api/import-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: parsedUrl.toString() })
        });
        const json = await res.json();
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Import failed");
        const preview = json.preview as EditionMetadata;
        
        const updates: any = {};
        if (!book?.title_override && preview.title) updates.title_override = preview.title;
        if (!book?.authors_override?.length && preview.authors?.length) updates.authors_override = preview.authors;
        if (!book?.publisher_override && preview.publisher) updates.publisher_override = preview.publisher;
        if (!book?.publish_date_override && preview.publish_date) updates.publish_date_override = preview.publish_date;
        
        if (Object.keys(updates).length > 0) {
          const upd = await supabase!.from("user_books").update(updates).eq("id", book!.id);
          if (upd.error) throw new Error(upd.error.message);
        }

        if (preview.cover_url && !book?.media.some(m => m.kind === 'cover')) {
          await importCoverForBook(book!.id, preview.cover_url);
        }

        setLookupInput("");
        setFindMoreOpen(false);
        await refresh();
        setImportState({ busy: false, error: null, message: "Imported!" });
        window.setTimeout(() => setImportState(s => ({ ...s, message: null })), 1500);
      } catch (e: any) {
        setImportState({ busy: false, error: e?.message ?? "Import failed", message: "Import failed" });
      }
      return;
    }

    const { title, author } = parseTitleAndAuthor(val);
    setSearchState({ busy: true, error: null, message: "Searching…" });
    try {
      const res = await fetch(`/api/search?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author ?? "")}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Search failed");
      setSearchResults((json.results ?? []) as MetadataSearchResult[]);
      setSearchState({ busy: false, error: null, message: null });
    } catch (e: any) {
      setSearchState({ busy: false, error: e?.message ?? "Search failed", message: "Search failed" });
    }
  }

  async function linkToEdition(e: MetadataSearchResult) {
    if (!book || !supabase) return;
    setImportState({ busy: true, error: null, message: "Linking…" });
    try {
      const isbn13 = e.isbn13?.trim();
      if (!isbn13) throw new Error("No ISBN-13 available for this result");

      const existing = await supabase.from("editions").select("id").eq("isbn13", isbn13).maybeSingle();
      let eId = existing.data?.id;
      if (!eId) {
        const ins = await supabase.from("editions").insert({
          isbn13,
          isbn10: e.isbn10 || null,
          title: e.title || null,
          authors: e.authors || [],
          publisher: e.publisher || null,
          publish_date: e.publish_date || null,
          description: null,
          subjects: e.subjects || [],
          cover_url: e.cover_url || null
        }).select("id").single();
        if (ins.error) throw new Error(ins.error.message);
        eId = ins.data.id;
      }

      const upd = await supabase.from("user_books").update({ edition_id: eId }).eq("id", book.id);
      if (upd.error) throw new Error(upd.error.message);

      if (e.cover_url && !book.media.some(m => m.kind === 'cover')) {
        await importCoverForBook(book.id, e.cover_url);
      }

      setSearchResults([]);
      setLookupInput("");
      setFindMoreOpen(false);
      await refresh();
      setImportState({ busy: false, error: null, message: "Linked!" });
      window.setTimeout(() => setImportState(s => ({ ...s, message: null })), 1500);
    } catch (err: any) {
      setImportState({ busy: false, error: err?.message ?? "Link failed", message: "Link failed" });
    }
  }

  async function unlinkEdition() {
    if (!book || !supabase) return;
    if (!window.confirm("Unlink this book from its edition metadata? This won't delete your overrides or images.")) return;
    setBulkState({ busy: true, error: null, message: "Unlinking…" });
    try {
      const upd = await supabase.from("user_books").update({ edition_id: null }).eq("id", book.id);
      if (upd.error) throw new Error(upd.error.message);
      await refresh();
      setBulkState({ busy: false, error: null, message: "Unlinked" });
      window.setTimeout(() => setBulkState(s => ({ ...s, message: null })), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Unlink failed", message: "Unlink failed" });
    }
  }

  async function importCoverForBook(userBookId: number, coverUrl: string) {
    if (!supabase) return;
    const value = coverUrl.trim();
    if (!value) return;
    const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(value)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const ext = extFromContentType(res.headers.get("content-type") ?? "image/jpeg");
    const path = `${userId}/${userBookId}/cover-import-${Date.now()}.${ext}`;
    const up = await supabase.storage.from("user-book-media").upload(path, blob, {
      cacheControl: "3600",
      upsert: false,
      contentType: blob.type || "application/octet-stream"
    });
    if (up.error) return;
    await supabase.from("user_book_media").insert({ user_book_id: userBookId, kind: "cover", storage_path: path, caption: null });
  }

  const isPubliclyVisible = useMemo(() => {
    if (!book) return false;
    if (book.visibility === "public") return true;
    if (book.visibility === "inherit" && ownerProfile?.visibility === "public") return true;
    return false;
  }, [book, ownerProfile]);

  const editionId = useMemo(() => {
    return book?.edition?.id ?? null;
  }, [book]);

  const effectiveBorrowable = book?.borrowable_override === "yes" || (book?.borrowable_override === "inherit" && ownerProfile?.visibility === "public");
  const effectiveBorrowScope = (book?.borrow_request_scope_override === "inherit" ? "anyone" : book?.borrow_request_scope_override) as any;

  if (!book) {
    return (
      <main className="container">
        <div className="card">Loading…</div>
      </main>
    );
  }

  return (
    <main className="container">
      <ScrollToTopOnMount />
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            {avatarUrl ? (
              <div style={{ width: 48, height: 48, borderRadius: 999, overflow: "hidden", border: "1px solid var(--border-avatar)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src={avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: 999, border: "1px solid var(--border-avatar)", background: "var(--bg-muted)" }} />
            )}
            <div>
              <Link href="/app" className="muted" style={{ fontSize: "0.9em", textDecoration: "none" }}>
                Your catalog
              </Link>
              <div style={{ fontSize: "1.1em", marginTop: 2 }}>{ownerProfile?.display_name || `@${ownerProfile?.username}`}</div>
            </div>
          </div>
          {isOwner && (
            <button onClick={() => setEditMode(!editMode)} className={editMode ? "text-primary" : ""}>
              {editMode ? "Done" : "Edit"}
            </button>
          )}
        </div>

        <div className="row muted" style={{ marginTop: 12, gap: 16 }}>
          <span style={{ display: "inline-flex", gap: 10 }}>
            <Link href={`/u/${ownerProfile?.username}/followers`} className="muted">
              Followers
            </Link>
            <span>{followersCount ?? "—"}</span>
          </span>
          <span style={{ display: "inline-flex", gap: 10 }}>
            <Link href={`/u/${ownerProfile?.username}/following`} className="muted">
              Following
            </Link>
            <span>{followingCount ?? "—"}</span>
          </span>
          {ownerProfile && <FollowControls profileId={book.owner_id} profileUsername={ownerProfile.username} inline />}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}>
        <AddToLibraryProvider editionIds={editionId ? [editionId] : []}>
          <div className="card">
            <div className="om-book-detail-grid">
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
                      onLoad={({ minZoom }) => {}}
                      aspectRatio={coverAspect ?? (2/3)}
                      style={{ width: "100%", height: "auto", aspectRatio: `${coverAspect ?? (2/3)}` }}
                    />
                  ) : (
                    <CoverImage
                      alt={effectiveTitle}
                      src={coverOriginalSrc ?? coverUrl}
                      cropData={book.cover_crop}
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
                      
                      if (open && coverUrl && !coverEditorSrc && !pendingImages.length) {
                        const origSrc = toFullSizeImageUrl((coverOriginalSrc ?? coverUrl) || "");
                        setCoverEditorSrc(origSrc);
                        const crop = book.cover_crop;
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
                    style={{ marginTop: 10, border: "none", outline: "none", boxShadow: "none" }}
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
                          <span className="muted" style={{ cursor: "pointer" }}>
                            {coverUrl ? "Edit cover" : "Add cover"}
                          </span>
                        )}
                        
                        {coverToolsOpen && (
                          <button 
                            className="muted" 
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
                              <div className="row no-wrap" style={{ marginTop: 12, alignItems: "center" }}>
                                <div className="muted" style={{ minWidth: 110 }}>Aspect ratio</div>
                                <div className="row" style={{ gap: 8 }}>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="W"
                                    value={cropTrimWidth}
                                    onChange={(e) => handleCropTrimWidthChange(e.target.value)}
                                    style={{ width: 50, textAlign: "center" }}
                                  />
                                  <span className="muted">×</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="H"
                                    value={cropTrimHeight}
                                    onChange={(e) => handleCropTrimHeightChange(e.target.value)}
                                    style={{ width: 50, textAlign: "center" }}
                                  />
                                  <select
                                    value={cropTrimUnit}
                                    onChange={(e) => handleCropTrimUnitChange(e.target.value as any)}
                                    style={{ width: "auto", minWidth: 60 }}
                                  >
                                    <option value="ratio">ratio</option>
                                    <option value="in">in</option>
                                    <option value="mm">mm</option>
                                  </select>
                                </div>
                              </div>

                              <div className="row no-wrap" style={{ marginTop: 8, alignItems: "center" }}>
                                <div className="muted" style={{ minWidth: 110 }}>Zoom</div>
                                <CustomSlider
                                  min={1}
                                  max={4}
                                  step={0.01}
                                  value={editorState.zoom}
                                  onChange={(zoom) => setEditorState(s => ({ ...s, zoom }))}
                                  style={{ flex: "1 1 auto" }}
                                />
                              </div>
                              <div className="row no-wrap" style={{ marginTop: 8, alignItems: "center" }}>
                                <div className="muted" style={{ minWidth: 110 }}>Rotate</div>
                                <CustomSlider
                                  min={0}
                                  max={270}
                                  step={90}
                                  value={editorState.rotation}
                                  onChange={(rotation) => setEditorState(s => ({ ...s, rotation }))}
                                  style={{ flex: "1 1 auto" }}
                                />
                              </div>
                              <div className="row no-wrap" style={{ marginTop: 8, alignItems: "center" }}>
                                <div className="muted" style={{ minWidth: 110 }}>Brightness</div>
                                <CustomSlider
                                  min={0.5}
                                  max={1.5}
                                  step={0.01}
                                  value={editorState.brightness}
                                  onChange={(brightness) => setEditorState(s => ({ ...s, brightness }))}
                                  style={{ flex: "1 1 auto" }}
                                />
                              </div>
                              <div className="row no-wrap" style={{ marginTop: 8, alignItems: "center" }}>
                                <div className="muted" style={{ minWidth: 110 }}>Contrast</div>
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
                          <div className="muted" style={{ marginTop: 8 }}>Click Replace or wait for cover to load.</div>
                        ) : (
                          <div className="muted" style={{ marginTop: 8 }}>No cover image. Click “Add cover” to upload.</div>
                        )}

                        {coverToolsOpen && (
                          <div className="row" style={{ marginTop: 12, gap: 16 }}>
                            <label 
                              className="muted" 
                              style={{ cursor: "pointer", textDecoration: "underline" }}
                            >
                              Replace
                              <input
                                key={imagesInputKey}
                                type="file"
                                accept="image/*"
                                onChange={(ev) => {
                                  const f = (ev.target.files ?? [])[0];
                                  if (f) {
                                    const url = URL.createObjectURL(f);
                                    setCoverEditorSrc(url);
                                    setEditorState({
                                      x: 0,
                                      y: 0,
                                      zoom: 1.0,
                                      rotation: 0,
                                      brightness: 1,
                                      contrast: 1
                                    });
                                  }
                                }}
                                style={{ display: "none" }}
                              />
                            </label>

                            {coverUrl && (
                              <button 
                                className="muted" 
                                style={{ textDecoration: "underline" }}
                                onClick={resetCoverEdit}
                              >
                                Reset
                              </button>
                            )}

                            {coverUrl && (
                              <button 
                                className="muted" 
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
                          <div className="muted" style={{ marginTop: 6 }}>
                            {coverState.error ? `${coverState.message} (${coverState.error})` : coverState.message}
                          </div>
                        ) : null}
                      </div>
                  </details>
                ) : null}
              </div>

              <div>
                {editMode ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="row om-row-baseline">
                      <div style={{ minWidth: 110 }} className="muted">
                        Title
                      </div>
                      <div style={{ flex: "1 1 auto" }}>
                        <input
                          className="om-inline-control"
                          value={formTitle}
                          onChange={(e) => setFormTitle(e.target.value)}
                          onKeyDown={(e) => onEnter(e, () => void saveEdits())}
                          placeholder="Add title"
                          style={{ fontWeight: 600, fontSize: "1.1em" }}
                        />
                      </div>
                    </div>

                    <div className="row om-row-baseline" style={{ marginTop: 8 }}>
                      <div style={{ minWidth: 110 }} className="muted">
                        Authors
                      </div>
                      <div style={{ flex: "1 1 auto" }}>
                        <EntityTokenField
                          role="author"
                          value={formAuthors}
                          onChange={setFormAuthors}
                          placeholder="Add an author"
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: 4 }}>
                      <div className="row om-row-baseline" style={{ marginTop: 8 }}>
                        <div style={{ minWidth: 110 }} className="muted">Catalog</div>
                        <select
                          className="om-inline-control"
                          value={formLibraryId ?? ""}
                          onChange={(e) => setFormLibraryId(Number(e.target.value))}
                          style={{ width: "auto", minWidth: 140 }}
                        >
                          {libraries.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ marginTop: 4 }}>
                      <div className="row om-row-baseline" style={{ marginTop: 8 }}>
                        <div style={{ minWidth: 110 }} className="muted">Status</div>
                        <select
                          className="om-inline-control"
                          value={formStatus}
                          onChange={(e) => setFormStatus(e.target.value as any)}
                          style={{ width: "auto", minWidth: 140 }}
                        >
                          <option value="owned">Owned</option>
                          <option value="loaned">Loaned</option>
                          <option value="selling">Selling</option>
                          <option value="trading">Trading</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ marginTop: 4 }}>
                      <div className="row om-row-baseline" style={{ marginTop: 8 }}>
                        <div style={{ minWidth: 110 }} className="muted">Visibility</div>
                        <select
                          className="om-inline-control"
                          value={formVisibility}
                          onChange={(e) => setFormVisibility(e.target.value as any)}
                          style={{ width: "auto", minWidth: 140 }}
                        >
                          <option value="inherit">Inherit</option>
                          <option value="followers_only">Followers only</option>
                          <option value="public">Public</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ marginTop: 4 }}>
                      <div className="row om-row-baseline" style={{ marginTop: 8 }}>
                        <div style={{ minWidth: 110 }} className="muted">Borrowable</div>
                        <select
                          className="om-inline-control"
                          value={formBorrowable}
                          onChange={(e) => setFormBorrowable(e.target.value as any)}
                          style={{ width: "auto", minWidth: 140 }}
                        >
                          <option value="inherit">Inherit</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div className="muted" style={{ marginBottom: 6 }}>
                        Metadata overrides
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Publisher
                          </div>
                          <input className="om-inline-control" type="text" value={formPublisher} onChange={(e) => setFormPublisher(e.target.value)} style={{ flex: "1 1 auto" }} />
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Publish date
                          </div>
                          <input className="om-inline-control" type="text" value={formPublishDate} onChange={(e) => setFormPublishDate(e.target.value)} style={{ flex: "1 1 auto" }} />
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Editors
                          </div>
                          <div style={{ flex: "1 1 auto" }}>
                            <EntityTokenField
                              role="editor"
                              value={formEditors}
                              onChange={setFormEditors}
                              placeholder="Add an editor"
                            />
                          </div>
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Designers
                          </div>
                          <div style={{ flex: "1 1 auto" }}>
                            <EntityTokenField
                              role="designer"
                              value={formDesigners}
                              onChange={setFormDesigners}
                              placeholder="Add a designer"
                            />
                          </div>
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Printer
                          </div>
                          <input className="om-inline-control" type="text" value={formPrinter} onChange={(e) => setFormPrinter(e.target.value)} style={{ flex: "1 1 auto" }} />
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Materials
                          </div>
                          <input className="om-inline-control" type="text" value={formMaterials} onChange={(e) => setFormMaterials(e.target.value)} style={{ flex: "1 1 auto" }} />
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Edition
                          </div>
                          <input className="om-inline-control" type="text" value={formEdition} onChange={(e) => setFormEdition(e.target.value)} style={{ flex: "1 1 auto" }} />
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Trim size
                          </div>
                          <div className="row" style={{ gap: 8 }}>
                            <input
                              className="om-inline-control"
                              type="text"
                              inputMode="decimal"
                              placeholder="W"
                              value={formTrimWidth}
                              onChange={(e) => setFormTrimWidth(e.target.value)}
                              style={{ width: 50, textAlign: "center" }}
                            />
                            <span className="muted">×</span>
                            <input
                              className="om-inline-control"
                              type="text"
                              inputMode="decimal"
                              placeholder="H"
                              value={formTrimHeight}
                              onChange={(e) => setFormTrimHeight(e.target.value)}
                              style={{ width: 50, textAlign: "center" }}
                            />
                            <select
                              className="om-inline-control"
                              value={formTrimUnit}
                              onChange={(e) => handleTrimUnitChange(e.target.value as TrimUnit)}
                              style={{ width: "auto", minWidth: 60 }}
                            >
                              <option value="in">in</option>
                              <option value="mm">mm</option>
                            </select>
                          </div>
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Pages
                          </div>
                          <input
                            className="om-inline-control"
                            type="text"
                            inputMode="numeric"
                            value={formPages}
                            onChange={(e) => setFormPages(e.target.value)}
                            style={{ flex: "1 1 auto" }}
                          />
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Group
                          </div>
                          <input className="om-inline-control" type="text" value={formGroup} onChange={(e) => setFormGroup(e.target.value)} style={{ flex: "1 1 auto" }} />
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Object type
                          </div>
                          <input className="om-inline-control" type="text" value={formObjectType} onChange={(e) => setFormObjectType(e.target.value)} style={{ flex: "1 1 auto" }} />
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Decade
                          </div>
                          <input className="om-inline-control" type="text" value={formDecade} onChange={(e) => setFormDecade(e.target.value)} style={{ flex: "1 1 auto" }} />
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Subjects
                          </div>
                          <div style={{ flex: "1 1 auto" }}>
                            <EntityTokenField
                              role="subject"
                              value={formSubjects}
                              onChange={setFormSubjects}
                              placeholder="Add a subject"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div className="muted" style={{ marginBottom: 6 }}>
                        Private notes & location
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Location
                          </div>
                          <input className="om-inline-control" type="text" value={formLocation} onChange={(e) => setFormLocation(e.target.value)} style={{ flex: "1 1 auto" }} />
                        </div>
                        <div className="row om-row-baseline">
                          <div className="muted" style={{ minWidth: 110 }}>
                            Shelf
                          </div>
                          <input className="om-inline-control" type="text" value={formShelf} onChange={(e) => setFormShelf(e.target.value)} style={{ flex: "1 1 auto" }} />
                        </div>
                        <textarea
                          ref={descriptionTextareaRef}
                          className="om-inline-control"
                          value={formNotes}
                          onChange={(e) => setFormNotes(e.target.value)}
                          placeholder="Private notes…"
                          style={{ width: "100%", minHeight: 100, marginTop: 4, resize: "none" }}
                        />
                      </div>
                    </div>

                    <div className="row" style={{ marginTop: 12, gap: 12 }}>
                      <button onClick={() => void saveEdits()} disabled={saveState.busy}>
                        {saveState.busy ? "Saving…" : "Save changes"}
                      </button>
                      <button onClick={() => setEditMode(false)} className="muted">
                        Cancel
                      </button>
                      <div className="row" style={{ marginLeft: "auto", gap: 12 }}>
                        {deleteConfirm ? (
                          <>
                            <span className="muted">Sure?</span>
                            <button onClick={deleteBook} disabled={saveState.busy}>
                              Yes
                            </button>
                            <button onClick={() => setDeleteConfirm(false)} className="muted">
                              No
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setDeleteConfirm(true)} className="muted">
                            Delete entry
                          </button>
                        )}
                      </div>
                    </div>
                    {saveState.message ? (
                      <div className="muted" style={{ marginTop: 6 }}>
                        {saveState.error ? `${saveState.message} (${saveState.error})` : saveState.message}
                      </div>
                    ) : null}
                  </div>
                ) : (

                  <>
                    <div style={{ fontSize: "1.2em", fontWeight: 600 }}>{effectiveTitle}</div>
                    {effectiveAuthors.length > 0 ? (
                      <div className="row om-row-baseline" style={{ marginTop: 10 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Authors
                        </div>
                        <div className="om-hanging-value">
                          {effectiveAuthors.map((a, idx) => (
                            <span key={a}>
                              <Link href={`/app?author=${encodeURIComponent(a)}`}>{a}</Link>
                              {idx < effectiveAuthors.length - 1 ? <span>, </span> : null}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {effectiveEditors.length > 0 ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Editors
                        </div>
                        <div>{effectiveEditors.join(", ")}</div>
                      </div>
                    ) : null}

                    {effectiveDesigners.length > 0 ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Designers
                        </div>
                        <div>{effectiveDesigners.join(", ")}</div>
                      </div>
                    ) : null}

                    {effectivePrinter ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Printer
                        </div>
                        <div>{effectivePrinter}</div>
                      </div>
                    ) : null}

                    {effectiveMaterials ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Materials
                        </div>
                        <div>{effectiveMaterials}</div>
                      </div>
                    ) : null}

                    {effectiveEdition ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Edition
                        </div>
                        <div>{effectiveEdition}</div>
                      </div>
                    ) : null}

                    {effectivePublisher ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Publisher
                        </div>
                        <div>
                          <Link href={`/app?publisher=${encodeURIComponent(effectivePublisher)}`}>{effectivePublisher}</Link>
                        </div>
                      </div>
                    ) : null}

                    {effectivePublishDate ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Publish date
                        </div>
                        <div>{displayPublishDate}</div>
                      </div>
                    ) : null}

                    {trimSizeValid ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Trim size
                        </div>
                        <div>{formatTrimSize(formTrimWidth, formTrimHeight, formTrimUnit)}</div>
                      </div>
                    ) : null}

                    {book.pages ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Pages
                        </div>
                        <div>{book.pages}</div>
                      </div>
                    ) : null}

                    {(book.group_label ?? "").trim() ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Group
                        </div>
                        <div>{(book.group_label ?? "").trim()}</div>
                      </div>
                    ) : null}

                    {(book.object_type ?? "").trim() ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Object type
                        </div>
                        <div>{(book.object_type ?? "").trim()}</div>
                      </div>
                    ) : null}

                    {(book.decade ?? "").trim() ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Decade
                        </div>
                        <div>{(book.decade ?? "").trim()}</div>
                      </div>
                    ) : null}

                    {subjects.length > 0 ? (
                      <div className="row om-row-baseline" style={{ marginTop: 12 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          Subjects
                        </div>
                        <div style={{ flex: "1 1 auto" }}>
                          <ExpandableContent
                            items={subjects}
                            limit={15}
                            renderVisible={(visible: any[], isExpanded: boolean) => (
                              <div>
                                {visible.map((s, idx) => (
                                  <span key={s}>
                                    <Link href={`/app?subject=${encodeURIComponent(s)}`}>{s}</Link>
                                    {idx < visible.length - 1 ? <span>, </span> : null}
                                  </span>
                                ))}
                                {!isExpanded && subjects.length > 15 ? " …" : ""}
                              </div>
                            )}
                          />
                        </div>
                      </div>
                    ) : null}

                    {book.edition?.isbn13 || book.edition?.isbn10 ? (
                      <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                        <div style={{ minWidth: 110 }} className="muted">
                          ISBN
                        </div>
                        <div>{book.edition?.isbn13 ?? book.edition?.isbn10}</div>
                      </div>
                    ) : null}

                    {isOwner && (
                      <>
                        <hr className="om-hr" style={{ marginTop: 14, marginBottom: 14 }} />
                        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                          <div className="muted" style={{ minWidth: 110 }}>
                            Location
                          </div>
                          <div>{book.location || "—"}</div>
                        </div>
                        <div className="row" style={{ marginTop: 6, justifyContent: "space-between", alignItems: "baseline" }}>
                          <div className="muted" style={{ minWidth: 110 }}>
                            Shelf
                          </div>
                          <div>{book.shelf || "—"}</div>
                        </div>
                        {book.notes ? (
                          <div style={{ marginTop: 12 }}>
                            <div className="muted">Private notes</div>
                            <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{book.notes}</div>
                          </div>
                        ) : null}
                      </>
                    )}

                    {book.edition?.description ? (
                      <div style={{ marginTop: 12 }}>
                        <div className="muted">Description</div>
                        <div style={{ marginTop: 6 }}>
                          <ExpandableContent
                            items={book.edition.description.trim().split(/\s+/)}
                            limit={100}
                            renderVisible={(visible: any[], isExpanded: boolean) => (
                              <div style={{ whiteSpace: "pre-wrap" }}>
                                {isExpanded ? book.edition!.description : visible.join(" ") + (book.edition!.description!.trim().split(/\s+/).length > 100 ? "…" : "")}
                              </div>
                            )}
                          />
                        </div>
                      </div>
                    ) : null}

                    {isOwner && !book.edition && (
                      <div style={{ marginTop: 14 }}>
                        <details open={findMoreOpen} onToggle={(e) => setFindMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
                          <summary className="muted" style={{ cursor: "pointer", textDecoration: "underline" }}>
                            Link to edition metadata…
                          </summary>
                          <div style={{ marginTop: 14 }}>
                            <div className="row" style={{ width: "100%", gap: 12, alignItems: "baseline" }}>
                              {showScan && (
                                <div className="row" style={{ gap: 12, flex: "0 0 auto", alignItems: "baseline" }}>
                                  <button 
                                    className="muted" 
                                    onClick={openScanner} 
                                    style={{ whiteSpace: "nowrap", padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", textDecoration: "underline" }}
                                  >
                                    Scan
                                  </button>
                                  <span className="muted">or</span>
                                </div>
                              )}
                              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                                <input
                                  className="om-inline-control"
                                  placeholder={showScan ? "enter ISBN…" : "Scan or enter ISBN, URL, or title"}
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
                                  style={{ whiteSpace: "nowrap", marginLeft: 12 }}
                                >
                                  Find
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div className="muted" style={{ marginTop: 6 }}>
                            {importState.busy || searchState.busy
                              ? "Working…"
                              : importState.error
                              ? `${importState.message} (${importState.error})`
                              : importState.message || searchState.error || searchState.message || "Enter ISBN, URL, or Title to link this book to metadata."}
                          </div>

                          {searchResults.length > 0 && (
                            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                              {searchResults.map((r, idx) => (
                                <div key={idx} className="card" style={{ padding: "8px 12px", background: "var(--bg-muted)" }}>
                                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
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
                                        />
                                      </div>
                                    ) : (
                                      <div className="om-cover-slot" style={{ width: 60, height: "auto" }} />
                                    )}
                                    <div style={{ flex: "1 1 auto" }}>
                                      <div style={{ fontWeight: 600 }}>{r.title}</div>
                                      <div className="muted" style={{ fontSize: "0.9em" }}>
                                        {(r.authors ?? []).join(", ")}
                                        {r.publisher ? ` · ${r.publisher}` : ""}
                                        {r.publish_year ? ` · ${r.publish_year}` : ""}
                                      </div>
                                      <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>
                                        {r.isbn13 || r.isbn10} · {r.source}
                                      </div>
                                    </div>
                                    <button onClick={() => linkToEdition(r)} disabled={importState.busy}>
                                      Link
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </details>
                      </div>
                    )}

                    {isOwner && book.edition && (
                      <div style={{ marginTop: 14 }}>
                        <button onClick={unlinkEdition} className="muted" style={{ textDecoration: "underline" }}>
                          Unlink edition metadata
                        </button>
                      </div>
                    )}

                    <div style={{ marginTop: 14 }}>
                      <BorrowRequestWidget
                        userBookId={book.id}
                        ownerId={book.owner_id}
                        ownerUsername={ownerProfile?.username || ""}
                        bookTitle={effectiveTitle}
                        borrowable={effectiveBorrowable}
                        scope={effectiveBorrowScope}
                      />
                    </div>

                    <div style={{ marginTop: 14 }}>
                      <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
                        <span className="muted">Public link:</span>
                        <div className="row" style={{ flex: "1 1 auto", minWidth: 0, gap: 8, alignItems: "baseline" }}>
                          <a
                            href={publicBookUrl || ""}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: "var(--fg)",
                              opacity: isPubliclyVisible ? 1 : 0.5
                            }}
                          >
                            {publicBookUrl || "…"}
                          </a>
                          {!isPubliclyVisible && (
                            <span className="muted" style={{ fontSize: "0.85em" }}>
                              (private)
                            </span>
                          )}
                          <div style={{ flex: "0 0 auto", marginLeft: "auto" }}>
                            {shareState.message === "Copied" ? (
                              <span style={{ flex: "0 0 auto", marginLeft: 2 }}>Copied</span>
                            ) : (
                              <button onClick={copyPublicLink} style={{ flex: "0 0 auto", marginLeft: 2 }}>
                                Copy
                              </button>
                            )}
                          </div>
                          {shareState.error ? (
                            <div className="muted" style={{ marginTop: 6, textAlign: "right" }}>
                              {shareState.message} ({shareState.error})
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <div className="muted">Additional images</div>
                {isOwner && (
                  <div style={{ display: "inline-flex", gap: 12 }}>
                    <label className="muted" style={{ cursor: "pointer", textDecoration: "underline" }}>
                      Add images…
                      <input key={imagesInputKey} type="file" accept="image/*" multiple onChange={(ev) => selectPendingImages(ev.target.files)} style={{ display: "none" }} />
                    </label>
                  </div>
                )}
              </div>

              {pendingImages.length > 0 && (
                <div style={{ marginTop: 10 }} className="card">
                  <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                    {pendingImages.map((f, idx) => (
                      <div key={idx} className="muted" style={{ fontSize: "0.9em" }}>
                        {f.name}
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ marginTop: 12, gap: 12 }}>
                    <button onClick={uploadImages} disabled={imagesState.busy}>
                      {imagesState.busy ? "Uploading…" : `Upload ${pendingImages.length} image(s)`}
                    </button>
                    <button onClick={clearPendingImages} disabled={imagesState.busy} className="muted">
                      Clear
                    </button>
                  </div>
                  {imagesState.message ? (
                    <div className="muted" style={{ marginTop: 6 }}>
                      {imagesState.error ? `${imagesState.message} (${imagesState.error})` : imagesState.message}
                    </div>
                  ) : null}
                </div>
              )}

              {images.length > 0 ? (
                <div style={{ marginTop: 14 }}>
                  <div
                    className="om-images-grid"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                      gap: 12
                    }}
                  >
                    {images.map((m) => {
                      const url = mediaUrlsByPath[m.storage_path];
                      return (
                        <div key={m.id} style={{ position: "relative" }}>
                          <div style={{ aspectRatio: "1", background: "var(--bg-muted)", overflow: "hidden", borderRadius: 4 }}>
                            {url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img alt="" src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            )}
                          </div>
                          {isOwner && (
                            <button
                              onClick={() => void deleteMedia(m.id, m.storage_path)}
                              style={{
                                position: "absolute",
                                top: 4,
                                right: 4,
                                width: 24,
                                height: 24,
                                borderRadius: 999,
                                padding: 0,
                                background: "rgba(0,0,0,0.5)",
                                color: "white",
                                border: "none"
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : !pendingImages.length ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  No additional images.
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: 16 }}>
              {editionId ? (
                <div className="row" style={{ gap: 12, alignItems: "center" }}>
                  <AlsoOwnedBy editionId={editionId} excludeUserBookId={book.id} excludeOwnerId={book.owner_id} />
                  <AddToLibraryButton editionId={editionId} titleFallback={effectiveTitle} authorsFallback={effectiveAuthors} compact />
                </div>
              ) : null}
            </div>
          </div>
        </AddToLibraryProvider>
      </div>
    </main>
  );
}

function CustomSlider({
  min,
  max,
  step,
  value,
  onChange,
  style
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (val: number) => void;
  style?: CSSProperties;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{
        ...style,
        appearance: "none",
        background: "var(--border)",
        height: 2,
        borderRadius: 999,
        outline: "none"
      }}
    />
  );
}
