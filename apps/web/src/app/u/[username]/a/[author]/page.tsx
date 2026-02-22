import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../../../lib/supabaseServer";
import { bookIdSlug } from "../../../../../lib/slug";

export const dynamic = "force-dynamic";

type PublicBook = {
  id: number;
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
      "id,visibility,title_override,authors_override,edition:editions(isbn13,title,authors,cover_url,subjects),media:user_book_media(kind,storage_path)"
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

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="row">
              {avatarUrl ? (
                <Link href={`/u/${profile.username}`} style={{ display: "inline-flex" }} aria-label="Open profile">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    src={avatarUrl}
                    style={{ width: 24, height: 24, borderRadius: 999, objectFit: "cover", border: "1px solid var(--border)" }}
                  />
                </Link>
              ) : null}
              <Link href={`/u/${profile.username}`}>{profile.username}</Link>
            </div>
          </div>
          <div className="muted">author</div>
        </div>
        <div style={{ marginTop: 8 }}>{authorName || "—"}</div>
      </div>

      <div style={{ marginTop: 14 }} className="muted">
        Books ({filtered.length})
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
        {filtered.map((b) => {
          const e = b.edition;
          const title = ((b.title_override ?? "").trim() || e?.title || "(untitled)") as string;
          const cover = (b.media ?? []).find((m) => m.kind === "cover");
          const coverUrl = cover ? signedMap[cover.storage_path] : e?.cover_url ?? null;
          const href = `/u/${profile.username}/b/${bookIdSlug(b.id, title)}`;
          return (
            <div key={b.id} className="card">
              <Link href={href} style={{ display: "block" }}>
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={title} src={coverUrl} style={{ width: "100%", height: 220, objectFit: "contain", border: "1px solid var(--border)" }} />
                ) : (
                  <div style={{ width: "100%", height: 220, border: "1px solid var(--border)" }} />
                )}
              </Link>
              <div style={{ marginTop: 8 }}>
                <Link href={href}>{title}</Link>
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {e?.isbn13 || ""}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
