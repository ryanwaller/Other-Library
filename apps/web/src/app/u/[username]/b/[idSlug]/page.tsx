import Link from "next/link";
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getServerSupabase } from "../../../../../lib/supabaseServer";
import { getPublicEnvOptional } from "../../../../../lib/env";
import { bookIdSlug } from "../../../../../lib/slug";
import { formatDateShort } from "../../../../../lib/formatDate";
import { formatMusicTrackLine, musicDisplayGenres, MUSIC_CONTRIBUTOR_ROLES, parseMusicMetadata, type MusicMetadata } from "../../../../../lib/music";
import { detailFilterHref, type DetailFilterKey } from "../../../../../lib/detailFilters";
import AddToLibraryButton from "../../AddToLibraryButton";
import AddToLibraryProvider from "../../AddToLibraryProvider";
import BorrowRequestWidget from "../../BorrowRequestWidget";
import ScrollToTopOnMount from "../../../../components/ScrollToTopOnMount";
import { ExpandableSubjects, ExpandableDescription } from "./PublicExpandables";
import FollowControls from "../../FollowControls";
import PublicProfileHeader from "../../../../components/PublicProfileHeader";
import { type CoverCrop } from "../../../../../components/CoverImage";
import PublicImageGrid from "./PublicImageGrid";
import PublicBookDetailGrid from "./PublicBookDetailGrid";
import AlsoOwnedBy from "../../AlsoOwnedBy";
import PublicRelatedItemsSection from "./PublicRelatedItemsSection";

export const dynamic = "force-dynamic";

async function getRequestSupabase() {
  const env = getPublicEnvOptional();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie.name, cookie.value, cookie.options);
          }
        } catch {
          // no-op in read-only render paths
        }
      }
    }
  });
}

