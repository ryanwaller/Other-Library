"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabaseClient";
import SignInCard from "../components/SignInCard";

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
  const [isbn, setIsbn] = useState("");
  const [busyAdd, setBusyAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualAuthors, setManualAuthors] = useState("");
  const [manualState, setManualState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
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
    latestCreatedAt: number;
    earliestCreatedAt: number;
  };

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [mediaUrlsByPath, setMediaUrlsByPath] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [gridCols, setGridCols] = useState<2 | 4 | 8>(4);
  const [sortMode, setSortMode] = useState<"latest" | "earliest" | "title_asc" | "title_desc">("latest");
  const [categoryMode, setCategoryMode] = useState<string>("all");
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
      if (vm === "grid" || vm === "list") setViewMode(vm);
      if (gc === "2" || gc === "4" || gc === "8") setGridCols(Number(gc) as any);
      if (sm === "latest" || sm === "earliest" || sm === "title_asc" || sm === "title_desc") setSortMode(sm);
      if (cm && typeof cm === "string") setCategoryMode(cm);
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
    } catch {
      // ignore
    }
  }, [viewMode, gridCols, sortMode, categoryMode, filterCategory]);

  useEffect(() => {
    const normalized = (filterCategory ?? "").trim();
    if (!normalized) return;
    setCategoryMode(normalized);
  }, [filterCategory]);

  const header = useMemo(() => {
    const name = profile?.username ?? userId;
    const publicProfileHref = profile?.username ? `/u/${profile.username}` : null;
    return (
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <Link href="/app" style={{ textDecoration: "none" }}>
            Other Library
          </Link>
        </div>
        <div className="row">
          {avatarUrl ? (
            publicProfileHref ? (
              <Link href={publicProfileHref} style={{ display: "inline-flex" }} aria-label="Open public profile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  src={avatarUrl}
                  style={{ width: 22, height: 22, borderRadius: 999, objectFit: "cover", border: "1px solid var(--border)" }}
                />
              </Link>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={avatarUrl} style={{ width: 22, height: 22, borderRadius: 999, objectFit: "cover", border: "1px solid var(--border)" }} />
            )
          ) : null}
          {publicProfileHref ? (
            <Link href={publicProfileHref} className="muted" style={{ textDecoration: "none" }}>
              {avatarUrl ? name : profile ? `@${profile.username}` : userId}
            </Link>
          ) : (
            <span className="muted">{avatarUrl ? name : profile ? `@${profile.username}` : userId}</span>
          )}
          <Link href="/app/settings">Settings</Link>
          <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }, [profile, userId, avatarUrl]);

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
    if (paths.length === 0) return;

    const { data: signed, error: signErr } = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 60);
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

  async function addByIsbn() {
    if (!supabase) return;
    if (!addLibraryId) return;
    setBusyAdd(true);
    setAddError(null);
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

      const created = await supabase.from("user_books").insert({ owner_id: userId, library_id: addLibraryId, edition_id: editionId }).select("id");
      if (created.error) throw new Error(created.error.message);

      setIsbn("");
      await refreshAllBooks();
      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", userId);
      setUserBooksCount(count ?? 0);
    } catch (e: any) {
      setAddError(e?.message ?? "Failed to add book");
    } finally {
      setBusyAdd(false);
    }
  }

  async function addManual() {
    if (!supabase) return;
    if (!addLibraryId) return;
    const title = manualTitle.trim();
    const authors = parseAuthorsInput(manualAuthors);
    if (!title) return;
    setManualState({ busy: true, error: null, message: "Adding…" });
    try {
      const created = await supabase
        .from("user_books")
        .insert({
          owner_id: userId,
          library_id: addLibraryId,
          edition_id: null,
          title_override: title,
          authors_override: authors.length > 0 ? authors : null
        })
        .select("id")
        .single();
      if (created.error) throw new Error(created.error.message);

      setManualTitle("");
      setManualAuthors("");
      await refreshAllBooks();
      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", userId);
      setUserBooksCount(count ?? 0);
      setManualState({ busy: false, error: null, message: "Added" });
      window.setTimeout(() => setManualState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setManualState({ busy: false, error: e?.message ?? "Failed to add book", message: "Add failed" });
    }
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
    const tag = (filterTag ?? "").trim().toLowerCase();
    const author = (filterAuthor ?? "").trim().toLowerCase();
    const subject = (filterSubject ?? "").trim().toLowerCase();
    const publisher = (filterPublisher ?? "").trim().toLowerCase();
    const activeCategoryMode = (filterCategory ?? categoryMode) || "all";
    const categoryTag = (activeCategoryMode === "all" ? "" : String(activeCategoryMode)).trim().toLowerCase();

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
      const primary = sorted[0]!;
      const title = effectiveTitleFor(primary);

      const tagSet = new Set<string>();
      const categorySet = new Set<string>();
      const authorsSet = new Set<string>();
      const subjectsSet = new Set<string>();
      const publishersSet = new Set<string>();
      const visSet = new Set<string>();
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
        const ts = Date.parse(c.created_at);
        if (Number.isFinite(ts)) {
          latest = Math.max(latest, ts);
          earliest = Math.min(earliest, ts);
        }
      }

      const visibility = visSet.size === 1 ? (primary.visibility as any) : "mixed";

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

    const titleKey = (g: CatalogGroup) => normalizeKeyPart(g.title);
    groups.sort((a, b) => {
      if (sortMode === "latest") return b.latestCreatedAt - a.latestCreatedAt;
      if (sortMode === "earliest") return a.earliestCreatedAt - b.earliestCreatedAt;
      const cmp = titleKey(a).localeCompare(titleKey(b));
      return sortMode === "title_asc" ? cmp : -cmp;
    });

    return groups;
  }, [filteredItems, filterTag, filterAuthor, filterSubject, filterPublisher, filterCategory, categoryMode, sortMode]);

  const displayCopiesCount = useMemo(() => displayGroups.reduce((sum, g) => sum + g.copiesCount, 0), [displayGroups]);

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
          "id,edition_id,visibility,status,borrowable_override,borrow_request_scope_override,title_override,authors_override,subjects_override,publisher_override,publish_date_override,description_override,location,shelf,notes"
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
            subjects_override: (r as any).subjects_override ?? null,
            publisher_override: (r as any).publisher_override ?? null,
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
        const tagIds = (tagsByBookId[oldId] ?? []).filter((t) => Number.isFinite(t) && t > 0);
        if (Number.isFinite(newId) && newId > 0 && tagIds.length > 0) {
          const rows = tagIds.map((tagId) => ({ user_book_id: newId, tag_id: tagId }));
          const insTags = await supabase.from("user_book_tags").insert(rows as any);
          if (insTags.error) {
            // continue; tags are optional
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
    const pendingCover = pendingCoverByBookId[it.id];
    const coverState = coverUploadStateByBookId[it.id];
    const delState = deleteStateByBookId[it.id];
    const coverEl = coverUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={title} src={coverUrl} style={{ width: "100%", height: coverHeight, objectFit: "contain", border: "1px solid var(--border)" }} />
    ) : (
      <div style={{ width: "100%", height: coverHeight, border: "1px solid var(--border)" }} />
    );

    if (viewMode === "list") {
      return (
        <div key={it.id} className="card" style={{ display: "grid", gridTemplateColumns: bulkMode ? "26px 70px 1fr" : "70px 1fr", gap: 12, alignItems: "start" }}>
          {bulkMode ? <input type="checkbox" checked={selected} onChange={() => toggleBulkKey(g.key)} aria-label="Select book" /> : null}
          <Link href={`/app/books/${it.id}`} style={{ display: "block" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {coverUrl ? (
              <img alt={title} src={coverUrl} style={{ width: 70, height: 70, objectFit: "cover", border: "1px solid var(--border)" }} />
            ) : (
              <div style={{ width: 70, height: 70, border: "1px solid var(--border)" }} />
            )}
          </Link>
          <div>
            <div>
              <Link href={`/app/books/${it.id}`}>{title}</Link> <span className="muted">{g.copiesCount > 1 ? `(${g.copiesCount})` : ""}</span>
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
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
                e?.isbn13 || ""
              )}
            </div>
            {tags.length > 0 ? (
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {tags.slice(0, 6).map((t) => (
                  <span key={t} style={{ border: "1px solid var(--border)", padding: "2px 6px" }}>
                    <Link href={`/app?tag=${encodeURIComponent(t)}`} style={{ textDecoration: "none" }}>
                      {t}
                    </Link>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 10 }}>
              <span className="muted">Visibility</span>
              <select value={g.visibility} onChange={(ev) => updateUserBookVisibilityGroup(g.copies.map((c) => c.id), ev.target.value as any)}>
                {g.visibility === "mixed" ? (
                  <option value="mixed" disabled>
                    mixed
                  </option>
                ) : null}
                <option value="inherit">inherit</option>
                <option value="followers_only">followers_only</option>
                <option value="public">public</option>
              </select>
              <span className="muted">Cover</span>
              <input key={coverInputKeyByBookId[it.id] ?? 0} type="file" accept="image/*" onChange={(ev) => selectPendingCover(it.id, ev.target.files)} />
              {pendingCover ? (
                <>
                  <button onClick={() => uploadSelectedCover(it.id)} disabled={coverState?.busy ?? false}>
                    {coverState?.busy ? "Uploading…" : "Submit"}
                  </button>
                  <button onClick={() => clearPendingCover(it.id)} disabled={coverState?.busy ?? false}>
                    Clear
                  </button>
                </>
              ) : null}
              <button onClick={() => deleteEntry(it.id)} disabled={delState?.busy ?? false} title="Deletes one copy">
                Delete copy
              </button>
              <span className="muted">{delState?.message ? (delState?.error ? `${delState?.message} (${delState?.error})` : delState?.message) : ""}</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={it.id} className="card">
        {bulkMode ? (
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <input type="checkbox" checked={selected} onChange={() => toggleBulkKey(g.key)} aria-label="Select book" />
            <span className="muted">{g.copiesCount > 1 ? `(${g.copiesCount})` : ""}</span>
          </div>
        ) : null}
        <Link href={`/app/books/${it.id}`} style={{ display: "block" }}>
          {coverEl}
        </Link>
        <div style={{ marginTop: 8 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
            <Link href={`/app/books/${it.id}`}>{title}</Link>
            {!bulkMode ? <span className="muted">{g.copiesCount > 1 ? `(${g.copiesCount})` : ""}</span> : null}
          </div>
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
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
            e?.isbn13 || ""
          )}
        </div>

        {tags.length > 0 ? (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {tags.slice(0, 6).map((t) => (
              <span key={t} style={{ border: "1px solid var(--border)", padding: "2px 6px" }}>
                <Link href={`/app?tag=${encodeURIComponent(t)}`} style={{ textDecoration: "none" }}>
                  {t}
                </Link>
              </span>
            ))}
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
          <div className="muted">Visibility</div>
          <select value={g.visibility} onChange={(ev) => updateUserBookVisibilityGroup(g.copies.map((c) => c.id), ev.target.value as any)}>
            {g.visibility === "mixed" ? (
              <option value="mixed" disabled>
                mixed
              </option>
            ) : null}
            <option value="inherit">inherit</option>
            <option value="followers_only">followers_only</option>
            <option value="public">public</option>
          </select>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="muted">Cover override</div>
          <input key={coverInputKeyByBookId[it.id] ?? 0} type="file" accept="image/*" onChange={(ev) => selectPendingCover(it.id, ev.target.files)} style={{ marginTop: 6 }} />
          {pendingCover ? (
            <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
              <div className="row">
                <button onClick={() => uploadSelectedCover(it.id)} disabled={coverState?.busy ?? false}>
                  {coverState?.busy ? "Uploading…" : "Submit"}
                </button>
                <button onClick={() => clearPendingCover(it.id)} disabled={coverState?.busy ?? false} style={{ marginLeft: 8 }}>
                  Clear
                </button>
              </div>
              <div className="muted">{coverState?.message ? (coverState?.error ? `${coverState?.message} (${coverState?.error})` : coverState?.message) : ""}</div>
            </div>
          ) : coverState?.message ? (
            <div className="muted" style={{ marginTop: 6 }}>
              {coverState?.error ? `${coverState?.message} (${coverState?.error})` : coverState?.message}
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 6 }}>
              Upload a cover if the book has no online cover.
            </div>
          )}
        </div>

        <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
          <Link href={`/app/books/${it.id}`} className="muted">
            Details
          </Link>
          <button onClick={() => deleteEntry(it.id)} disabled={delState?.busy ?? false} title="Deletes one copy">
            Delete copy
          </button>
        </div>
        {delState?.message ? (
          <div className="muted" style={{ marginTop: 6 }}>
            {delState?.error ? `${delState?.message} (${delState?.error})` : delState?.message}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card">
      {header}
      <div style={{ marginTop: 8 }}>
        Catalog items: {userBooksCount ?? "…"}
      </div>

      <div style={{ marginTop: 16 }} className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>Add books</div>
          <div className="muted">
            {libraries.length > 1 ? (
              <span className="row" style={{ gap: 8 }}>
                <span>Catalog</span>
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
            ) : (
              <>ISBN or manual</>
            )}
          </div>
        </div>

        <div style={{ marginTop: 10 }} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>Add by ISBN</div>
            <div className="muted">Open Library → Google Books → Wikidata</div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <input
              placeholder="ISBN-10 or ISBN-13"
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addByIsbn();
              }}
              style={{ minWidth: 260 }}
            />
            <button onClick={addByIsbn} disabled={busyAdd || !isbn.trim()}>
              {busyAdd ? "Adding…" : "Add"}
            </button>
            {addError ? <span className="muted">{addError}</span> : null}
          </div>
        </div>

        <div style={{ marginTop: 10 }} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>Add manually</div>
            <div className="muted">for books without ISBN</div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <input
              placeholder="Title"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addManual();
              }}
              style={{ minWidth: 260 }}
            />
            <input
              placeholder="Authors (comma-separated)"
              value={manualAuthors}
              onChange={(e) => setManualAuthors(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addManual();
              }}
              style={{ minWidth: 260 }}
            />
            <button onClick={addManual} disabled={manualState.busy || !manualTitle.trim()}>
              {manualState.busy ? "Adding…" : "Add"}
            </button>
            <span className="muted">
              {manualState.message ? (manualState.error ? `${manualState.message} (${manualState.error})` : manualState.message) : ""}
            </span>
          </div>
        </div>
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
            ) : (
              <>(most recent first)</>
            )}
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
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={bulkMode}
              onChange={(e) => {
                setBulkMode(e.target.checked);
                setBulkSelectedKeys({});
                setBulkState({ busy: false, error: null, message: null });
              }}
            />
            <span className="muted">Bulk</span>
          </label>
          <span className="muted">
            Showing {displayGroups.length} books
            {typeof userBooksCount === "number" ? ` / ${userBooksCount} copies` : ` (${displayCopiesCount} copies)`}
          </span>
          {bulkMode ? (
            <span className="muted">
              Selected: {bulkSelectedCount}
            </span>
          ) : null}
        </div>
        {bulkMode ? (
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button onClick={bulkDeleteSelected} disabled={bulkState.busy || bulkSelectedGroups.length === 0}>
              Delete selected
            </button>
            <span className="muted">Category</span>
            <input
              placeholder="Add category"
              value={bulkCategoryName}
              onChange={(e) => setBulkCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                bulkAssignCategory();
              }}
              style={{ minWidth: 180 }}
            />
            <button onClick={bulkAssignCategory} disabled={bulkState.busy || bulkSelectedGroups.length === 0 || !bulkCategoryName.trim()}>
              Apply
            </button>
            <span className="muted">Move to</span>
            <select value={bulkMoveLibraryId ?? ""} onChange={(e) => setBulkMoveLibraryId(Number(e.target.value))} disabled={bulkState.busy}>
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button onClick={bulkMoveSelected} disabled={bulkState.busy || bulkSelectedGroups.length === 0 || !bulkMoveLibraryId}>
              Move
            </button>
            <button onClick={bulkCopySelected} disabled={bulkState.busy || bulkSelectedGroups.length === 0 || !bulkMoveLibraryId}>
              Copy
            </button>
            {bulkState.message ? <span className="muted">{bulkState.error ? `${bulkState.message} (${bulkState.error})` : bulkState.message}</span> : null}
          </div>
        ) : null}

        {libraries.map((lib, idx) => {
          const groups = displayGroupsByLibraryId[lib.id] ?? [];
          const copiesInLibrary = groups.reduce((sum, g) => sum + g.copiesCount, 0);
          return (
            <div key={lib.id} className="card" style={{ marginTop: 14 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="row" style={{ gap: 10 }}>
                  {editingLibraryId === lib.id ? (
                    <span className="row" style={{ gap: 8 }}>
                      <input
                        value={libraryNameDraft}
                        onChange={(e) => setLibraryNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEditLibrary();
                            return;
                          }
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          saveLibraryName(lib.id, libraryNameDraft);
                        }}
                        autoFocus
                        style={{ minWidth: 220 }}
                      />
                      <button onClick={() => saveLibraryName(lib.id, libraryNameDraft)} disabled={libraryState.busy || !libraryNameDraft.trim()}>
                        Save
                      </button>
                      <button onClick={cancelEditLibrary} disabled={libraryState.busy}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => beginEditLibrary(lib.id, lib.name)}
                      style={{ padding: 0, border: "none", background: "transparent", textDecoration: "underline" }}
                      aria-label="Rename catalog"
                    >
                      {lib.name}
                    </button>
                  )}
                  <span className="muted">
                    {groups.length} book{groups.length === 1 ? "" : "s"} / {copiesInLibrary} cop{copiesInLibrary === 1 ? "y" : "ies"}
                  </span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {idx > 0 ? (
                    <button onClick={() => moveLibrary(lib.id, -1)} disabled={libraryState.busy} aria-label="Move catalog up">
                      ↑
                    </button>
                  ) : null}
                  {idx < libraries.length - 1 ? (
                    <button onClick={() => moveLibrary(lib.id, 1)} disabled={libraryState.busy} aria-label="Move catalog down">
                      ↓
                    </button>
                  ) : null}
                </div>
              </div>

              {groups.length === 0 ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  No books yet.
                </div>
              ) : (
                <div style={{ marginTop: 10, ...booksContainerStyle }}>{groups.map(renderGroup)}</div>
              )}
            </div>
          );
        })}

        <div style={{ marginTop: 14 }} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>Add another catalog</div>
            <div className="muted">optional</div>
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
      <div style={{ marginBottom: 12 }} className="muted">
        App (followers-only by default). Marketing and crawlable public pages live on the main domain.
      </div>
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
