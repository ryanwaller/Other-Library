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
  searchParams: Promise<{
    author?: string;
    tag?: string;
    subject?: string;
    category?: string;
    publisher?: string;
    decade?: string;
    designer?: string;
    q?: string;
    publish_date?: string;
    release_date?: string;
    original_release_year?: string;
    format?: string;
    release_type?: string;
    pressing?: string;
    catalog_number?: string;
    barcode?: string;
    country?: string;
    discogs_id?: string;
    musicbrainz_id?: string;
    speed?: string;
    channels?: string;
    disc_count?: string;
    limited_edition?: string;
    reissue?: string;
  }>;
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
  searchParams: Promise<{
    author?: string; tag?: string; subject?: string; category?: string; publisher?: string; decade?: string; designer?: string; q?: string;
    publish_date?: string; release_date?: string; original_release_year?: string; format?: string; release_type?: string; pressing?: string;
    catalog_number?: string; barcode?: string; country?: string; discogs_id?: string; musicbrainz_id?: string; speed?: string; channels?: string;
    disc_count?: string; limited_edition?: string; reissue?: string;
  }>
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
  const filterPublishDate = rawParams.publish_date ? decodeURIComponent(rawParams.publish_date) : undefined;
  const filterReleaseDate = rawParams.release_date ? decodeURIComponent(rawParams.release_date) : undefined;
  const filterOriginalReleaseYear = rawParams.original_release_year ? decodeURIComponent(rawParams.original_release_year) : undefined;
  const filterFormat = rawParams.format ? decodeURIComponent(rawParams.format) : undefined;
  const filterReleaseType = rawParams.release_type ? decodeURIComponent(rawParams.release_type) : undefined;
  const filterPressing = rawParams.pressing ? decodeURIComponent(rawParams.pressing) : undefined;
  const filterCatalogNumber = rawParams.catalog_number ? decodeURIComponent(rawParams.catalog_number) : undefined;
  const filterBarcode = rawParams.barcode ? decodeURIComponent(rawParams.barcode) : undefined;
  const filterCountry = rawParams.country ? decodeURIComponent(rawParams.country) : undefined;
  const filterDiscogsId = rawParams.discogs_id ? decodeURIComponent(rawParams.discogs_id) : undefined;
  const filterMusicbrainzId = rawParams.musicbrainz_id ? decodeURIComponent(rawParams.musicbrainz_id) : undefined;
  const filterSpeed = rawParams.speed ? decodeURIComponent(rawParams.speed) : undefined;
  const filterChannels = rawParams.channels ? decodeURIComponent(rawParams.channels) : undefined;
  const filterDiscCount = rawParams.disc_count ? decodeURIComponent(rawParams.disc_count) : undefined;
  const filterLimitedEdition = rawParams.limited_edition ? decodeURIComponent(rawParams.limited_edition) : undefined;
  const filterReissue = rawParams.reissue ? decodeURIComponent(rawParams.reissue) : undefined;

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

  const [avatarSigned, followCountsRes, booksRes] = await Promise.all([
    profile.avatar_path
      ? supabase.storage.from("avatars").createSignedUrl(profile.avatar_path, 60 * 30)
      : Promise.resolve(null),
    supabase.rpc("get_follow_counts", { target_username: profile.username }),
    supabase
      .from("user_books")
      .select("id,library_id,visibility,title_override,authors_override,editors_override,subjects_override,publisher_override,materials_override,designers_override,group_label,object_type,decade,sort_order,source_type,source_url,external_source_ids,music_metadata,publish_date_override,description_override,location,shelf,status,primary_cover_ref,cover_original_url,cover_crop,created_at,edition:editions(id,isbn13,title,authors,cover_url,subjects,publisher,publish_date,description),media:user_book_media(kind,storage_path),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,entity:entities(id,name,slug))")
      .eq("owner_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(1000)
  ]);

  const avatarUrl: string | null = (avatarSigned as any)?.data?.signedUrl ?? null;

  let followersCount: number | null = null;
  let followingCount: number | null = null;
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
  let libraries: Array<{ id: number; name: string; sort_order: number | null }> = [];
  if (libraryIds.length > 0) {
    const librariesRes = await supabase.from("libraries").select("id,name,sort_order").in("id", libraryIds);
    libraries = ((librariesRes.data ?? []) as any[])
      .map((l) => ({ id: Number(l.id), name: String(l.name ?? `Catalog ${l.id}`), sort_order: l.sort_order ?? null }))
      .filter((l) => Number.isFinite(l.id) && l.id > 0);
    if (libraries.length === 0) {
      libraries = libraryIds.map((id) => ({ id, name: `Catalog ${id}`, sort_order: null }));
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
          initialFilters={{
            author: filterAuthor,
            subject: filterSubject,
            tag: filterTag,
            category: filterCategory,
            publisher: filterPublisher,
            decade: filterDecade,
            designer: filterDesigner,
            publish_date: filterPublishDate,
            release_date: filterReleaseDate,
            original_release_year: filterOriginalReleaseYear,
            format: filterFormat,
            release_type: filterReleaseType,
            pressing: filterPressing,
            catalog_number: filterCatalogNumber,
            barcode: filterBarcode,
            country: filterCountry,
            discogs_id: filterDiscogsId,
            musicbrainz_id: filterMusicbrainzId,
            speed: filterSpeed,
            channels: filterChannels,
            disc_count: filterDiscCount,
            limited_edition: filterLimitedEdition,
            reissue: filterReissue
          }}
        />
        </AddToLibraryProvider>
      </div>
    </main>
  );
}
