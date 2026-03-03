import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../lib/supabaseServer";
import Link from "next/link";
import FollowControls from "./FollowControls";
import AddToLibraryProvider from "./AddToLibraryProvider";
import PublicBookList from "./PublicBookList";
import type { PublicBook } from "../../../lib/types";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({ 
  params,
  searchParams
}: { 
  params: Promise<{ username: string }>,
  searchParams: Promise<{ author?: string; tag?: string; subject?: string; category?: string; publisher?: string }>
}) {
  const { username } = await params;
  const rawParams = await searchParams;
  const filterAuthor = rawParams.author ? decodeURIComponent(rawParams.author) : undefined;
  const filterTag = rawParams.tag ? decodeURIComponent(rawParams.tag) : undefined;
  const filterSubject = rawParams.subject ? decodeURIComponent(rawParams.subject) : undefined;
  const filterCategory = rawParams.category ? decodeURIComponent(rawParams.category) : undefined;
  const filterPublisher = rawParams.publisher ? decodeURIComponent(rawParams.publisher) : undefined;

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
    .select("*,edition:editions(id,isbn13,title,authors,cover_url,subjects,publisher,publish_date,description),media:user_book_media(kind,storage_path)")
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

  const editionIds = Array.from(new Set(visibleBooks.map(b => b.edition?.id).filter(Boolean))) as number[];

  const DEFAULT_LIBRARY_NAME = "Your catalog";
  const showLibraryBlocks = libraries.length > 1 || (libraries.length === 1 && libraries[0]?.name !== DEFAULT_LIBRARY_NAME);

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            {avatarUrl ? (
              <div style={{ width: 48, height: 48, borderRadius: 999, overflow: "hidden", border: "1px solid var(--border-avatar)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src={avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: 999, border: "1px solid var(--border-avatar)", background: "var(--bg-muted)" }} />
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

      <div style={{ marginTop: 24 }}>
        <AddToLibraryProvider editionIds={editionIds}>
          <PublicBookList
            libraries={libraries}
            allBooks={visibleBooks}
            username={profile.username}
            profileId={profile.id}
            signedMap={signedMap}
            showLibraryBlocks={showLibraryBlocks}
            initialFilters={{ author: filterAuthor, subject: filterSubject, tag: filterTag, category: filterCategory, publisher: filterPublisher }}
          />
        </AddToLibraryProvider>
      </div>
    </main>
  );
}
