import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../../../lib/supabaseServer";
import { bookIdSlug } from "../../../../../lib/slug";

export const dynamic = "force-dynamic";

type PublicBook = {
  id: number;
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  title_override: string | null;
  authors_override: string[] | null;
  edition: { isbn13: string | null; title: string | null; authors: string[] | null; cover_url: string | null; subjects: string[] | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

export default async function PublicAuthorPage({ params }: { params: Promise<{ username: string; author: string }> }) {
  const { username, author } = await params;
  const usernameNorm = (username ?? "").trim().toLowerCase();
  const authorName = safeDecode(author ?? "").trim();
  const supabase = getServerSupabase();

  if (!supabase) {
    return (
      <main className="container">
        <div className="card">
          <div>Supabase is not configured.</div>
        </div>
      </main>
    );
  }

  if (usernameNorm && usernameNorm !== username) {
    permanentRedirect(`/u/${usernameNorm}/a/${encodeURIComponent(authorName)}`);
  }

  const aliasRes = await supabase.from("username_aliases").select("current_username").eq("old_username", usernameNorm).maybeSingle();
  const alias = (aliasRes.data as any)?.current_username as string | undefined;
  if (alias && alias !== usernameNorm) {
    permanentRedirect(`/u/${alias}/a/${encodeURIComponent(authorName)}`);
  }

  const profileRes = await supabase
    .from("profiles")
    .select("id,username,display_name,bio,visibility,avatar_path")
    .eq("username", usernameNorm)
    .maybeSingle();

  const profile = profileRes.data as any;
  if (!profile) {
    return (
      <main className="container">
        <div className="card">
          <div>@{usernameNorm}</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Not found (or private).
          </div>
        </div>
      </main>
    );
  }

  let avatarUrl: string | null = null;
  if (profile.avatar_path) {
    const signed = await supabase.storage.from("avatars").createSignedUrl(profile.avatar_path, 60 * 30);
    avatarUrl = signed.data?.signedUrl ?? null;
  }

  const booksRes = await supabase
    .from("user_books")
    .select(
      "id,library_id,visibility,title_override,authors_override,edition:editions(isbn13,title,authors,cover_url,subjects),media:user_book_media(kind,storage_path)"
    )
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const books = (booksRes.data ?? []) as unknown as PublicBook[];

  const needle = authorName.toLowerCase();
  const filtered = books.filter((b) => {
    const candidates =
      (b.authors_override ?? []).filter(Boolean).length > 0
        ? (b.authors_override ?? []).filter(Boolean)
        : (b.edition?.authors ?? []).filter(Boolean);
    return candidates.some((a) => a.toLowerCase() === needle);
  });

  const paths = Array.from(
    new Set(
      filtered
        .flatMap((b) => (Array.isArray(b.media) ? b.media : []))
        .filter((m) => typeof m.storage_path === "string" && m.storage_path.length > 0)
        .map((m) => m.storage_path)
    )
  );

  const signedMap: Record<string, string> = {};
  if (paths.length > 0) {
    const signedRes = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 30);
    for (const s of signedRes.data ?? []) {
      if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
    }
  }

  const librariesRes = await supabase
    .from("libraries")
    .select("id,name,created_at")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: true });

  const librariesRaw = (librariesRes.data ?? []) as Array<{ id: number; name: string; created_at: string }>;
  const fallbackLibraries = Array.from(new Set(filtered.map((b) => Number(b.library_id)).filter((n) => Number.isFinite(n) && n > 0)))
    .sort((a, b) => a - b)
    .map((id) => ({ id, name: `Catalog ${id}`, created_at: new Date(0).toISOString() }));
  const libraries = librariesRaw.length > 0 ? librariesRaw : fallbackLibraries;

  const groupsByLibraryId = new Map<number, PublicBook[]>();
  for (const b of filtered) {
    const libId = Number(b.library_id);
    if (!Number.isFinite(libId) || libId <= 0) continue;
    const cur = groupsByLibraryId.get(libId);
    if (!cur) groupsByLibraryId.set(libId, [b]);
    else cur.push(b);
  }

  const visibleLibraryCount = libraries.filter((lib) => (groupsByLibraryId.get(lib.id) ?? []).length > 0).length;

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="om-avatar-lockup">
              {avatarUrl ? (
                <Link href={`/u/${profile.username}`} className="om-avatar-link" aria-label="Open profile">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" src={avatarUrl} className="om-avatar-img om-avatar-img-public" />
                </Link>
              ) : null}
              <Link href={`/u/${profile.username}`}>{profile.username}</Link>
            </div>
          </div>
          <div className="muted">author</div>
        </div>
        <div style={{ marginTop: 8 }}>{authorName || "—"}</div>
      </div>

      <div className="row muted" style={{ marginTop: 14, justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div className="row muted" style={{ gap: 12 }}>
          <span>Catalogs</span>
          <span>{visibleLibraryCount}</span>
          <span>Books</span>
          <span>{filtered.length}</span>
        </div>
        <div className="row muted" style={{ gap: 8 }}>
          <span>Author</span>
          <span style={{ color: "var(--fg)" }}>{authorName || "—"}</span>
          <Link href={`/u/${profile.username}`} className="om-inline-link-muted">
            clear
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 14 }}>
        {libraries.map((lib) => {
          const libraryBooks = groupsByLibraryId.get(lib.id) ?? [];
          if (libraryBooks.length === 0) return null;
          return (
            <div key={lib.id}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <div>{lib.name}</div>
                <div className="muted">
                  {libraryBooks.length} book{libraryBooks.length === 1 ? "" : "s"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
                {libraryBooks.map((b) => {
                  const e = b.edition;
                  const title = ((b.title_override ?? "").trim() || e?.title || "(untitled)") as string;
                  const authors = ((b.authors_override ?? []).filter(Boolean).length > 0
                    ? (b.authors_override ?? []).filter(Boolean)
                    : (e?.authors ?? []).filter(Boolean)) as string[];
                  const cover = (b.media ?? []).find((m) => m.kind === "cover");
                  const coverUrl = cover ? signedMap[cover.storage_path] : e?.cover_url ?? null;
                  const href = `/u/${profile.username}/b/${bookIdSlug(b.id, title)}`;
                  return (
                    <div key={b.id} className="om-book-card">
                      <Link href={href} className="om-book-card-link" style={{ display: "block" }}>
                        {coverUrl ? (
                          <div className="om-cover-slot" style={{ width: "100%", height: 220 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt={title} src={coverUrl} style={{ width: "100%", height: 220, objectFit: "contain" }} />
                          </div>
                        ) : (
                          <div className="om-cover-slot" style={{ width: "100%", height: 220 }} />
                        )}
                      </Link>
                      <div style={{ marginTop: 8 }}>
                        <Link href={href} className="om-book-title">
                          {title}
                        </Link>
                      </div>
                      <div className="om-book-secondary">
                        {authors.length > 0
                          ? authors.map((a, idx) => (
                              <span key={a}>
                                <Link href={`/u/${profile.username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                                {idx < authors.length - 1 ? <span>, </span> : null}
                              </span>
                            ))
                          : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
