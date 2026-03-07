import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../lib/supabaseServer";
import Link from "next/link";
import FollowControls from "./FollowControls";
import AddToLibraryProvider from "./AddToLibraryProvider";
import PublicBookList from "./PublicBookList";
import PublicProfileHeader from "../../components/PublicProfileHeader";
import type { PublicBook } from "../../../lib/types";
import { contextFromFilterParams } from "../../../lib/pageTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
  searchParams
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ author?: string; tag?: string; subject?: string; category?: string; publisher?: string; decade?: string; designer?: string; q?: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const usernameNorm = (username ?? "").trim().toLowerCase();
  const rawParams = await searchParams;
  const supabase = getServerSupabase();

  if (!supabase || !usernameNorm) {
    return { title: contextFromFilterParams(rawParams, username || "Profile") };
  }

  const profileRes = await supabase
    .from("profiles")
    .select("username,display_name")
    .eq("username", usernameNorm)
    .maybeSingle();

  const profile = profileRes.data as { username?: string | null; display_name?: string | null } | null;
  const baseContext = String(profile?.display_name ?? "").trim() || String(profile?.username ?? "").trim() || username;
  return { title: contextFromFilterParams(rawParams, baseContext) };
}

export default async function PublicProfilePage({ 
  params,
  searchParams
}: { 
  params: Promise<{ username: string }>,
  searchParams: Promise<{ author?: string; tag?: string; subject?: string; category?: string; publisher?: string; decade?: string; designer?: string; q?: string }>
}) {
  const { username } = await params;
  const rawParams = await searchParams;
  const filterAuthor = rawParams.author ? decodeURIComponent(rawParams.author) : undefined;
  const filterTag = rawParams.tag ? decodeURIComponent(rawParams.tag) : undefined;
  const filterSubject = rawParams.subject ? decodeURIComponent(rawParams.subject) : undefined;
  const filterCategory = rawParams.category ? decodeURIComponent(rawParams.category) : undefined;
  const filterPublisher = rawParams.publisher ? decodeURIComponent(rawParams.publisher) : undefined;
  const filterDecade = rawParams.decade ? decodeURIComponent(rawParams.decade) : undefined;
  const filterDesigner = rawParams.designer ? decodeURIComponent(rawParams.designer) : undefined;
  const filterQuery = rawParams.q ? decodeURIComponent(rawParams.q) : undefined;

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
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
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

  let followersCount: number | null = null;
  let followingCount: number | null = null;
  const followCountsRes = await supabase.rpc("get_follow_counts", { target_username: profile.username });
  if (!followCountsRes.error) {
    const row = Array.isArray(followCountsRes.data) ? ((followCountsRes.data[0] as any) ?? null) : ((followCountsRes.data as any) ?? null);
    followersCount = row && row.followers_count != null ? Number(row.followers_count) : null;
    followingCount = row && row.following_count != null ? Number(row.following_count) : null;
  } else {
    const [followersCountRes, followingCountRes] = await Promise.all([
      supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", profile.id).eq("status", "approved"),
      supabase.from("follows").select("followee_id", { count: "exact", head: true }).eq("follower_id", profile.id).eq("status", "approved")
    ]);
    followersCount = followersCountRes.count ?? null;
    followingCount = followingCountRes.count ?? null;
  }

  const booksRes = await supabase
    .from("user_books")
    .select("*,edition:editions(id,isbn13,title,authors,cover_url,subjects,publisher,publish_date,description),media:user_book_media(kind,storage_path),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,entity:entities(id,name,slug))")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(1000);

  const books = (booksRes.data ?? []) as any as PublicBook[];
  const visibleBooks = books.filter((b) => {
    if (b.visibility === "public") return true;
    if (b.visibility === "followers_only") return false;
    return profile.visibility === "public";
  });

  const libraryIds = Array.from(
    new Set(
      visibleBooks
        .map((b) => Number((b as any).library_id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  let libraries: Array<{ id: number; name: string }> = [];
  if (libraryIds.length > 0) {
    const librariesRes = await supabase.from("libraries").select("id,name").in("id", libraryIds);
    libraries = ((librariesRes.data ?? []) as any[])
      .map((l) => ({ id: Number(l.id), name: String(l.name ?? `Catalog ${l.id}`) }))
      .filter((l) => Number.isFinite(l.id) && l.id > 0);
    if (libraries.length === 0) {
      libraries = libraryIds.map((id) => ({ id, name: `Catalog ${id}` }));
    }
  }

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
      <PublicProfileHeader
        avatarUrl={avatarUrl}
        displayName={profile.display_name}
        username={profile.username}
        followerCount={followersCount}
        followingCount={followingCount}
        isLinked={false}
        followButton={<FollowControls profileId={profile.id} profileUsername={profile.username} inline />}
        bio={profile.bio}
      />

      <div style={{ marginTop: "var(--space-lg)" }}>
        <AddToLibraryProvider editionIds={editionIds}>
          <PublicBookList
            libraries={libraries}
            allBooks={visibleBooks}
            username={profile.username}
            profileId={profile.id}
            signedMap={signedMap}
            showLibraryBlocks={showLibraryBlocks}
            initialSearch={filterQuery}
            initialFilters={{ author: filterAuthor, subject: filterSubject, tag: filterTag, category: filterCategory, publisher: filterPublisher, decade: filterDecade, designer: filterDesigner }}
          />
        </AddToLibraryProvider>
      </div>
    </main>
  );
}
