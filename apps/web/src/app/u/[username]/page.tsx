import { getServerSupabase } from "../../../lib/supabaseServer";

export const dynamic = "force-dynamic";

type PublicBook = {
  id: number;
  visibility: "inherit" | "followers_only" | "public";
  edition: { isbn13: string | null; title: string | null; authors: string[] | null; cover_url: string | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
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

  const profileRes = await supabase
    .from("profiles")
    .select("id,username,display_name,bio,visibility")
    .eq("username", username)
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

  const booksRes = await supabase
    .from("user_books")
    .select(
      "id,visibility,edition:editions(isbn13,title,authors,cover_url),media:user_book_media(kind,storage_path)"
    )
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const books = (booksRes.data ?? []) as unknown as PublicBook[];

  const paths = Array.from(
    new Set(
      books
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
          <div>@{profile.username}</div>
          <div className="muted">{profile.visibility}</div>
        </div>
        {profile.display_name ? <div style={{ marginTop: 6 }}>{profile.display_name}</div> : null}
        {profile.bio ? (
          <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
            {profile.bio}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 14 }} className="muted">
        Publicly visible books
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
        {books.map((b) => {
          const e = b.edition;
          const title = e?.title ?? "(untitled)";
          const authors = (e?.authors ?? []).filter(Boolean).join(", ");
          const cover = (b.media ?? []).find((m) => m.kind === "cover");
          const coverUrl = cover ? signedMap[cover.storage_path] : e?.cover_url ?? null;
          const extraImages = (b.media ?? []).filter((m) => m.kind === "image").slice(0, 3);
          return (
            <div key={b.id} className="card">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={title}
                  src={coverUrl}
                  style={{ width: "100%", height: 220, objectFit: "contain", border: "1px solid #eee" }}
                />
              ) : (
                <div style={{ width: "100%", height: 220, border: "1px solid #eee" }} />
              )}
              <div style={{ marginTop: 8 }}>{title}</div>
              <div className="muted" style={{ marginTop: 4 }}>
                {authors || e?.isbn13 || ""}
              </div>
              {extraImages.length > 0 ? (
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {extraImages.map((m, idx) => {
                    const url = signedMap[m.storage_path];
                    return url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={`${b.id}-${idx}`}
                        alt=""
                        src={url}
                        style={{ width: "100%", height: 60, objectFit: "cover", border: "1px solid #eee" }}
                      />
                    ) : (
                      <div key={`${b.id}-${idx}`} style={{ width: "100%", height: 60, border: "1px solid #eee" }} />
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
