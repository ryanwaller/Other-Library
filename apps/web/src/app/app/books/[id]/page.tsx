"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../../lib/supabaseClient";
import { bookIdSlug } from "../../../../lib/slug";

type UserBookDetail = {
  id: number;
  owner_id: string;
  visibility: "inherit" | "followers_only" | "public";
  status: "owned" | "loaned" | "selling" | "trading";
  title_override: string | null;
  authors_override: string[] | null;
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
  book_tags: Array<{ tag: { id: number; name: string } | null }>;
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

  return (
    <div className="card">
      <div className="row">
        <div>Email</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div>Password</div>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={signIn} disabled={busy || !email || !password}>
          Sign in
        </button>
        <button onClick={signUp} disabled={busy || !email || !password}>
          Sign up
        </button>
        {error ? <span className="muted">{error}</span> : null}
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        Sign in to view and edit this book.
      </div>
    </div>
  );
}

function normalizeTagName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function safeFileName(name: string): string {
  return name.trim().replace(/[^\w.\-]+/g, "_").slice(0, 120) || "image";
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

export default function BookDetailPage() {
  const params = useParams();
  const idParam = (params as any)?.id;
  const bookId = Number(Array.isArray(idParam) ? idParam[0] : idParam);

  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<UserBookDetail | null>(null);
  const [mediaUrlsByPath, setMediaUrlsByPath] = useState<Record<string, string>>({});
  const [ownerProfile, setOwnerProfile] = useState<{ username: string; visibility: "followers_only" | "public" } | null>(null);
  const [shareState, setShareState] = useState<{ error: string | null; message: string | null }>({ error: null, message: null });

  const [formTitle, setFormTitle] = useState("");
  const [formAuthors, setFormAuthors] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formShelf, setFormShelf] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formVisibility, setFormVisibility] = useState<"inherit" | "followers_only" | "public">("inherit");
  const [formStatus, setFormStatus] = useState<"owned" | "loaned" | "selling" | "trading">("owned");
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

  const [pendingCover, setPendingCover] = useState<File | null>(null);
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

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function refresh() {
    if (!supabase) return;
    if (!Number.isFinite(bookId) || bookId <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await supabase
        .from("user_books")
        .select(
          "id,owner_id,visibility,status,title_override,authors_override,location,shelf,notes,edition:editions(id,isbn10,isbn13,title,authors,publisher,publish_date,description,subjects,cover_url,raw),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name))"
        )
        .eq("id", bookId)
        .maybeSingle();
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
      setFormLocation(row.location ?? "");
      setFormShelf(row.shelf ?? "");
      setFormNotes(row.notes ?? "");
      setFormVisibility(row.visibility);
      setFormStatus(row.status);

      const ownerId = row.owner_id as string | undefined;
      if (ownerId) {
        const profileRes = await supabase.from("profiles").select("username,visibility").eq("id", ownerId).maybeSingle();
        if (!profileRes.error && profileRes.data?.username) {
          setOwnerProfile({ username: profileRes.data.username, visibility: profileRes.data.visibility as any });
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

  const effectiveAuthors = useMemo(() => {
    const override = parseAuthorsInput(formAuthors);
    if (override.length > 0) return override;
    return (book?.edition?.authors ?? []).filter(Boolean);
  }, [formAuthors, book]);

  const tagNames = useMemo(() => {
    return ((book?.book_tags ?? []).map((bt) => bt.tag?.name).filter(Boolean) as string[]).sort((a, b) => a.localeCompare(b));
  }, [book]);

  const coverMedia = useMemo(() => (book?.media ?? []).find((m) => m.kind === "cover") ?? null, [book]);
  const coverUrl = coverMedia ? mediaUrlsByPath[coverMedia.storage_path] : book?.edition?.cover_url ?? null;
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

  const isPubliclyVisible = useMemo(() => {
    if (!book) return false;
    if (book.visibility === "public") return true;
    if (book.visibility === "inherit" && ownerProfile?.visibility === "public") return true;
    return false;
  }, [book, ownerProfile]);

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
    const payload = {
      title_override,
      authors_override: authors_override.length > 0 ? authors_override : null,
      location: formLocation.trim() ? formLocation.trim() : null,
      shelf: formShelf.trim() ? formShelf.trim() : null,
      notes: formNotes.trim() ? formNotes.trim() : null,
      visibility: formVisibility,
      status: formStatus
    };
    const res = await supabase.from("user_books").update(payload).eq("id", book.id);
    if (res.error) {
      setSaveState({ busy: false, error: res.error.message, message: "Save failed" });
      return;
    }
    await refresh();
    setSaveState({ busy: false, error: null, message: "Saved" });
  }

  async function getOrCreateTagId(name: string): Promise<number> {
    if (!supabase || !userId) throw new Error("Not signed in");
    const normalized = normalizeTagName(name);
    const existing = await supabase.from("tags").select("id").eq("owner_id", userId).eq("name", normalized).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.id) return existing.data.id as number;
    const inserted = await supabase.from("tags").insert({ owner_id: userId, name: normalized }).select("id").single();
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
      const tagId = await getOrCreateTagId(name);
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

  async function uploadCover() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    if (!pendingCover) return;
    setCoverState({ busy: true, error: null, message: "Uploading cover…" });

    const path = `${userId}/${book.id}/cover-${Date.now()}-${safeFileName(pendingCover.name)}`;
    const up = await supabase.storage.from("user-book-media").upload(path, pendingCover, {
      cacheControl: "3600",
      upsert: false,
      contentType: pendingCover.type || "application/octet-stream"
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
    setCoverInputKey((k) => k + 1);
    await refresh();
    setCoverState({ busy: false, error: null, message: "Cover uploaded" });
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
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="muted">
          <Link href="/app">← Back</Link>
        </div>
        <div className="row">
          <Link href="/app/settings">Settings</Link>
          {session ? <button onClick={() => supabase?.auth.signOut()}>Sign out</button> : null}
        </div>
      </div>

      {!session ? (
        <SignIn />
      ) : !Number.isFinite(bookId) || bookId <= 0 ? (
        <div className="card">
          <div>Invalid book id.</div>
        </div>
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>{effectiveTitle}</div>
            <div className="muted">{busy ? "Loading…" : error ? error : ""}</div>
          </div>

          <div style={{ marginTop: 10 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Share public link</div>
              <div className="muted">{isPubliclyVisible ? "public" : "not public"}</div>
            </div>
            {publicBookUrl ? (
              <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                <a href={publicBookUrl} target="_blank" rel="noreferrer">
                  {publicBookUrl}
                </a>
                <button onClick={copyPublicLink}>
                  Copy
                </button>
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 8 }}>
                Loading…
              </div>
            )}
            {!isPubliclyVisible ? (
              <div className="muted" style={{ marginTop: 8 }}>
                To make this link work for anyone, set Visibility to <span>public</span> (in Your fields) and save.
              </div>
            ) : null}
            {shareState.message ? (
              <div className="muted" style={{ marginTop: 6 }}>
                {shareState.error ? `${shareState.message} (${shareState.error})` : shareState.message}
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "220px 1fr", gap: 14 }}>
            <div>
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={effectiveTitle} src={coverUrl} style={{ width: "100%", height: 280, objectFit: "contain", border: "1px solid #eee" }} />
              ) : (
                <div style={{ width: "100%", height: 280, border: "1px solid #eee" }} />
              )}

              <div style={{ marginTop: 10 }}>
                <div className="muted">Cover override</div>
                <input key={coverInputKey} type="file" accept="image/*" onChange={(ev) => setPendingCover((ev.target.files ?? [])[0] ?? null)} style={{ marginTop: 6 }} />
                {pendingCover ? (
                  <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                    <button onClick={uploadCover} disabled={coverState.busy}>
                      {coverState.busy ? "Uploading…" : "Submit cover"}
                    </button>
                    <button
                      onClick={() => {
                        setPendingCover(null);
                        setCoverInputKey((k) => k + 1);
                      }}
                      disabled={coverState.busy}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
                {coverState.message ? (
                  <div className="muted" style={{ marginTop: 6 }}>
                    {coverState.error ? `${coverState.message} (${coverState.error})` : coverState.message}
                  </div>
                ) : null}
              </div>
            </div>

            <div>
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
                    Publisher
                  </div>
                  <div>{book?.edition?.publisher ?? "—"}</div>
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Publish date
                  </div>
                  <div>{book?.edition?.publish_date ?? "—"}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="muted">Subjects</div>
                  <div style={{ marginTop: 6 }}>
                    {(book?.edition?.subjects ?? []).filter(Boolean).length > 0 ? (
                      (book?.edition?.subjects ?? []).filter(Boolean).map((s) => (
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
                    {book?.edition?.description ?? "—"}
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
                <details style={{ marginTop: 10 }}>
                  <summary className="muted">Raw metadata</summary>
                  <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(book?.edition?.raw ?? {}, null, 2)}</pre>
                </details>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Your fields
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <div style={{ minWidth: 110 }} className="muted">
                    Visibility
                  </div>
                  <select value={formVisibility} onChange={(e) => setFormVisibility(e.target.value as any)}>
                    <option value="inherit">inherit</option>
                    <option value="followers_only">followers_only</option>
                    <option value="public">public</option>
                  </select>
                  <div className="muted">Per-book override.</div>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Status
                  </div>
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as any)}>
                    <option value="owned">owned</option>
                    <option value="loaned">loaned</option>
                    <option value="selling">selling</option>
                    <option value="trading">trading</option>
                  </select>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Title override
                  </div>
                  <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} style={{ width: 360 }} />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Authors override
                  </div>
                  <input value={formAuthors} onChange={(e) => setFormAuthors(e.target.value)} placeholder="Comma-separated" style={{ width: 360 }} />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Location
                  </div>
                  <input value={formLocation} onChange={(e) => setFormLocation(e.target.value)} placeholder="Home, Studio…" style={{ width: 360 }} />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Shelf
                  </div>
                  <input value={formShelf} onChange={(e) => setFormShelf(e.target.value)} placeholder="Shelf #" style={{ width: 360 }} />
                </div>

                <div style={{ marginTop: 8 }}>
                  <div className="muted">Notes</div>
                  <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={4} style={{ width: "100%", marginTop: 6 }} />
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <button onClick={saveEdits} disabled={saveState.busy || !book || book.owner_id !== userId}>
                    {saveState.busy ? "Saving…" : "Save"}
                  </button>
                  <div className="muted">{saveState.message ? (saveState.error ? `${saveState.message} (${saveState.error})` : saveState.message) : ""}</div>
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Tags
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add a tag" style={{ width: 220 }} />
                  <button onClick={addTag} disabled={tagState.busy || !newTag.trim()}>
                    Add
                  </button>
                  <div className="muted">{tagState.message ? (tagState.error ? `${tagState.message} (${tagState.error})` : tagState.message) : ""}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  {tagNames.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {((book?.book_tags ?? []).map((bt) => bt.tag).filter(Boolean) as Array<{ id: number; name: string }>)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((t) => (
                          <span
                            key={t.id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              border: "1px solid #eee",
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
                            <img alt="" src={url} style={{ width: "100%", height: 120, objectFit: "cover", border: "1px solid #eee" }} />
                          ) : (
                            <div style={{ width: "100%", height: 120, border: "1px solid #eee" }} />
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
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