function musicRoleLabel(role: string): string {
  if (role === "featured artist") return "Featured artist";
  if (role === "art direction") return "Art direction";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function publicMusicFilterHref(username: string, value: string, key: DetailFilterKey = "q"): string {
  return detailFilterHref(`/u/${username}`, key, value);
}

function parseMultiValue(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(input ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

type PublicBookDetail = {
  id: number;
  owner_id: string;
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  status: string | null;
  title_override: string | null;
  authors_override: string[] | null;
  editors_override: string[] | null;
  designers_override: string[] | null;
  publisher_override: string | null;
  printer_override: string | null;
  materials_override: string | null;
  edition_override: string | null;
  publish_date_override: string | null;
  pages: number | null;
  group_label: string | null;
  object_type: string | null;
  source_type?: string | null;
  source_url?: string | null;
  external_source_ids?: Record<string, string | null> | null;
  music_metadata?: MusicMetadata | null;
  decade: string | null;
  description_override: string | null;
  subjects_override: string[] | null;
  borrowable_override: boolean | null;
  borrow_request_scope_override: string | null;
  location: string | null;
  shelf: string | null;
  notes: string | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: {
    id: number;
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
  book_tags?: Array<{ tag: { id: number; name: string; kind: "tag" | "category" } | null }>;
  book_entities?: Array<{ role: string; position: number | null; entity: { id: string; name: string; slug: string } | null }> | null;
};

function parseBookId(idSlug: string): number | null {
  const m = idSlug.match(/^(\d+)/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ username: string; idSlug: string }>;
}): Promise<Metadata> {
  const { idSlug } = await params;
  const bookId = parseBookId(idSlug);
  const supabase = getServerSupabase();
  if (!supabase || !bookId) return { title: "Item" };

  const bookRes = await supabase
    .from("user_books")
    .select("title_override,edition:editions(title)")
    .eq("id", bookId)
    .maybeSingle();

  const book = (bookRes.data ?? null) as { title_override?: string | null; edition?: { title?: string | null } | null } | null;
  const context = String(book?.title_override ?? "").trim() || String(book?.edition?.title ?? "").trim() || "Item";
  return { title: context };
}

export default async function PublicBookPage({ params }: { params: Promise<{ username: string; idSlug: string }> }) {
  const { username, idSlug } = await params;
  const usernameNorm = (username ?? "").trim().toLowerCase();
  const bookId = parseBookId(idSlug);
  const supabase = await getRequestSupabase();

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

  let followersCount: number | null = null;
  let followingCount: number | null = null;
  const authUserRes = await supabase.auth.getUser();
  const viewerId = String(authUserRes.data.user?.id ?? "").trim() || null;
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

  const bookRes = await supabase
    .from("user_books")
    .select(
      "*,edition:editions(id,isbn13,isbn10,title,authors,publisher,publish_date,description,subjects,cover_url),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,entity:entities(id,name,slug))"
    )
    .eq("id", bookId)
    .maybeSingle();

  if (bookRes.error) {
    return (
      <main className="container">
        <div className="card">
          <div>Error loading book.</div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            {bookRes.error.message}
          </div>
        </div>
      </main>
    );
  }

  const book = (bookRes.data ?? null) as unknown as PublicBookDetail | null;
  if (!book) {
    return (
      <main className="container">
        <div className="card">
          <div>
            <Link href={`/u/${profile.username}`}>@{profile.username}</Link>
          </div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            Book not found (or private).
          </div>
        </div>
      </main>
    );
  }

  let canViewInContext = String(book.owner_id ?? "") === String(profile.id ?? "");
  if (!canViewInContext) {
    const requiredIds = Array.from(new Set([String(profile.id ?? ""), String(viewerId ?? "")].filter(Boolean)));
    if (requiredIds.length > 0) {
      const membershipsRes = await supabase
        .from("catalog_members")
        .select("user_id,accepted_at")
        .eq("catalog_id", Number(book.library_id))
        .in("user_id", requiredIds)
        .not("accepted_at", "is", null);
      if (!membershipsRes.error) {
        const memberSet = new Set(
          ((membershipsRes.data ?? []) as any[])
            .map((r) => String(r.user_id ?? "").trim())
            .filter(Boolean)
        );
        const profileIsMember = memberSet.has(String(profile.id));
        const viewerAllowed = viewerId ? memberSet.has(String(viewerId)) : false;
        canViewInContext = profileIsMember && viewerAllowed;
      }
    }
  }

  if (!canViewInContext) {
    return (
      <main className="container">
        <div className="card">
          <div>
            <Link href={`/u/${profile.username}`}>@{profile.username}</Link>
          </div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            Book not found (or private).
          </div>
        </div>
      </main>
    );
  }

  const effectiveTitle = (book.title_override ?? "").trim() || book.edition?.title || "(untitled)";
  const isMusicObject = (book.object_type ?? "").trim() === "music";
  const music = parseMusicMetadata(book.music_metadata);
  const musicGenres = musicDisplayGenres(music);
  const canonical = bookIdSlug(book.id, effectiveTitle);
  if (idSlug !== canonical) {
    permanentRedirect(`/u/${profile.username}/b/${canonical}`);
  }

  const effectiveAuthors = isMusicObject
    ? ((music?.primary_artist ?? "").trim() ? [String(music?.primary_artist ?? "").trim()] : [])
    : (
    (book.authors_override ?? []).filter(Boolean).length > 0
      ? (book.authors_override ?? []).filter(Boolean)
      : (book.edition?.authors ?? []).filter(Boolean)
  ).map(String);

  const effectiveEditors = (book.editors_override ?? []).filter(Boolean).map(String);
  const effectiveDesigners = (book.designers_override ?? []).filter(Boolean).map(String);
  const effectivePrinter = (book.printer_override ?? "").trim();
  const effectiveMaterials = (book.materials_override ?? "").trim();
  const effectiveEdition = (book.edition_override ?? "").trim();

  const effectivePublishers = isMusicObject
    ? ((music?.label ?? "").trim() ? [String(music?.label ?? "").trim()] : [])
    : parseMultiValue((book.publisher_override ?? "").trim() || String(book.edition?.publisher ?? "").trim());
  const effectivePublisher = effectivePublishers[0] ?? "";
  const effectivePublishDate = isMusicObject ? (music?.release_date ?? "").trim() : (book.publish_date_override ?? "").trim() || book.edition?.publish_date || "";
  const displayPublishDate = formatDateShort(effectivePublishDate || null);
  const effectiveDescription = (book.description_override ?? "").trim() || book.edition?.description || "";
  const effectiveSubjects = (
    book.subjects_override !== null && book.subjects_override !== undefined
      ? ((book.subjects_override ?? []).filter(Boolean) as string[])
      : ((book.edition?.subjects ?? []).filter(Boolean) as string[])
  ).map(String);
  const subjects = effectiveSubjects.slice().sort((a, b) => a.localeCompare(b));
  const allTags = ((book.book_tags ?? []).map((bt) => bt?.tag).filter(Boolean) as Array<{ id: number; name: string; kind: "tag" | "category" }>);
  const categorySet = new Set<string>(
    allTags
      .filter((t) => t.kind === "category")
      .map((t) => String(t.name ?? "").trim())
      .filter(Boolean)
  );
  for (const row of book.book_entities ?? []) {
    if (String(row?.role ?? "").trim() !== "category") continue;
    const name = String(row?.entity?.name ?? "").trim();
    if (name) categorySet.add(name);
  }
  const categories = Array.from(categorySet.values());
  const tags = allTags.filter((t) => t.kind === "tag").map((t) => String(t.name ?? "").trim()).filter(Boolean);
  const contributorMap = Object.fromEntries(
    MUSIC_CONTRIBUTOR_ROLES.map((role) => [
      role,
      (book.book_entities ?? [])
        .filter((row) => String(row?.role ?? "").trim() === role)
        .map((row) => ({
          name: String(row?.entity?.name ?? "").trim(),
          slug: String(row?.entity?.slug ?? "").trim()
        }))
        .filter((row) => row.name && row.slug)
    ])
  ) as Record<(typeof MUSIC_CONTRIBUTOR_ROLES)[number], Array<{ name: string; slug: string }>>;

  const paths = Array.from(new Set([
    ...(book.media ?? []).map((m) => m.storage_path).filter(Boolean),
    ...(book.cover_crop && book.cover_original_url ? [book.cover_original_url] : [])
  ]));
  const signedMap: Record<string, string> = {};
  if (paths.length > 0) {
    const signedRes = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 30);
    for (const s of signedRes.data ?? []) {
      if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
    }
  }

  let avatarUrl: string | null = null;
  if (profile.avatar_path) {
    const signed = await supabase.storage.from("avatars").createSignedUrl(profile.avatar_path, 60 * 30);
    avatarUrl = signed.data?.signedUrl ?? null;
  }

  const coverMedia = (book.media ?? []).find((m) => m.kind === "cover") ?? null;
  const coverUrl: string | null = coverMedia ? (signedMap[coverMedia.storage_path] ?? null) : (book.edition?.cover_url ?? null);
  const cropData = book.cover_crop ?? null;
  const coverSrc: string | null = cropData && book.cover_original_url ? (signedMap[book.cover_original_url] ?? coverUrl) : coverUrl;
  const images = (book.media ?? []).filter((m) => m.kind === "image");
  const editionId = book.edition?.id ?? null;

  const borrowableDefault = Boolean((profile as any).borrowable_default);
  const rawScope = String((profile as any).borrow_request_scope ?? "").trim();
  const borrowScopeDefault = (rawScope === "anyone" ? "anyone" : rawScope === "following" ? "following" : "followers") as
    | "anyone"
    | "followers"
    | "following";
  const effectiveBorrowable = book.borrowable_override === null || book.borrowable_override === undefined ? borrowableDefault : Boolean(book.borrowable_override);
  const effectiveBorrowScope = borrowScopeDefault;
  const effectiveVisibility = book.visibility === "inherit" ? (profile.visibility === "public" ? "public" : "private") : (book.visibility === "public" ? "public" : "private");
  const effectiveStatus = String(book.status ?? "").trim();
  const locationText = String(book.location ?? "").trim();
  const shelfText = String(book.shelf ?? "").trim();
  const notesText = String(book.notes ?? "").trim();

  let catalogName = "Catalog";
  if (Number.isFinite(Number(book.library_id)) && Number(book.library_id) > 0) {
    const libRes = await supabase.from("libraries").select("name").eq("id", Number(book.library_id)).maybeSingle();
    const libName = String((libRes.data as any)?.name ?? "").trim();
    if (libName) catalogName = libName;
  }

  let copiesCount = 1;
  if (book.edition?.id) {
    const copiesRes = await supabase
      .from("user_books")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", profile.id)
      .eq("library_id", Number(book.library_id))
      .eq("edition_id", book.edition.id);
    if (!copiesRes.error && typeof copiesRes.count === "number" && copiesRes.count > 0) {
      copiesCount = copiesRes.count;
    }
  }
  const publicBookPath = `/u/${profile.username}/b/${canonical}`;

  return (
    <main className="container">
      <ScrollToTopOnMount />
      <AddToLibraryProvider editionIds={editionId ? [editionId] : []}>
        <PublicProfileHeader
          avatarUrl={avatarUrl}
          displayName={profile.display_name}
          username={profile.username}
          followerCount={followersCount}
          followingCount={followingCount}
          isLinked={true}
          followButton={<FollowControls profileId={profile.id} profileUsername={profile.username} inline />}
          bio={profile.bio}
        />

        <div style={{ marginTop: "var(--space-14)" }} className="card">
          <PublicBookDetailGrid coverSrc={coverSrc} cropData={cropData} effectiveTitle={effectiveTitle}>
            <div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-md)" }}>
                <div>{effectiveTitle}</div>
                <AddToLibraryButton
                  editionId={editionId}
                  titleFallback={effectiveTitle}
                  authorsFallback={effectiveAuthors}
                  sourceOwnerId={book.owner_id}
                  compact
                />
              </div>
              {isMusicObject ? (
                <>
                  {effectiveAuthors.length > 0 ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Primary artist</div>
                      <div><Link href={publicMusicFilterHref(profile.username, effectiveAuthors[0] ?? "", "author")}>{effectiveAuthors[0]}</Link></div>
                    </div>
                  ) : null}
                  {MUSIC_CONTRIBUTOR_ROLES.map((role) =>
                    contributorMap[role].length > 0 ? (
                      <div key={role} className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                        <div style={{ minWidth: 110 }} className="text-muted">{musicRoleLabel(role)}</div>
                        <div className="om-hanging-value">
                          {contributorMap[role].map((row, idx) => (
                            <span key={`${role}-${row.slug}`}>
                              <Link href={publicMusicFilterHref(profile.username, row.name)}>{row.name}</Link>
                              {idx < contributorMap[role].length - 1 ? <span>, </span> : null}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null
                  )}
                  {effectivePublisher ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Label</div>
                      <div><Link href={publicMusicFilterHref(profile.username, effectivePublisher, "publisher")}>{effectivePublisher}</Link></div>
                    </div>
                  ) : null}
                  {effectivePublishDate ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Release date</div>
                      <div><Link href={publicMusicFilterHref(profile.username, effectivePublishDate, "release_date")}>{displayPublishDate}</Link></div>
                    </div>
                  ) : null}
                  {(music?.original_release_year ?? "").trim() ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Orig. release year</div>
                      <div><Link href={publicMusicFilterHref(profile.username, music?.original_release_year ?? "", "original_release_year")}>{music?.original_release_year}</Link></div>
                    </div>
                  ) : null}
                  {[
                    ["Format", music?.format, "format"],
                    ["Release type", music?.release_type, "release_type"],
                    ["Pressing", music?.edition_pressing, "pressing"],
                    ["Catlog #", music?.catalog_number, "catalog_number"],
                    ["Barcode", music?.barcode, "barcode"],
                    ["Country", music?.country, "country"],
                    ["Discogs ID", music?.discogs_id, "discogs_id"],
                    ["MusicBrainz ID", music?.musicbrainz_id, "musicbrainz_id"],
                    ["Speed", music?.speed, "speed"],
                    ["Channels", music?.channels, "channels"],
                    ["Disc count", music?.disc_count != null ? String(music.disc_count) : null, "disc_count"],
                    ["Color / variant", music?.color_variant, "q"],
                    ["Limited edition", music?.limited_edition === null ? null : music?.limited_edition ? "yes" : "no", "limited_edition"],
                    ["Packaging type", music?.packaging_type, "q"]
                  ].map(([label, value, key]) =>
                    value ? (
                      <div key={label} className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                        <div style={{ minWidth: 110 }} className="text-muted">{label}</div>
                        <div><Link href={publicMusicFilterHref(profile.username, String(value), key as DetailFilterKey)}>{value}</Link></div>
                      </div>
                    ) : null
                  )}
                  {music?.reissue !== null ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Reissue</div>
                      <div>
                        <Link href={publicMusicFilterHref(profile.username, music?.reissue ? "reissue" : "original release", "reissue")}>
                          {music?.reissue ? "Yes (reissue)" : "No (original release)"}
                        </Link>
                      </div>
                    </div>
                  ) : null}
                  {musicGenres.length > 0 ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Genres</div>
                      <div className="om-hanging-value">
                        {musicGenres.map((value, idx, arr) => (
                          <span key={value}>
                            <Link href={publicMusicFilterHref(profile.username, value, "subject")}>{value}</Link>
                            {idx < arr.length - 1 ? <span>, </span> : null}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {(music?.tracklist ?? []).length > 0 ? (
                    <div className="row om-tracklist-row" style={{ marginTop: "var(--space-md)", alignItems: "flex-start" }}>
                      <div style={{ minWidth: 110 }} className="text-muted om-tracklist-label">Tracklist</div>
                      <div className="om-tracklist-value" style={{ display: "grid", gap: "var(--space-4)", flex: "1 1 auto", minWidth: 0 }}>
                        {(music?.tracklist ?? []).map((track, index) => (
                          <div key={`${track.position ?? ""}-${track.title}-${index}`} className="row om-row-baseline om-tracklist-line" style={{ gap: "var(--space-sm)" }}>
                            {track.position ? <div className="text-muted" style={{ minWidth: 32 }}>{track.position}</div> : null}
                            <div className="om-tracklist-line-title" style={{ flex: "1 1 auto", minWidth: 0 }}>
                              <Link href={publicMusicFilterHref(profile.username, track.title)} title={formatMusicTrackLine(track)}>{track.title}</Link>
                            </div>
                            {track.duration ? <div className="text-muted">{track.duration}</div> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {!isMusicObject && effectiveAuthors.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Authors
                  </div>
                  <div className="om-hanging-value">
                    {effectiveAuthors.map((a, idx) => (
                      <span key={a}>
                        <Link href={`/u/${profile.username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                        {idx < effectiveAuthors.length - 1 ? <span>, </span> : null}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {!isMusicObject && effectiveEditors.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Editors
                  </div>
                  <div>{effectiveEditors.join(", ")}</div>
                </div>
              ) : null}

              {!isMusicObject && effectiveDesigners.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Designers
                  </div>
                  <div className="om-hanging-value">
                    {effectiveDesigners.map((name, idx) => (
                      <span key={`designer-${name}`}>
                        <Link href={`/u/${profile.username}?designer=${encodeURIComponent(name)}`}>{name}</Link>
                        {idx < effectiveDesigners.length - 1 ? <span>, </span> : null}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {!isMusicObject && effectivePrinter ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Printer
                  </div>
                  <div>{effectivePrinter}</div>
                </div>
              ) : null}

              {!isMusicObject && effectiveMaterials ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Materials
                  </div>
                  <div>{effectiveMaterials}</div>
                </div>
              ) : null}

              {!isMusicObject && effectiveEdition ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Edition
                  </div>
                  <div>{effectiveEdition}</div>
                </div>
              ) : null}

              {!isMusicObject && effectivePublishers.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Publisher
                  </div>
                  <div>
                    {effectivePublishers.map((publisher, index) => (
                      <span key={publisher}>
                        <Link href={`/u/${profile.username}/p/${encodeURIComponent(publisher)}`}>{publisher}</Link>
                        {index < effectivePublishers.length - 1 ? <span>, </span> : null}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {!isMusicObject && effectivePublishDate ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Publish date
                  </div>
                  <div>{displayPublishDate}</div>
                </div>
              ) : null}

              {!isMusicObject && book.pages ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Pages
                  </div>
                  <div>{book.pages}</div>
                </div>
              ) : null}

              {(book.group_label ?? "").trim() ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Group
                  </div>
                  <div>{(book.group_label ?? "").trim()}</div>
                </div>
              ) : null}

              {(book.object_type ?? "").trim() ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Object type
                  </div>
                  <div>{(book.object_type ?? "").trim()}</div>
                </div>
              ) : null}

              {(book.decade ?? "").trim() ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Decade
                  </div>
                  <div>
                    <Link href={`/u/${profile.username}?decade=${encodeURIComponent((book.decade ?? "").trim())}`}>{(book.decade ?? "").trim()}</Link>
                  </div>
                </div>
              ) : null}

              {!isMusicObject && subjects.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-md)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Subjects
                  </div>
                  <div style={{ flex: "1 1 auto" }}>
                    <ExpandableSubjects subjects={subjects} username={profile.username} />
                  </div>
                </div>
              ) : null}

              {!isMusicObject && (book.edition?.isbn13 || book.edition?.isbn10) ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    ISBN
                  </div>
                  <div>{book.edition?.isbn13 ?? book.edition?.isbn10}</div>
                </div>
              ) : null}

              {effectiveDescription ? (
                <div style={{ marginTop: "var(--space-md)" }}>
                  <div className="text-muted">
                    Description
                  </div>
                  <div style={{ marginTop: "var(--space-sm)" }}>
                    <ExpandableDescription text={effectiveDescription} />
                  </div>
                </div>
              ) : null}

              <hr className="divider" />
              <div className="meta-list" style={{ gap: 0 }}>
                <div className="row om-row-baseline">
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Catalog
                  </div>
                  <div>{catalogName}</div>
                </div>

                <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Copies
                  </div>
                  <div>{copiesCount}</div>
                </div>

                {categories.length > 0 ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Categories
                    </div>
                    <div className="om-hanging-value">
                      {categories.map((name, idx) => (
                        <span key={`cat-${name}`}>
                          <Link href={`/u/${profile.username}?category=${encodeURIComponent(name)}`}>{name}</Link>
                          {idx < categories.length - 1 ? <span>, </span> : null}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {tags.length > 0 ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Tags
                    </div>
                    <div className="om-hanging-value">
                      {tags.map((name, idx) => (
                        <span key={`tag-${name}`}>
                          <Link href={`/u/${profile.username}?tag=${encodeURIComponent(name)}`}>{name}</Link>
                          {idx < tags.length - 1 ? <span>, </span> : null}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {notesText ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Notes
                    </div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{notesText}</div>
                  </div>
                ) : null}
              </div>

              <hr className="divider" />
              <div className="meta-list" style={{ gap: 0 }}>
                <div className="row om-row-baseline">
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Visibility
                  </div>
                  <div>{effectiveVisibility}</div>
                </div>

                {effectiveStatus ? (
                  <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                    <div style={{ minWidth: 110 }} className="text-muted">
                      Status
                    </div>
                    <div>{effectiveStatus}</div>
                  </div>
                ) : null}

                <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Borrowable
                  </div>
                  <div>{effectiveBorrowable ? "yes" : "no"}</div>
                </div>
              </div>

              {(locationText || shelfText) ? <hr className="divider" /> : null}
              {(locationText || shelfText) ? (
                <div className="meta-list" style={{ gap: 0 }}>
                  {locationText ? (
                    <div className="row om-row-baseline">
                      <div style={{ minWidth: 110 }} className="text-muted">
                        Location
                      </div>
                      <div>{locationText}</div>
                    </div>
                  ) : null}
                  {shelfText ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">
                        Shelf
                      </div>
                      <div>{shelfText}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <hr className="divider" />
              <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                <div style={{ minWidth: 110 }} className="text-muted">
                  URL
                </div>
                <div style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  <Link href={publicBookPath}>{publicBookPath}</Link>
                </div>
              </div>

              <div style={{ marginTop: "var(--space-md)" }}>
                <BorrowRequestWidget
                  userBookId={book.id}
                  ownerId={book.owner_id}
                  ownerUsername={profile.username}
                  bookTitle={effectiveTitle}
                  borrowable={effectiveBorrowable}
                  scope={effectiveBorrowScope}
                />
              </div>
            </div>
          </PublicBookDetailGrid>

          {images.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <hr className="om-hr" style={{ marginBottom: 16 }} />
              <div className="text-muted">
                Images
              </div>
              <PublicImageGrid images={images} signedMap={signedMap} />
            </div>
          ) : null}

          <div style={{ marginTop: 16 }}>
            {editionId ? <AlsoOwnedBy editionId={editionId} excludeUserBookId={book.id} excludeOwnerId={book.owner_id} /> : null}
          </div>

          <div style={{ marginTop: 16 }}>
            <PublicRelatedItemsSection
              profileId={profile.id}
              profileUsername={profile.username}
              profileVisibility={profile.visibility ?? null}
              book={book}
            />
          </div>
        </div>
      </AddToLibraryProvider>
    </main>
  );
}
