"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabaseClient";

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

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signUp() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  }

  async function signIn() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await signIn();
  }

  return (
    <div className="card">
      <form onSubmit={onSubmit}>
        <div className="row">
          <div>Email</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div>Password</div>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy || !email || !password}>
            Sign in
          </button>
          <button type="button" onClick={signUp} disabled={busy || !email || !password}>
            Sign up
          </button>
          {error ? <span className="muted">{error}</span> : null}
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          Followers-only by default; public is optional later.
        </div>
      </form>
    </div>
  );
}

function AppShell({
  session,
  filterTag,
  filterAuthor,
  filterSubject
}: {
  session: Session;
  filterTag: string | null;
  filterAuthor: string | null;
  filterSubject: string | null;
}) {
  const userId = session.user.id;
  const [profile, setProfile] = useState<{ username: string; visibility: string; avatar_path: string | null } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userBooksCount, setUserBooksCount] = useState<number | null>(null);
  const [isbn, setIsbn] = useState("");
  const [busyAdd, setBusyAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [busyProfile, setBusyProfile] = useState(false);
  const [pendingCoverByBookId, setPendingCoverByBookId] = useState<Record<number, File | undefined>>({});
  const [coverUploadStateByBookId, setCoverUploadStateByBookId] = useState<
    Record<number, { busy: boolean; error: string | null; message: string | null } | undefined>
  >({});
  const [coverInputKeyByBookId, setCoverInputKeyByBookId] = useState<Record<number, number>>({});
  const [items, setItems] = useState<
    Array<{
      id: number;
      created_at: string;
      visibility: "inherit" | "followers_only" | "public";
      title_override: string | null;
      authors_override: string[] | null;
      subjects_override: string[] | null;
      edition: { id: number; isbn13: string | null; title: string | null; authors: string[] | null; subjects: string[] | null; cover_url: string | null } | null;
      media: Array<{ id: number; kind: "cover" | "image"; storage_path: string; caption: string | null; created_at: string }>;
      book_tags: Array<{ tag: { id: number; name: string } | null }>;
    }>
  >([]);
  const [mediaUrlsByPath, setMediaUrlsByPath] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [gridCols, setGridCols] = useState<2 | 4 | 8>(4);
  const [sortMode, setSortMode] = useState<"latest" | "earliest" | "title_asc" | "title_desc">("latest");
  const [categoryMode, setCategoryMode] = useState<"all" | "art_books" | "fiction">("all");
  const [deleteStateByBookId, setDeleteStateByBookId] = useState<Record<number, { busy: boolean; error: string | null; message: string | null } | undefined>>(
    {}
  );

  useEffect(() => {
    try {
      const vm = window.localStorage.getItem("om_viewMode");
      const gc = window.localStorage.getItem("om_gridCols");
      const sm = window.localStorage.getItem("om_sortMode");
      const cm = window.localStorage.getItem("om_categoryMode");
      if (vm === "grid" || vm === "list") setViewMode(vm);
      if (gc === "2" || gc === "4" || gc === "8") setGridCols(Number(gc) as any);
      if (sm === "latest" || sm === "earliest" || sm === "title_asc" || sm === "title_desc") setSortMode(sm);
      if (cm === "all" || cm === "art_books" || cm === "fiction") setCategoryMode(cm);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("om_viewMode", viewMode);
      window.localStorage.setItem("om_gridCols", String(gridCols));
      window.localStorage.setItem("om_sortMode", sortMode);
      window.localStorage.setItem("om_categoryMode", categoryMode);
    } catch {
      // ignore
    }
  }, [viewMode, gridCols, sortMode, categoryMode]);

  const header = useMemo(() => {
    const name = profile?.username ?? userId;
    const publicProfileHref = profile?.username ? `/u/${profile.username}` : null;
    return (
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>Other Library</div>
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
          <span className="muted">{avatarUrl ? name : profile ? `@${profile.username}` : userId}</span>
          <Link href="/app/settings">Settings</Link>
          <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }, [profile, userId, avatarUrl]);

  async function refreshCatalog() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("user_books")
      .select(
        "id,created_at,visibility,title_override,authors_override,subjects_override,edition:editions(id,isbn13,title,authors,subjects,cover_url),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name))"
      )
      .order("created_at", { ascending: false })
      .limit(50);
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

      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true });
      if (!alive) return;
      setUserBooksCount(count ?? 0);

      await refreshCatalog();
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  async function addByIsbn() {
    if (!supabase) return;
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

      const created = await supabase.from("user_books").insert({ owner_id: userId, edition_id: editionId }).select("id");
      if (created.error) throw new Error(created.error.message);

      setIsbn("");
      await refreshCatalog();
      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true });
      setUserBooksCount(count ?? 0);
    } catch (e: any) {
      setAddError(e?.message ?? "Failed to add book");
    } finally {
      setBusyAdd(false);
    }
  }

  async function updateProfileVisibility(nextVisibility: "followers_only" | "public") {
    if (!supabase) return;
    setBusyProfile(true);
    try {
      const { error } = await supabase.from("profiles").update({ visibility: nextVisibility }).eq("id", userId);
      if (error) throw new Error(error.message);
      setProfile((p) => (p ? { ...p, visibility: nextVisibility } : p));
    } finally {
      setBusyProfile(false);
    }
  }

  async function updateUserBookVisibility(userBookId: number, nextVisibility: "inherit" | "followers_only" | "public") {
    if (!supabase) return;
    const { error } = await supabase.from("user_books").update({ visibility: nextVisibility }).eq("id", userBookId);
    if (error) return;
    setItems((prev) => prev.map((it) => (it.id === userBookId ? { ...it, visibility: nextVisibility } : it)));
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

    await refreshCatalog();
    clearPendingCover(userBookId);
    setCoverUploadStateByBookId((prev) => ({
      ...prev,
      [userBookId]: { busy: false, error: null, message: "Cover uploaded" }
    }));
  }

  function categoryTagName(mode: "all" | "art_books" | "fiction"): string | null {
    if (mode === "art_books") return "art books";
    if (mode === "fiction") return "fiction";
    return null;
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

      await refreshCatalog();
      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true });
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
    const tag = (filterTag ?? "").trim();
    const author = (filterAuthor ?? "").trim();
    const subject = (filterSubject ?? "").trim();
    if (!tag && !author && !subject) return items;
    return items.filter((it) => {
      const tagNames = (it.book_tags ?? []).map((bt) => bt.tag?.name).filter(Boolean) as string[];
      const effectiveAuthors =
        (it.authors_override ?? []).filter(Boolean).length > 0 ? (it.authors_override ?? []).filter(Boolean) : (it.edition?.authors ?? []).filter(Boolean);
      const editionSubjects = (it.edition?.subjects ?? []).filter(Boolean) as string[];
      const effectiveSubjects = it.subjects_override !== null && it.subjects_override !== undefined ? (it.subjects_override ?? []).filter(Boolean) : editionSubjects;
      const okTag = tag ? tagNames.some((t) => t.toLowerCase() === tag.toLowerCase()) : true;
      const okAuthor = author ? effectiveAuthors.some((a) => a.toLowerCase() === author.toLowerCase()) : true;
      const okSubject = subject ? (effectiveSubjects ?? []).some((s) => String(s).toLowerCase() === subject.toLowerCase()) : true;
      return okTag && okAuthor && okSubject;
    });
  }, [items, filterTag, filterAuthor, filterSubject]);

  const displayItems = useMemo(() => {
    const categoryTag = categoryTagName(categoryMode);
    let rows = [...filteredItems];
    if (categoryTag) {
      rows = rows.filter((it) => {
        const tagNames = (it.book_tags ?? []).map((bt) => bt.tag?.name).filter(Boolean) as string[];
        return tagNames.some((t) => t.toLowerCase() === categoryTag.toLowerCase());
      });
    }

    const getTitle = (it: (typeof rows)[number]) => {
      const e = it.edition;
      const title = it.title_override?.trim() ? it.title_override : e?.title ?? "";
      return title.trim().toLowerCase();
    };

    rows.sort((a, b) => {
      if (sortMode === "latest" || sortMode === "earliest") {
        const at = Date.parse(a.created_at);
        const bt = Date.parse(b.created_at);
        const diff = Number.isFinite(at) && Number.isFinite(bt) ? at - bt : 0;
        return sortMode === "earliest" ? diff : -diff;
      }
      const ta = getTitle(a);
      const tb = getTitle(b);
      const cmp = ta.localeCompare(tb);
      return sortMode === "title_asc" ? cmp : -cmp;
    });

    return rows;
  }, [filteredItems, sortMode, categoryMode]);

  const coverHeight = useMemo(() => {
    if (viewMode === "list") return 56;
    if (gridCols === 2) return 320;
    if (gridCols === 8) return 140;
    return 220;
  }, [viewMode, gridCols]);

  return (
    <div className="card">
      {header}
      <div style={{ marginTop: 12 }} className="muted">
        Status: signed in. Profile visibility: {profile?.visibility ?? "…"}.
      </div>
      <div style={{ marginTop: 10 }} className="row">
        <div>Library visibility</div>
        <select
          value={(profile?.visibility ?? "followers_only") as any}
          onChange={(e) => updateProfileVisibility(e.target.value as any)}
          disabled={busyProfile || !profile}
        >
          <option value="followers_only">followers_only</option>
          <option value="public">public</option>
        </select>
        <span className="muted">When private, you can still mark an individual book public.</span>
      </div>
      <div style={{ marginTop: 8 }}>
        Catalog items: {userBooksCount ?? "…"}
      </div>

      <div style={{ marginTop: 16 }} className="card">
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

      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>Your catalog</div>
          <div className="muted">
            {filterTag || filterAuthor || filterSubject ? (
              <>
                filtered{" "}
                {filterTag ? (
                  <>
                    tag: <span>{filterTag}</span>
                  </>
                ) : null}
                {filterTag && (filterAuthor || filterSubject) ? <span>, </span> : null}
                {filterAuthor ? (
                  <>
                    author: <span>{filterAuthor}</span>
                  </>
                ) : null}{" "}
                {filterAuthor && filterSubject ? <span>, </span> : null}
                {filterSubject ? (
                  <>
                    subject: <span>{filterSubject}</span>
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
          <select value={categoryMode} onChange={(e) => setCategoryMode(e.target.value as any)}>
            <option value="all">all</option>
            <option value="art_books">art books</option>
            <option value="fiction">fiction</option>
          </select>
          <span className="muted">
            Showing {displayItems.length}
            {typeof userBooksCount === "number" ? ` / ${userBooksCount}` : ""}
          </span>
        </div>

        <div
          style={{
            marginTop: 10,
            display: viewMode === "grid" ? "grid" : "flex",
            flexDirection: viewMode === "list" ? "column" : undefined,
            gridTemplateColumns: viewMode === "grid" ? `repeat(${gridCols}, minmax(0, 1fr))` : undefined,
            gap: 12
          }}
        >
          {displayItems.map((it) => {
            const e = it.edition;
            const title = it.title_override?.trim() ? it.title_override : e?.title ?? "(untitled)";
            const effectiveAuthors =
              (it.authors_override ?? []).filter(Boolean).length > 0 ? (it.authors_override ?? []).filter(Boolean) : (e?.authors ?? []).filter(Boolean);
            const tags = (it.book_tags ?? []).map((bt) => bt.tag?.name).filter(Boolean) as string[];
            const cover = (it.media ?? []).find((m) => m.kind === "cover");
            const coverSigned = cover ? mediaUrlsByPath[cover.storage_path] : null;
            const coverUrl = coverSigned ?? e?.cover_url ?? null;
            const pendingCover = pendingCoverByBookId[it.id];
            const coverState = coverUploadStateByBookId[it.id];
            const delState = deleteStateByBookId[it.id];
            const coverEl = coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={title}
                src={coverUrl}
                style={{ width: "100%", height: coverHeight, objectFit: "contain", border: "1px solid var(--border)" }}
              />
            ) : (
              <div style={{ width: "100%", height: coverHeight, border: "1px solid var(--border)" }} />
            );

            if (viewMode === "list") {
              return (
                <div key={it.id} className="card" style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 12 }}>
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
                      <Link href={`/app/books/${it.id}`}>{title}</Link>
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
                      <select value={it.visibility} onChange={(ev) => updateUserBookVisibility(it.id, ev.target.value as any)}>
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
                      <button onClick={() => deleteEntry(it.id)} disabled={delState?.busy ?? false}>
                        Delete
                      </button>
                      <span className="muted">
                        {delState?.message ? (delState?.error ? `${delState?.message} (${delState?.error})` : delState?.message) : ""}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={it.id} className="card">
                <Link href={`/app/books/${it.id}`} style={{ display: "block" }}>
                  {coverEl}
                </Link>
                <div style={{ marginTop: 8 }}>
                  <Link href={`/app/books/${it.id}`}>{title}</Link>
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
                  <select value={it.visibility} onChange={(ev) => updateUserBookVisibility(it.id, ev.target.value as any)}>
                    <option value="inherit">inherit</option>
                    <option value="followers_only">followers_only</option>
                    <option value="public">public</option>
                  </select>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div className="muted">Cover override</div>
                  <input
                    key={coverInputKeyByBookId[it.id] ?? 0}
                    type="file"
                    accept="image/*"
                    onChange={(ev) => selectPendingCover(it.id, ev.target.files)}
                    style={{ marginTop: 6 }}
                  />
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
                  <button onClick={() => deleteEntry(it.id)} disabled={delState?.busy ?? false}>
                    Delete
                  </button>
                </div>
                {delState?.message ? (
                  <div className="muted" style={{ marginTop: 6 }}>
                    {delState?.error ? `${delState?.message} (${delState?.error})` : delState?.message}
                  </div>
                ) : null}
              </div>
            );
          })}
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
        <SignIn />
      )}
    </main>
  );
}

function AppWithFilters({ session }: { session: Session }) {
  const searchParams = useSearchParams();
  const filterTag = searchParams.get("tag");
  const filterAuthor = searchParams.get("author");
  const filterSubject = searchParams.get("subject");
  return <AppShell session={session} filterTag={filterTag} filterAuthor={filterAuthor} filterSubject={filterSubject} />;
}
