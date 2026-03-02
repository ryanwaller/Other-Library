import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../lib/supabaseServer";
import Link from "next/link";
import { bookIdSlug } from "../../../lib/slug";
import FollowControls from "./FollowControls";
import AddToLibraryButton from "./AddToLibraryButton";
import AddToLibraryProvider from "./AddToLibraryProvider";
import CoverImage, { type CoverCrop } from "../../../components/CoverImage";
import PublicBookList from "./PublicBookList";

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

  const followersCountRes = await supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", profile.id).eq("status", "approved");
  const followingCountRes = await supabase.from("follows").select("followee_id", { count: "exact", head: true }).eq("follower_id", profile.id).eq("status", "approved");
  const followersCount = followersCountRes.count;
  const followingCount = followingCountRes.count;

  const librariesRes = await supabase.from("libraries").select("id,name").eq("owner_id", profile.id).order("created_at", { ascending: true });
  const libraries = (librariesRes.data ?? []) as Array<{ id: number; name: string }>;

  const booksRes = await supabase
    .from("user_books")
    .select("id,library_id,visibility,title_override,authors_override,cover_original_url,cover_crop,edition:editions(id,isbn13,title,authors,cover_url),media:user_book_media(kind,storage_path)")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(1000);

  const books = (booksRes.data ?? []) as any as PublicBook[];
  const visibleBooks = books.filter((b) => {
    if (b.visibility === "public") return true;
    if (b.visibility === "followers_only") return false;
    return profile.visibility === "public";
  });

  const mediaPaths = Array.from(new Set([
    ...visibleBooks.flatMap(b => b.media.map(m => m.storage_path)),
    ...visibleBooks.filter(b => b.cover_crop && b.cover_original_url).map(b => b.cover_original_url as string)
  ]));

  let signedMap: Record<string, string> = {};
  if (mediaPaths.length > 0) {
    const signed = await supabase.storage.from("user-book-media").createSignedUrls(mediaPaths, 60 * 60);
    if (signed.data) {
      for (const s of signed.data) {
        if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
      }
    }
  }

  const byKey = new Map<string, PublicBook[]>();
  for (const b of visibleBooks) {
    const key = groupKeyFor(b);
    const cur = byKey.get(key);
    if (!cur) byKey.set(key, [b]);
    else cur.push(b);
  }

  type CatalogGroup = { key: string; libraryId: number; primary: PublicBook; copies: PublicBook[] };
  const groupedBooks: CatalogGroup[] = Array.from(byKey.entries()).map(([key, copies]) => {
    const primary = copies.slice().sort((a, b) => {
      const score = (x: PublicBook) => {
        let s = 0;
        if (x.media.some(m => m.kind === 'cover')) s += 1000;
        if (x.edition?.cover_url) s += 150;
        return s;
      };
      return score(b) - score(a);
    })[0]!;
    return { key, libraryId: primary.library_id, primary, copies };
  });

  const groupsByLibraryId = new Map<number, CatalogGroup[]>();
  for (const g of groupedBooks) {
    const list = groupsByLibraryId.get(g.libraryId) ?? [];
    list.push(g);
    groupsByLibraryId.set(g.libraryId, list);
  }

  const DEFAULT_LIBRARY_NAME = "Your catalog";
  const showLibraryBlocks = libraries.length > 1 || (libraries.length === 1 && libraries[0]?.name !== DEFAULT_LIBRARY_NAME);
  const editionIds = Array.from(new Set(visibleBooks.map(b => b.edition?.id).filter(Boolean))) as number[];

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            {avatarUrl ? (
              <div style={{ width: 48, height: 48, borderRadius: 999, overflow: "hidden", border: "1px solid var(--border)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src={avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: 999, border: "1px solid var(--border)", background: "var(--bg-muted)" }} />
            )}
            <div>
              <div style={{ fontSize: "1em" }}>{profile.display_name || `@${profile.username}`}</div>
              {profile.display_name ? <div className="muted">@{profile.username}</div> : null}
            </div>
          </div>
        </div>

        <div className="row muted" style={{ marginTop: 12, gap: 16 }}>
          <Link href={`/u/${profile.username}/followers`} className="muted">
            Followers <span style={{ marginInline: 10 }}>{followersCount ?? "—"}</span>
          </Link>
          <Link href={`/u/${profile.username}/following`} className="muted">
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
        <div className="row" style={{ marginTop: 16, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted">Catalogs</span>
          <span>{libraries.length}</span>
          <span className="muted">Books</span>
          <span>{groupedBooks.length}</span>
        </div>

        {showLibraryBlocks ? (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            {libraries.map((lib) => {
              const groups = groupsByLibraryId.get(lib.id) ?? [];
              if (groups.length === 0) return null;
              return (
                <div key={lib.id} className="card">
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                    <div>{lib.name}</div>
                    <div className="muted">
                      {groups.length} book{groups.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <PublicBookList
                    groups={groups}
                    username={profile.username}
                    profileId={profile.id}
                    signedMap={signedMap}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: "var(--space-sm)" }}>
            <PublicBookList
              groups={groupedBooks}
              username={profile.username}
              profileId={profile.id}
              signedMap={signedMap}
            />
          </div>
        )}
      </AddToLibraryProvider>
    </main>
  );
}
