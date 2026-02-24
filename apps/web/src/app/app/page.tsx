"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabaseClient";
import SignInCard from "../components/SignInCard";
import BulkBar from "./components/BulkBar";
import LibraryBlock from "./components/LibraryBlock";
import BookCard from "./components/BookCard";

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

function AppShell({
  session,
  filterTag,
  filterAuthor,
  filterSubject,
  filterPublisher,
  filterCategory
}: {
  session: Session;
  filterTag: string | null;
  filterAuthor: string | null;
  filterSubject: string | null;
  filterPublisher: string | null;
  filterCategory: string | null;
}) {
  const userId = session.user.id;
  const [profile, setProfile] = useState<{ username: string; visibility: string; avatar_path: string | null } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userBooksCount, setUserBooksCount] = useState<number | null>(null);
  const [addInput, setAddInput] = useState("");
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
    edition: {
      id: number;
      isbn13: string | null;
      title: string | null;
      authors: string[] | null;
      subjects: string[] | null;
      publisher: string | null;
      cover_url: string | null;
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
    title: string;
    visibility: "inherit" | "followers_only" | "public" | "mixed";
    effectiveVisibility: "public" | "followers_only" | "mixed";
    latestCreatedAt: number;
    earliestCreatedAt: number;
  };

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [mediaUrlsByPath, setMediaUrlsByPath] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [gridCols, setGridCols] = useState<2 | 4 | 8>(4);
  const [sortMode, setSortMode] = useState<"latest" | "earliest" | "title_asc" | "title_desc">("latest");
  const [categoryMode, setCategoryMode] = useState<string>("all");
  const [visibilityMode, setVisibilityMode] = useState<"all" | "public" | "private">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [deleteStateByBookId, setDeleteStateByBookId] = useState<Record<number, { busy: boolean; error: string | null; message: string | null } | undefined>>(
    {}
  );

  const [libraries, setLibraries] = useState<Array<{ id: number; name: string; created_at: string; sort_order?: number | null }>>([]);
  const [addLibraryId, setAddLibraryId] = useState<number | null>(null);
  const [editingLibraryId, setEditingLibraryId] = useState<number | null>(null);
  const [libraryNameDraft, setLibraryNameDraft] = useState("");
  const [newLibraryName, setNewLibraryName] = useState("");
  const [libraryState, setLibraryState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<Record<string, true | undefined>>({});
  const [bulkMoveLibraryId, setBulkMoveLibraryId] = useState<number | null>(null);
  const [bulkCategoryName, setBulkCategoryName] = useState("");
  const [bulkState, setBulkState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  useEffect(() => {
    try {
      const vm = window.localStorage.getItem("om_viewMode");
      const gc = window.localStorage.getItem("om_gridCols");
      const sm = window.localStorage.getItem("om_sortMode");
      const cm = window.localStorage.getItem("om_categoryMode");
      const vis = window.localStorage.getItem("om_visibilityMode");
      if (vm === "grid" || vm === "list") setViewMode(vm);
      if (gc === "2" || gc === "4" || gc === "8") setGridCols(Number(gc) as any);
      if (sm === "latest" || sm === "earliest" || sm === "title_asc" || sm === "title_desc") setSortMode(sm);
      if (cm && typeof cm === "string") setCategoryMode(cm);
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
      window.localStorage.setItem("om_visibilityMode", visibilityMode);
    } catch {
      // ignore
    }
  }, [viewMode, gridCols, sortMode, categoryMode, filterCategory, visibilityMode]);

  useEffect(() => {
    const normalized = (filterCategory ?? "").trim();
    if (!normalized) return;
    setCategoryMode(normalized);
  }, [filterCategory]);

  async function refreshAllBooks() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("user_books")
      .select(
        "id,library_id,created_at,visibility,title_override,authors_override,subjects_override,publisher_override,edition:editions(id,isbn13,title,authors,subjects,publisher,cover_url),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))"
      )
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(800);
    if (error) return;
    const rows = (data ?? []) as any[];
    setItems(rows as any);

    const paths = Array.from(
      new Set(
        rows
          .flatMap((r) => (Array.isArray(r.media) ? r.media : []))
          .map((m: any) => (typeof m?.storage_path === "string" ? m.storage_path : ""))
          .filter(Boolean)
      )
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

      setBulkMoveLibraryId((prev) => (prev && list.some((l) => l.id === prev) ? prev : list[0]?.id ?? null));
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
        setBulkMoveLibraryId(id);
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

      await refreshLibraries();
      await refreshAllBooks();
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
      setAddUrlPreview(json.preview ?? null);
      setAddUrlMeta({
        final_url: typeof json.final_url === "string" ? json.final_url : null,
        domain: typeof json.domain === "string" ? json.domain : null,
        domain_kind: typeof json.domain_kind === "string" ? json.domain_kind : null
      });
      setAddState({ busy: false, error: null, message: "Preview ready" });
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
      setAddUrlPreview({
        title: typeof edition.title === "string" ? edition.title : null,
        authors: Array.isArray(edition.authors) ? edition.authors.filter(Boolean) : [],
        publisher: typeof edition.publisher === "string" ? edition.publisher : null,
        publish_date: typeof edition.publish_date === "string" ? edition.publish_date : null,
        description: typeof edition.description === "string" ? edition.description : null,
        subjects: Array.isArray(edition.subjects) ? edition.subjects.filter(Boolean) : [],
        isbn10: typeof edition.isbn10 === "string" ? edition.isbn10 : null,
        isbn13: typeof edition.isbn13 === "string" ? edition.isbn13 : null,
        cover_url: typeof edition.cover_url === "string" ? edition.cover_url.trim() || null : null,
        sources: Array.from(new Set(["isbn", ...((edition.sources ?? []) as any[]).map((s: any) => String(s))])).filter(Boolean)
      });
      setAddState({ busy: false, error: null, message: "Preview ready" });
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
      setAddSearchState({ busy: false, error: null, message: (json.results ?? []).length ? "Done" : "No results" });
    } catch (e: any) {
      setAddSearchState({ busy: false, error: e?.message ?? "Search failed", message: "Search failed" });
    }
  }

  async function smartAddOrSearch() {
    const value = addInput.trim();
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

  const displayGroups = useMemo(() => {
    const profileVis = profile?.visibility === "public" ? "public" : "followers_only";
    const tag = (filterTag ?? "").trim().toLowerCase();
    const author = (filterAuthor ?? "").trim().toLowerCase();
    const subject = (filterSubject ?? "").trim().toLowerCase();
    const publisher = (filterPublisher ?? "").trim().toLowerCase();
    const activeCategoryMode = (filterCategory ?? categoryMode) || "all";
    const categoryTag = (activeCategoryMode === "all" ? "" : String(activeCategoryMode)).trim().toLowerCase();
    const q = searchQuery.trim().toLowerCase();

    const byKey = new Map<string, CatalogItem[]>();
    for (const it of filteredItems) {
      // Keep each catalog ("library") independent: the same book can appear in multiple libraries.
      const key = `${it.library_id}:${groupKeyFor(it)}`;
      const cur = byKey.get(key);
      if (!cur) byKey.set(key, [it]);
      else cur.push(it);
    }

    let groups: CatalogGroup[] = Array.from(byKey.entries()).map(([key, copies]) => {
      const sorted = copies.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

      // Pick a "primary" copy that best represents the group (prefer the one that actually has a cover/media).
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
        title,
        visibility,
        effectiveVisibility,
        latestCreatedAt: Number.isFinite(latest) ? latest : Date.now(),
        earliestCreatedAt: Number.isFinite(earliest) ? earliest : Date.now()
      };
    });

    if (tag) {
      groups = groups.filter((g) => g.tagNames.some((t) => t.toLowerCase() === tag));
    }
    if (author) {
      groups = groups.filter((g) => g.filterAuthors.some((a) => a.toLowerCase() === author));
    }
    if (subject) {
      groups = groups.filter((g) => g.filterSubjects.some((s) => String(s).toLowerCase() === subject));
    }
    if (publisher) {
      groups = groups.filter((g) => g.filterPublishers.some((p) => p.toLowerCase() === publisher));
    }
    if (categoryTag) {
      groups = groups.filter((g) => g.categoryNames.some((t) => t.toLowerCase() === categoryTag));
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
        const e = g.primary.edition;
        const title = (g.title ?? "").toLowerCase();
        const authors = (g.filterAuthors ?? []).join(" ").toLowerCase();
        const subjects = (g.filterSubjects ?? []).join(" ").toLowerCase();
        const publishers = (g.filterPublishers ?? []).join(" ").toLowerCase();
        const tags = (g.tagNames ?? []).join(" ").toLowerCase();
        const isbn = String(e?.isbn13 ?? "").toLowerCase();
        return (
          title.includes(q) ||
          authors.includes(q) ||
          subjects.includes(q) ||
          publishers.includes(q) ||
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
  }, [filteredItems, filterTag, filterAuthor, filterSubject, filterPublisher, filterCategory, categoryMode, visibilityMode, sortMode, searchQuery, profile?.visibility]);

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

  const coverHeight = useMemo(() => {
    if (viewMode === "list") return 56;
    if (gridCols === 2) return 320;
    if (gridCols === 8) return 140;
    return 220;
  }, [viewMode, gridCols]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      for (const t of tagsFor(it)) {
        if (t.kind === "category") set.add(t.name);
      }
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [items]);

  useEffect(() => {
    if ((filterCategory ?? "").trim()) return;
    if (categoryMode === "all") return;
    if (!availableCategories.some((c) => c === categoryMode)) setCategoryMode("all");
  }, [availableCategories, categoryMode, filterCategory]);

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

  async function bulkMoveSelected() {
    if (!supabase) return;
    if (bulkSelectedGroups.length === 0) return;
    if (!bulkMoveLibraryId) return;
    if (
      !window.confirm(
        `Move ${bulkSelectedGroups.length} book(s) to "${libraries.find((l) => l.id === bulkMoveLibraryId)?.name ?? "selected catalog"}"?`
      )
    )
      return;
    setBulkState({ busy: true, error: null, message: "Moving…" });
    try {
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));
      const upd = await supabase.from("user_books").update({ library_id: bulkMoveLibraryId }).in("id", ids);
      if (upd.error) throw new Error(upd.error.message);
      setBulkSelectedKeys({});
      await refreshAllBooks();
      setBulkState({ busy: false, error: null, message: "Moved" });
      window.setTimeout(() => setBulkState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setBulkState({ busy: false, error: e?.message ?? "Move failed", message: "Move failed" });
    }
  }

  async function bulkCopySelected() {
    if (!supabase) return;
    if (bulkSelectedGroups.length === 0) return;
    if (!bulkMoveLibraryId) return;
    if (
      !window.confirm(
        `Copy ${bulkSelectedGroups.length} book(s) to "${libraries.find((l) => l.id === bulkMoveLibraryId)?.name ?? "selected catalog"}"?`
      )
    )
      return;
    setBulkState({ busy: true, error: null, message: "Copying…" });
    try {
      const ids = Array.from(new Set(bulkSelectedGroups.flatMap((g) => g.copies.map((c) => c.id))));

      const srcRes = await supabase
        .from("user_books")
        .select(
          "id,edition_id,visibility,status,borrowable_override,borrow_request_scope_override,title_override,authors_override,editors_override,designers_override,publisher_override,printer_override,materials_override,edition_override,publish_date_override,description_override,subjects_override,location,shelf,notes"
        )
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
        const inserted = await supabase
          .from("user_books")
          .insert({
            owner_id: userId,
            library_id: bulkMoveLibraryId,
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
          })
          .select("id")
          .single();
        if (inserted.error) throw new Error(inserted.error.message);

        copied += 1;
        const newId = Number((inserted.data as any)?.id);
        const oldId = Number((r as any).id);
        if (Number.isFinite(oldId) && Number.isFinite(newId) && newId > 0) idMap.set(oldId, newId);
        const tagIds = (tagsByBookId[oldId] ?? []).filter((t) => Number.isFinite(t) && t > 0);
        if (Number.isFinite(newId) && newId > 0 && tagIds.length > 0) {
          const rows = tagIds.map((tagId) => ({ user_book_id: newId, tag_id: tagId }));
          const insTags = await supabase.from("user_book_tags").insert(rows as any);
          if (insTags.error) {
            // continue; tags are optional
          }
        }
      }

      // Copy media objects into the new user_book ids (server-side storage copy; avoids browser CORS).
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
            if (ins.error) {
              // ignore; still uploaded
            }
          } catch {
            // ignore per-file errors
          }
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
        window.localStorage.setItem(
          "om_libraryOrder",
          next
            .map((l) => l.id)
            .filter((n) => Number.isFinite(n) && n > 0)
            .join(",")
        );
      } catch {
        // ignore
      }
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
      gap: 12
    }),
    [viewMode, gridCols]
  );

  function renderGroup(g: CatalogGroup) {
    const it = g.primary;
    const e = it.edition;
    const title = g.title;
    const effectiveAuthors = effectiveAuthorsFor(it);
    const tags = g.tagNames;
    const selected = !!bulkSelectedKeys[g.key];
    const coverUrl =
      g.copies
        .map((c) => {
          const cover = (c.media ?? []).find((m) => m.kind === "cover");
          if (!cover) return null;
          return mediaUrlsByPath[cover.storage_path] ?? null;
        })
        .find(Boolean) ?? e?.cover_url ?? null;
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
        coverHeight={coverHeight}
        onDeleteCopy={() => deleteEntry(it.id)}
        deleteState={delState as any}
        showDeleteCopy={bulkMode}
      />
    );
  }

  return (
    <div className="card">
      <div className="muted">Catalog items: {userBooksCount ?? "…"}</div>

      <div style={{ marginTop: 16 }} className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>Add</div>
          {libraries.length > 1 ? (
            <span className="row" style={{ gap: 8 }}>
              <span className="muted">Catalog</span>
              <select
                value={addLibraryId ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setAddLibraryId(id);
                  try {
                    window.localStorage.setItem("om_addLibraryId", String(id));
                  } catch {
                    // ignore
                  }
                }}
                disabled={libraryState.busy || !addLibraryId}
              >
                {libraries.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </span>
          ) : null}
        </div>
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
          <input
            placeholder="ISBN, URL, or title (optional: “by Author”)"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              smartAddOrSearch();
            }}
            style={{ minWidth: 380, width: 520, maxWidth: "100%" }}
          />
          <button onClick={smartAddOrSearch} disabled={addState.busy || !addInput.trim()}>
            {addState.busy ? "Working…" : "Go"}
          </button>
          {addUrlPreview || addSearchResults.length > 0 || addSearchState.message || addState.message ? (
            <button onClick={cancelAddPreview} disabled={addState.busy || addSearchState.busy}>
              Cancel
            </button>
          ) : null}
          <span className="muted">{addState.message ? (addState.error ? `${addState.message} (${addState.error})` : addState.message) : ""}</span>
        </div>

        {addUrlPreview ? (
          <div style={{ marginTop: 10 }} className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ width: 62, flex: "0 0 auto" }}>
                {addUrlPreview.cover_url && !addPreviewCoverFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/image-proxy?url=${encodeURIComponent(addUrlPreview.cover_url)}`}
                    alt=""
                    width={60}
                    height={90}
                    style={{ display: "block", objectFit: "cover", border: "1px solid var(--border)" }}
                    onError={() => setAddPreviewCoverFailed(true)}
                  />
                ) : (
                  <div style={{ width: 60, height: 90, border: "1px solid var(--border)" }} />
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
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/image-proxy?url=${encodeURIComponent(String(r.cover_url))}`}
                          alt=""
                          width={60}
                          height={90}
                          style={{ display: "block", objectFit: "cover", border: "1px solid var(--border)" }}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <div style={{ width: 60, height: 90, border: "1px solid var(--border)" }} />
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
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted">Catalogs</span>
            <span>{libraries.length}</span>
            {libraryState.message ? <span className="muted">{libraryState.message}</span> : libraryState.error ? <span className="muted">{libraryState.error}</span> : null}
          </div>
          <div className="muted">
            {filterTag || filterAuthor || filterSubject || filterPublisher || (filterCategory ?? categoryMode) !== "all" ? (
              <>
                filtered{" "}
                {filterTag ? (
                  <>
                    tag: <span>{filterTag}</span>
                  </>
                ) : null}
                {filterTag && (filterAuthor || filterSubject || filterPublisher || (filterCategory ?? categoryMode) !== "all") ? <span>, </span> : null}
                {filterAuthor ? (
                  <>
                    author: <span>{filterAuthor}</span>
                  </>
                ) : null}{" "}
                {filterAuthor && (filterSubject || filterPublisher || (filterCategory ?? categoryMode) !== "all") ? <span>, </span> : null}
                {filterSubject ? (
                  <>
                    subject: <span>{filterSubject}</span>
                  </>
                ) : null}{" "}
                {filterSubject && (filterPublisher || (filterCategory ?? categoryMode) !== "all") ? <span>, </span> : null}
                {filterPublisher ? (
                  <>
                    publisher: <span>{filterPublisher}</span>
                  </>
                ) : null}{" "}
                {filterPublisher && (filterCategory ?? categoryMode) !== "all" ? <span>, </span> : null}
                {(filterCategory ?? categoryMode) !== "all" ? (
                  <>
                    category: <span>{filterCategory ?? categoryMode}</span>
                  </>
                ) : null}{" "}
                (<Link href="/app">clear</Link>)
              </>
            ) : null}
          </div>
        </div>
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span className="muted">View</span>
          <select value={viewMode} onChange={(e) => setViewMode(e.target.value as any)}>
            <option value="grid">grid</option>
            <option value="list">list</option>
          </select>
          {viewMode === "grid" ? (
            <>
              <span className="muted">Columns</span>
              <select value={gridCols} onChange={(e) => setGridCols(Number(e.target.value) as any)}>
                <option value={2}>2</option>
                <option value={4}>4</option>
                <option value={8}>8</option>
              </select>
            </>
          ) : null}
          <span className="muted">Sort</span>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)}>
            <option value="latest">latest</option>
            <option value="earliest">earliest</option>
            <option value="title_asc">title A→Z</option>
            <option value="title_desc">title Z→A</option>
          </select>
          <span className="muted">Category</span>
          <select value={categoryMode} onChange={(e) => setCategoryMode(e.target.value)}>
            <option value="all">all</option>
            {availableCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="muted">Visibility</span>
          <select value={visibilityMode} onChange={(e) => setVisibilityMode(e.target.value as any)}>
            <option value="all">all</option>
            <option value="public">public</option>
            <option value="private">private</option>
          </select>
          <span className="muted">
            Showing {displayGroups.length} books
          </span>
          {bulkMode ? (
            <span className="muted">
              Selected: {bulkSelectedCount}
            </span>
          ) : null}
        </div>
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span className="muted">Search</span>
          <input
            placeholder="Search your catalog…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ minWidth: 260 }}
          />
          {searchQuery.trim() ? (
            <button onClick={() => setSearchQuery("")} aria-label="Clear search">
              Clear
            </button>
          ) : null}
          <span className="muted">
            <Link href={`/app/discover${searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ""}`}>Search friends / public</Link>
          </span>
          <span style={{ flex: "1 1 auto" }} />
          <button
            onClick={() => {
              setBulkMode((prev) => {
                const next = !prev;
                if (!next) setBulkSelectedKeys({});
                setBulkState({ busy: false, error: null, message: null });
                return next;
              });
            }}
          >
            {bulkMode ? "Done" : "Edit"}
          </button>
        </div>
        <BulkBar
          bulkMode={bulkMode}
          bulkState={bulkState}
          selectedGroupsCount={bulkSelectedGroups.length}
          libraries={libraries.map((l) => ({ id: l.id, name: l.name }))}
          bulkCategoryName={bulkCategoryName}
          setBulkCategoryName={setBulkCategoryName}
          bulkMoveLibraryId={bulkMoveLibraryId}
          setBulkMoveLibraryId={(next) => setBulkMoveLibraryId(next)}
          onBulkDeleteSelected={bulkDeleteSelected}
          onBulkMakePublic={bulkMakePublic}
          onBulkMakePrivate={bulkMakePrivate}
          onBulkAssignCategory={bulkAssignCategory}
          onBulkMoveSelected={bulkMoveSelected}
          onBulkCopySelected={bulkCopySelected}
        />

        {libraries.map((lib, idx) => {
          const groups = displayGroupsByLibraryId[lib.id] ?? [];
          const isEditing = editingLibraryId === lib.id;
          return (
            <LibraryBlock
              key={lib.id}
              libraryId={lib.id}
              libraryName={lib.name}
              bookCount={groups.length}
              index={idx}
              total={libraries.length}
              busy={libraryState.busy}
              isEditing={isEditing}
              nameDraft={libraryNameDraft}
              onStartEdit={beginEditLibrary}
              onNameDraftChange={setLibraryNameDraft}
              onSaveName={saveLibraryName}
              onCancelEdit={cancelEditLibrary}
              onDelete={deleteLibrary}
              onMoveUp={(id) => moveLibrary(id, -1)}
              onMoveDown={(id) => moveLibrary(id, 1)}
            >
              {groups.length === 0 ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  No books yet.
                </div>
              ) : (
                <div style={{ marginTop: 10, ...booksContainerStyle }}>{groups.map(renderGroup)}</div>
              )}
            </LibraryBlock>
          );
        })}

        <div style={{ marginTop: 14 }} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>Add another catalog</div>
          </div>
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 10 }}>
            <input
              placeholder="Catalog name (e.g. Home, Office)"
              value={newLibraryName}
              onChange={(e) => setNewLibraryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                createLibrary(newLibraryName);
              }}
              style={{ minWidth: 260 }}
            />
            <button onClick={() => createLibrary(newLibraryName)} disabled={libraryState.busy || !newLibraryName.trim()}>
              Add
            </button>
            <span className="muted">
              {libraryState.message ? (libraryState.error ? `${libraryState.message} (${libraryState.error})` : libraryState.message) : libraryState.error ?? ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AppPage() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
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
  const filterCategory = searchParams.get("category");
  return (
    <AppShell
      session={session}
      filterTag={filterTag}
      filterAuthor={filterAuthor}
      filterSubject={filterSubject}
      filterPublisher={filterPublisher}
      filterCategory={filterCategory}
    />
  );
}
