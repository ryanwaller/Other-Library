import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../lib/supabaseServer";
import Link from "next/link";
import { bookIdSlug } from "../../../lib/slug";
import FollowControls from "./FollowControls";
import AddToLibraryButton from "./AddToLibraryButton";
import AddToLibraryProvider from "./AddToLibraryProvider";

export const dynamic = "force-dynamic";

type PublicBook = {
  id: number;
  visibility: "inherit" | "followers_only" | "public";
  title_override: string | null;
  authors_override: string[] | null;
  edition: { id: number; isbn13: string | null; title: string | null; authors: string[] | null; cover_url: string | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

function normalizeKeyPart(input: string): string {
  return (input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function effectiveTitleFor(b: PublicBook): string {
  const e = b.edition;
  return (b.title_override ?? "").trim() || e?.title || "(untitled)";
}

function effectiveAuthorsFor(b: PublicBook): string[] {
  const override = (b.authors_override ?? []).filter(Boolean);
  if (override.length > 0) return override;
  return (b.edition?.authors ?? []).filter(Boolean);
}

function groupKeyFor(b: PublicBook): string {
  const eId = b.edition?.id ?? null;
  if (eId) return `e:${eId}`;
  const title = normalizeKeyPart(effectiveTitleFor(b));
  const authors = effectiveAuthorsFor(b)
    .map((a) => normalizeKeyPart(a))
    .filter(Boolean)
    .join("|");
  return `m:${title}|${authors}`;
}

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const usernameNorm = (username ?? "").trim().toLowerCase();
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
    permanentRedirect(`/u/${usernameNorm}`);
  }

  const aliasRes = await supabase.from("username_aliases").select("current_username").eq("old_username", usernameNorm).maybeSingle();
  const alias = (aliasRes.data as any)?.current_username as string | undefined;
  if (alias && alias !== usernameNorm) {
    permanentRedirect(`/u/${alias}`);
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
          <div>@{username}</div>
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
      "id,visibility,title_override,authors_override,edition:editions(id,isbn13,title,authors,cover_url),media:user_book_media(kind,storage_path)"
    )
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const books = (booksRes.data ?? []) as unknown as PublicBook[];

  const paths = Array.from(
    new Set(
      books
        .flatMap((b) => (Array.isArray(b.media) ? b.media : []))
        .filter((m) => m?.kind === "cover")
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

  const groupedMap = new Map<string, { primary: PublicBook; copies: PublicBook[] }>();
  for (const b of books) {
    const key = groupKeyFor(b);
    const cur = groupedMap.get(key);
    if (!cur) groupedMap.set(key, { primary: b, copies: [b] });
    else cur.copies.push(b);
  }
  const groupedBooks = Array.from(groupedMap.values());
  const editionIds = Array.from(new Set(groupedBooks.map((g) => g.primary.edition?.id).filter(Boolean))) as number[];

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            {avatarUrl ? (
              <a href={avatarUrl} target="_blank" rel="noreferrer" aria-label="Open avatar">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  src={avatarUrl}
                  style={{ width: 24, height: 24, borderRadius: 999, objectFit: "cover", border: "1px solid var(--border)" }}
                />
              </a>
            ) : null}
            <div>{profile.username}</div>
          </div>
          <div className="muted">{profile.visibility}</div>
        </div>
        {profile.display_name ? <div style={{ marginTop: 6 }}>{profile.display_name}</div> : null}
        {profile.bio ? (
          <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
            {profile.bio}
          </div>
        ) : null}
        <FollowControls profileId={profile.id} profileUsername={profile.username} />
      </div>

      <div style={{ marginTop: 14 }} className="muted">
        Publicly visible books
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
        <AddToLibraryProvider editionIds={editionIds}>
          {groupedBooks.map((g) => {
            const b = g.primary;
            const e = b.edition;
            const title = effectiveTitleFor(b);
            const effectiveAuthors = effectiveAuthorsFor(b);
            const coverUrl =
              g.copies
                .map((c) => {
                  const cover = (c.media ?? []).find((m) => m.kind === "cover");
                  if (!cover) return null;
                  return signedMap[cover.storage_path] ?? null;
                })
                .find(Boolean) ?? e?.cover_url ?? null;
            const href = `/u/${profile.username}/b/${bookIdSlug(b.id, title)}`;
            return (
              <div key={b.id} className="card">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span className="muted">{g.copies.length > 1 ? `(${g.copies.length})` : ""}</span>
                  <AddToLibraryButton editionId={e?.id ?? null} titleFallback={title} authorsFallback={effectiveAuthors} sourceOwnerId={profile.id} compact />
                </div>
                <Link href={href} style={{ display: "block", marginTop: 6 }}>
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
                  {effectiveAuthors.length > 0 ? (
                    effectiveAuthors.map((a, idx) => (
                      <span key={a}>
                        <Link href={`/u/${profile.username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                        {idx < effectiveAuthors.length - 1 ? <span>, </span> : null}
                      </span>
                    ))
                  ) : (
                    e?.isbn13 || ""
                  )}
                </div>
              </div>
            );
          })}
      </AddToLibraryProvider>
      </div>
    </main>
  );
}
