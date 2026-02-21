"use client";

import { useEffect, useMemo, useState } from "react";
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
        Followers-only by default; public is optional later.
      </div>
    </div>
  );
}

function AppShell({ session }: { session: Session }) {
  const userId = session.user.id;
  const [profile, setProfile] = useState<{ username: string; visibility: string } | null>(null);
  const [userBooksCount, setUserBooksCount] = useState<number | null>(null);
  const [isbn, setIsbn] = useState("");
  const [busyAdd, setBusyAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [busyProfile, setBusyProfile] = useState(false);
  const [items, setItems] = useState<
    Array<{
      id: number;
      created_at: string;
      visibility: "inherit" | "followers_only" | "public";
      edition: { id: number; isbn13: string | null; title: string | null; authors: string[] | null; cover_url: string | null } | null;
      media: Array<{ id: number; kind: "cover" | "image"; storage_path: string; caption: string | null; created_at: string }>;
    }>
  >([]);
  const [mediaUrlsByPath, setMediaUrlsByPath] = useState<Record<string, string>>({});

  const header = useMemo(() => {
    return (
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>Other Library</div>
        <div className="row">
          <span className="muted">{profile ? `@${profile.username}` : userId}</span>
          <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }, [profile, userId]);

  async function refreshCatalog() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("user_books")
      .select("id,created_at,visibility,edition:editions(id,isbn13,title,authors,cover_url),media:user_book_media(id,kind,storage_path,caption,created_at)")
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
        .select("username,visibility")
        .eq("id", userId)
        .maybeSingle();
      if (!alive) return;
      if (profileData) setProfile(profileData);

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

  async function uploadImages(userBookId: number, files: FileList | null) {
    if (!supabase || !files || files.length === 0) return;
    const toUpload = Array.from(files).filter((f) => f.size > 0);
    if (toUpload.length === 0) return;

    for (const file of toUpload) {
      const path = `${userId}/${userBookId}/${Date.now()}-${safeFileName(file.name)}`;
      const up = await supabase.storage.from("user-book-media").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "application/octet-stream"
      });
      if (up.error) {
        setAddError(up.error.message);
        continue;
      }
      const ins = await supabase.from("user_book_media").insert({
        user_book_id: userBookId,
        kind: "image",
        storage_path: path,
        caption: null
      });
      if (ins.error) setAddError(ins.error.message);
    }

    await refreshCatalog();
  }

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
          <div className="muted">(most recent first)</div>
        </div>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {items.map((it) => {
            const e = it.edition;
            const title = e?.title ?? "(untitled)";
            const authors = (e?.authors ?? []).filter(Boolean).join(", ");
            const images = (it.media ?? []).filter((m) => m.kind === "image");
            return (
              <div key={it.id} className="card">
                {e?.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={title}
                    src={e.cover_url}
                    style={{ width: "100%", height: 220, objectFit: "contain", border: "1px solid #eee" }}
                  />
                ) : (
                  <div style={{ width: "100%", height: 220, border: "1px solid #eee" }} />
                )}
                <div style={{ marginTop: 8 }}>{title}</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {authors || e?.isbn13 || ""}
                </div>

                <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                  <div className="muted">Book visibility</div>
                  <select value={it.visibility} onChange={(ev) => updateUserBookVisibility(it.id, ev.target.value as any)}>
                    <option value="inherit">inherit</option>
                    <option value="followers_only">followers_only</option>
                    <option value="public">public</option>
                  </select>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div className="muted">Additional images</div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(ev) => uploadImages(it.id, ev.target.files)}
                    style={{ marginTop: 6 }}
                  />
                  {images.length > 0 ? (
                    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                      {images.slice(0, 6).map((m) => {
                        const url = mediaUrlsByPath[m.storage_path];
                        return url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={m.id} alt="" src={url} style={{ width: "100%", height: 70, objectFit: "cover", border: "1px solid #eee" }} />
                        ) : (
                          <div key={m.id} style={{ width: "100%", height: 70, border: "1px solid #eee" }} />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="muted" style={{ marginTop: 6 }}>
                      None yet.
                    </div>
                  )}
                </div>
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
        <AppShell session={session} />
      ) : (
        <SignIn />
      )}
    </main>
  );
}
