import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../../../lib/supabaseServer";
import { bookIdSlug } from "../../../../../lib/slug";

export const dynamic = "force-dynamic";

type PublicBookDetail = {
  id: number;
  visibility: "inherit" | "followers_only" | "public";
  title_override: string | null;
  authors_override: string[] | null;
  edition: {
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
};

function parseBookId(idSlug: string): number | null {
  const m = idSlug.match(/^(\d+)/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default async function PublicBookPage({ params }: { params: Promise<{ username: string; idSlug: string }> }) {
  const { username, idSlug } = await params;
  const usernameNorm = (username ?? "").trim().toLowerCase();
  const bookId = parseBookId(idSlug);
  const supabase = getServerSupabase();

  if (!bookId) {
    return (
      <main className="container">
        <div className="card">
          <div>Invalid book URL.</div>
        </div>
      </main>
    );
  }

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
    permanentRedirect(`/u/${usernameNorm}/b/${idSlug}`);
  }

  const aliasRes = await supabase.from("username_aliases").select("current_username").eq("old_username", usernameNorm).maybeSingle();
  const alias = (aliasRes.data as any)?.current_username as string | undefined;
  if (alias && alias !== usernameNorm) {
    permanentRedirect(`/u/${alias}/b/${idSlug}`);
  }

  const profileRes = await supabase
    .from("profiles")
    .select("id,username,display_name,bio,visibility")
    .eq("username", usernameNorm)
    .maybeSingle();

  const profile = profileRes.data as any;
  if (!profile) {
    return (
      <main className="container">
        <div className="card">
          <div>@{username}</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Not found (or private).
          </div>
        </div>
      </main>
    );
  }

  const bookRes = await supabase
    .from("user_books")
    .select(
      "id,visibility,title_override,authors_override,edition:editions(isbn13,isbn10,title,authors,publisher,publish_date,description,subjects,cover_url),media:user_book_media(id,kind,storage_path,caption,created_at)"
    )
    .eq("id", bookId)
    .eq("owner_id", profile.id)
    .maybeSingle();

  const book = (bookRes.data ?? null) as unknown as PublicBookDetail | null;
  if (!book) {
    return (
      <main className="container">
        <div className="card">
          <div>
            <Link href={`/u/${profile.username}`}>@{profile.username}</Link>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Book not found (or private).
          </div>
        </div>
      </main>
    );
  }

  const effectiveTitle = (book.title_override ?? "").trim() || book.edition?.title || "(untitled)";
  const canonical = bookIdSlug(book.id, effectiveTitle);
  if (idSlug !== canonical) {
    permanentRedirect(`/u/${profile.username}/b/${canonical}`);
  }

  const effectiveAuthors =
    (book.authors_override ?? []).filter(Boolean).length > 0
      ? (book.authors_override ?? []).filter(Boolean)
      : (book.edition?.authors ?? []).filter(Boolean);

  const subjects = ((book.edition?.subjects ?? []).filter(Boolean) as string[]).sort((a, b) => a.localeCompare(b));

  const paths = Array.from(new Set((book.media ?? []).map((m) => m.storage_path).filter(Boolean)));
  const signedMap: Record<string, string> = {};
  if (paths.length > 0) {
    const signedRes = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 30);
    for (const s of signedRes.data ?? []) {
      if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
    }
  }

  const coverMedia = (book.media ?? []).find((m) => m.kind === "cover") ?? null;
  const coverUrl = coverMedia ? signedMap[coverMedia.storage_path] : book.edition?.cover_url ?? null;
  const images = (book.media ?? []).filter((m) => m.kind === "image");

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <Link href={`/u/${profile.username}`}>@{profile.username}</Link>
          </div>
          <div className="muted">public</div>
        </div>
        {profile.display_name ? <div style={{ marginTop: 6 }}>{profile.display_name}</div> : null}
        {profile.bio ? (
          <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
            {profile.bio}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 14 }} className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>{effectiveTitle}</div>
          <div className="muted">{book.edition?.isbn13 ?? book.edition?.isbn10 ?? ""}</div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "220px 1fr", gap: 14 }}>
          <div>
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={effectiveTitle}
                src={coverUrl}
                style={{ width: "100%", height: 280, objectFit: "contain", border: "1px solid var(--border)" }}
              />
            ) : (
              <div style={{ width: "100%", height: 280, border: "1px solid var(--border)" }} />
            )}
          </div>

          <div>
            <div className="muted">Authors</div>
            <div style={{ marginTop: 6 }}>
              {effectiveAuthors.length > 0 ? (
                effectiveAuthors.join(", ")
              ) : (
                <span className="muted">—</span>
              )}
            </div>

            <div style={{ marginTop: 12 }} className="muted">
              Publisher / date
            </div>
            <div style={{ marginTop: 6 }}>
              {book.edition?.publisher ?? "—"}
              {book.edition?.publish_date ? ` (${book.edition.publish_date})` : ""}
            </div>

            <div style={{ marginTop: 12 }} className="muted">
              Subjects
            </div>
            <div style={{ marginTop: 6 }}>
              {subjects.length > 0 ? subjects.join(", ") : <span className="muted">—</span>}
            </div>

            <div style={{ marginTop: 12 }} className="muted">
              Description
            </div>
            <div className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
              {book.edition?.description ?? "—"}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14 }} className="muted">
          Images
        </div>
        {images.length > 0 ? (
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
            {images.map((m) => {
              const url = signedMap[m.storage_path];
              return (
                <a key={m.id} href={url || "#"} target="_blank" rel="noreferrer" className="card">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={url} style={{ width: "100%", height: 120, objectFit: "cover", border: "1px solid var(--border)" }} />
                  ) : (
                    <div style={{ width: "100%", height: 120, border: "1px solid var(--border)" }} />
                  )}
                </a>
              );
            })}
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 8 }}>
            None.
          </div>
        )}
      </div>
    </main>
  );
}
