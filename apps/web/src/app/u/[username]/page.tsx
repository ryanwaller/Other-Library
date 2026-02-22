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
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  title_override: string | null;
  authors_override: string[] | null;
  borrowable_override: boolean | null;
  borrow_request_scope_override: "anyone" | "approved_followers" | null;
  edition: { id: number; isbn13: string | null; title: string | null; authors: string[] | null; cover_url: string | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

type BorrowScope = "anyone" | "approved_followers";

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

function effectiveBorrowableFor(b: PublicBook, profile: any): boolean {
  if (b.borrowable_override === true) return true;
  if (b.borrowable_override === false) return false;
  return Boolean(profile?.borrowable_default);
}

function effectiveScopeFor(b: PublicBook, profile: any): BorrowScope {
  const raw = (b.borrow_request_scope_override ?? profile?.borrow_request_scope ?? "approved_followers") as string;
  return raw === "anyone" ? "anyone" : "approved_followers";
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
      "id,library_id,visibility,title_override,authors_override,borrowable_override,borrow_request_scope_override,edition:editions(id,isbn13,title,authors,cover_url),media:user_book_media(kind,storage_path)"
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

  const groupedMap = new Map<string, { copies: PublicBook[] }>();
  for (const b of books) {
    // Keep libraries separate: the same edition can exist in multiple libraries.
    const key = `${b.library_id}:${groupKeyFor(b)}`;
    const cur = groupedMap.get(key);
    if (!cur) groupedMap.set(key, { copies: [b] });
    else cur.copies.push(b);
  }
  const groupedBooks = Array.from(groupedMap.values()).map((g) => {
    const borrowableAny = g.copies.some((b) => effectiveBorrowableFor(b, profile));
    const scopeAny = g.copies.some((b) => effectiveBorrowableFor(b, profile) && effectiveScopeFor(b, profile) === "anyone");
    const primary = g.copies.find((b) => effectiveBorrowableFor(b, profile)) ?? g.copies[0];
    return { primary, copies: g.copies, borrowableAny, scopeAny };
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
        <div className="row muted" style={{ marginTop: 6, gap: 10 }}>
          <Link href={`/u/${profile.username}/followers`} style={{ textDecoration: "none" }}>
            Followers {followersCount ?? "—"}
          </Link>
          <span>·</span>
          <Link href={`/u/${profile.username}/following`} style={{ textDecoration: "none" }}>
            Following {followingCount ?? "—"}
          </Link>
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

      <AddToLibraryProvider editionIds={editionIds}>
        {showLibraryBlocks ? (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 14 }}>
            {libraries.map((lib) => {
              const groups = groupsByLibraryId.get(lib.id) ?? [];
              if (groups.length === 0) return null;
              const copiesCount = groups.reduce((sum, g) => sum + g.copies.length, 0);
              return (
                <div key={lib.id} className="card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>{lib.name}</div>
                    <div className="muted">
                      {groups.length} book{groups.length === 1 ? "" : "s"} / {copiesCount} cop{copiesCount === 1 ? "y" : "ies"}
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
                      const href = `/u/${profile.username}/b/${bookIdSlug(b.id, title)}`;
                      return (
                        <div key={b.id} className="card">
                          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                            <span className="muted">{g.copies.length > 1 ? `(${g.copies.length})` : ""}</span>
                            <div className="row" style={{ gap: 8, alignItems: "center" }}>
                              {g.borrowableAny ? <span className="muted">{g.scopeAny ? "borrowable (anyone)" : "borrowable"}</span> : null}
                              <AddToLibraryButton
                                editionId={e?.id ?? null}
                                titleFallback={title}
                                authorsFallback={effectiveAuthors}
                                sourceOwnerId={profile.id}
                                compact
                              />
                            </div>
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
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
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
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      {g.borrowableAny ? <span className="muted">{g.scopeAny ? "borrowable (anyone)" : "borrowable"}</span> : null}
                      <AddToLibraryButton editionId={e?.id ?? null} titleFallback={title} authorsFallback={effectiveAuthors} sourceOwnerId={profile.id} compact />
                    </div>
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
          </div>
        )}
      </AddToLibraryProvider>
    </main>
  );
}
