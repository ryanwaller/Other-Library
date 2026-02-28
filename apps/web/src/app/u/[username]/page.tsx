import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../lib/supabaseServer";
import Link from "next/link";
import { bookIdSlug } from "../../../lib/slug";
import FollowControls from "./FollowControls";
import AddToLibraryButton from "./AddToLibraryButton";
import AddToLibraryProvider from "./AddToLibraryProvider";
import CoverImage, { type CoverCrop } from "../../../components/CoverImage";

export const dynamic = "force-dynamic";

type PublicBook = {
  id: number;
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  title_override: string | null;
  authors_override: string[] | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
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
    .select("id,username,display_name,bio,visibility,avatar_path,borrowable_default,borrow_request_scope")
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

  const countsRes = await supabase.rpc("get_follow_counts", { target_username: usernameNorm });
  const countsRow = Array.isArray(countsRes.data) ? (countsRes.data[0] as any) : ((countsRes.data as any) ?? null);
  const followersCount = typeof countsRow?.followers_count === "number" ? (countsRow.followers_count as number) : null;
  const followingCount = typeof countsRow?.following_count === "number" ? (countsRow.following_count as number) : null;

  const booksRes = await supabase
    .from("user_books")
    .select(
      "id,library_id,visibility,title_override,authors_override,cover_original_url,cover_crop,edition:editions(id,isbn13,title,authors,cover_url),media:user_book_media(kind,storage_path)"
    )
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const books = (booksRes.data ?? []) as unknown as PublicBook[];

  // Try to load visible libraries so we can group public books by catalog.
  // Note: this requires a libraries select policy that allows viewing libraries
  // when the viewer can see at least one book in that library.
  const librariesRes = await supabase
    .from("libraries")
    .select("id,name,created_at")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: true });

  const librariesRaw = (librariesRes.data ?? []) as Array<{ id: number; name: string; created_at: string }>;
  const fallbackLibraries = Array.from(new Set(books.map((b) => Number(b.library_id)).filter((n) => Number.isFinite(n) && n > 0)))
    .sort((a, b) => a - b)
    .map((id) => ({ id, name: `Catalog ${id}`, created_at: new Date(0).toISOString() }));

  const libraries = librariesRaw.length > 0 ? librariesRaw : fallbackLibraries;

  const paths = Array.from(
    new Set([
      ...books
        .flatMap((b) => (Array.isArray(b.media) ? b.media : []))
        .filter((m) => m?.kind === "cover")
        .filter((m) => typeof m.storage_path === "string" && m.storage_path.length > 0)
        .map((m) => m.storage_path),
      ...books
        .filter((b) => b.cover_crop && typeof b.cover_original_url === "string" && b.cover_original_url)
        .map((b) => b.cover_original_url as string)
    ])
  );

  const signedMap: Record<string, string> = {};
  if (paths.length > 0) {
    const signedRes = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 30);
    for (const s of signedRes.data ?? []) {
      if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
    }
  }

  const groupedMap = new Map<string, { copies: PublicBook[] }>();
  for (const b of books) {
    // Keep libraries separate: the same edition can exist in multiple libraries.
    const key = `${b.library_id}:${groupKeyFor(b)}`;
    const cur = groupedMap.get(key);
    if (!cur) groupedMap.set(key, { copies: [b] });
    else cur.copies.push(b);
  }
  const groupedBooks = Array.from(groupedMap.values()).map((g) => {
    const primary = g.copies[0];
    return { primary, copies: g.copies };
  });
  const editionIds = Array.from(new Set(groupedBooks.map((g) => g.primary.edition?.id).filter(Boolean))) as number[];

  const groupsByLibraryId = new Map<number, typeof groupedBooks>();
  for (const g of groupedBooks) {
    const libId = Number(g.primary.library_id);
    if (!Number.isFinite(libId) || libId <= 0) continue;
    const cur = groupsByLibraryId.get(libId);
    if (!cur) groupsByLibraryId.set(libId, [g]);
    else cur.push(g);
  }

  const showLibraryBlocks = libraries.length > 1;

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="om-avatar-lockup">
            {avatarUrl ? (
              <a href={avatarUrl} target="_blank" rel="noreferrer" aria-label="Open avatar" className="om-avatar-link">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src={avatarUrl} className="om-avatar-img om-avatar-img-public" />
              </a>
            ) : null}
            <div>{profile.username}</div>
          </div>
          <div className="muted">{profile.visibility}</div>
        </div>
        {profile.display_name ? <div style={{ marginTop: 6 }}>{profile.display_name}</div> : null}
        <div className="row muted" style={{ marginTop: 8, justifyContent: "flex-start", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
          <Link href={`/u/${profile.username}/followers`} style={{ textDecoration: "none" }}>
            Followers <span style={{ marginInline: 10 }}>{followersCount ?? "—"}</span>
          </Link>
          <Link href={`/u/${profile.username}/following`} style={{ textDecoration: "none" }}>
            Following <span style={{ marginInline: 10 }}>{followingCount ?? "—"}</span>
          </Link>
          <FollowControls profileId={profile.id} profileUsername={profile.username} inline />
        </div>
        {profile.bio ? (
          <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
            {profile.bio}
          </div>
        ) : null}
      </div>

      <AddToLibraryProvider editionIds={editionIds}>
        {showLibraryBlocks ? (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            {libraries.map((lib) => {
              const groups = groupsByLibraryId.get(lib.id) ?? [];
              if (groups.length === 0) return null;
              return (
                <div key={lib.id} className="card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>{lib.name}</div>
                    <div className="muted">
                      {groups.length} book{groups.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
                    {groups.map((g) => {
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
                      const cropData = b.cover_crop ?? null;
                      const imageSrc = cropData && b.cover_original_url ? (signedMap[b.cover_original_url] ?? coverUrl) : coverUrl;
                      const href = `/u/${profile.username}/b/${bookIdSlug(b.id, title)}`;
                      return (
                        <div key={b.id} className="om-book-card">
                          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                            <span className="muted">{g.copies.length > 1 ? `(${g.copies.length})` : ""}</span>
                            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "nowrap" }}>
                              <AddToLibraryButton
                                editionId={e?.id ?? null}
                                titleFallback={title}
                                authorsFallback={effectiveAuthors}
                                sourceOwnerId={profile.id}
                                compact
                              />
                            </div>
                          </div>
                          <Link href={href} style={{ display: "block", marginTop: 6 }} className="om-book-card-link">
                            <div className="om-cover-slot" style={{ width: "100%", height: 220 }}>
                              <CoverImage alt={title} src={imageSrc} cropData={cropData} style={{ width: "100%", height: "100%", display: "block" }} />
                            </div>
                          </Link>
                          <div style={{ marginTop: 8 }}>
                            <Link href={href}>{title}</Link>
                          </div>
                          <div className="om-book-secondary">
                            {effectiveAuthors.length > 0 ? (
                              effectiveAuthors.map((a, idx) => (
                                <span key={a}>
                                  <Link href={`/u/${profile.username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                                  {idx < effectiveAuthors.length - 1 ? <span>, </span> : null}
                                </span>
                              ))
                            ) : "—"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
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
              const cropData = b.cover_crop ?? null;
              const imageSrc = cropData && b.cover_original_url ? (signedMap[b.cover_original_url] ?? coverUrl) : coverUrl;
              const href = `/u/${profile.username}/b/${bookIdSlug(b.id, title)}`;
              return (
                <div key={b.id} className="om-book-card">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <span className="muted">{g.copies.length > 1 ? `(${g.copies.length})` : ""}</span>
                    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "nowrap" }}>
                      <AddToLibraryButton editionId={e?.id ?? null} titleFallback={title} authorsFallback={effectiveAuthors} sourceOwnerId={profile.id} compact />
                    </div>
                  </div>
                  <Link href={href} style={{ display: "block", marginTop: 6 }} className="om-book-card-link">
                    <div className="om-cover-slot" style={{ width: "100%", height: 220 }}>
                      <CoverImage alt={title} src={imageSrc} cropData={cropData} style={{ width: "100%", height: "100%", display: "block" }} />
                    </div>
                  </Link>
                  <div style={{ marginTop: 8 }}>
                    <Link href={href}>{title}</Link>
                  </div>
                  <div className="om-book-secondary">
                    {effectiveAuthors.length > 0 ? (
                      effectiveAuthors.map((a, idx) => (
                        <span key={a}>
                          <Link href={`/u/${profile.username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                          {idx < effectiveAuthors.length - 1 ? <span>, </span> : null}
                        </span>
                      ))
                    ) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AddToLibraryProvider>
    </main>
  );
}
