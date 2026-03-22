import Link from "next/link";
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { createServerClient } from "@supabase/ssr";
import { getServerSupabase } from "../../../../../lib/supabaseServer";
import { getPublicEnvOptional } from "../../../../../lib/env";
import { bookIdSlug, slugify } from "../../../../../lib/slug";
import { formatDateShort } from "../../../../../lib/formatDate";
import { formatMusicTrackLine, musicDisplayGenres, MUSIC_CONTRIBUTOR_ROLES, parseMusicMetadata, type MusicMetadata } from "../../../../../lib/music";
import { displayObjectTypeLabel, isMagazineObject } from "../../../../../lib/magazine";
import { detailFilterHref, type DetailFilterKey } from "../../../../../lib/detailFilters";
import { getSupabaseAdmin } from "../../../../../lib/supabaseAdmin";
import AddToLibraryButton from "../../AddToLibraryButton";
import AddToLibraryProvider from "../../AddToLibraryProvider";
import BorrowRequestWidget from "../../BorrowRequestWidget";
import ScrollToTopOnMount from "../../../../components/ScrollToTopOnMount";
import { ExpandableSubjects, ExpandableDescription } from "./PublicExpandables";
import FollowControls from "../../FollowControls";
import PublicProfileHeader from "../../../../components/PublicProfileHeader";
import { type CoverCrop } from "../../../../../components/CoverImage";
import PublicBookDetailGrid from "./PublicBookDetailGrid";
import AlsoOwnedBy from "../../AlsoOwnedBy";
import PublicRelatedItemsSection from "./PublicRelatedItemsSection";
import PublicBookAccessFallback from "./PublicBookAccessFallback";
import PublicSignInGate from "../../../../components/PublicSignInGate";

export const dynamic = "force-dynamic";

function isStoragePath(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return !/^https?:\/\//i.test(v) && !/^data:/i.test(v);
}

function normalizeStoragePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutLeadingSlash = trimmed.replace(/^\/+/, "");
  return isStoragePath(withoutLeadingSlash) ? withoutLeadingSlash : null;
}

function withoutStoragePathPrefix(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const marker = "user-book-media/";
  if (trimmed.startsWith("public/") && trimmed.includes(marker)) {
    const idx = trimmed.indexOf(marker);
    return normalizeStoragePath(trimmed.slice(idx + marker.length));
  }
  if (trimmed.includes(`/${marker}`)) {
    const idx = trimmed.indexOf(`/${marker}`);
    return normalizeStoragePath(trimmed.slice(idx + `/${marker}`.length));
  }
  if (trimmed.includes(marker)) {
    const idx = trimmed.indexOf(marker);
    return normalizeStoragePath(trimmed.slice(idx + marker.length));
  }
  try {
    const url = new URL(trimmed);
    const { pathname } = url;
    if (pathname.includes(marker)) {
      const idx = pathname.indexOf(marker);
      return normalizeStoragePath(pathname.slice(idx + marker.length));
    }
  } catch {
    // ignore URL parse failures
  }
  return null;
}

function toStoragePathCandidate(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const normalizedInput = trimmed.startsWith("/") ? trimmed.replace(/^\/+/, "") : trimmed;
  const bucketPath = withoutStoragePathPrefix(normalizedInput);
  if (bucketPath) return bucketPath;
  if (isStoragePath(normalizedInput)) return normalizeStoragePath(normalizedInput);
  return null;
}

function toResolvedExternalImageUrl(url: string | null | undefined): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return raw;
  if (/^https:\/\//i.test(raw)) return raw;
  return `/api/image-proxy?url=${encodeURIComponent(raw)}`;
}

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

type MemberPreview = { userId: string; username: string; avatarUrl: string | null };

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
  issue_number?: string | null;
  issue_volume?: string | null;
  issue_season?: string | null;
  issue_year?: number | null;
  issn?: string | null;
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

  // Round trip 1: alias check + profile + book + viewer auth — all independent, run in parallel.
  // If aliasRes triggers a redirect the other results are discarded; in the common case we save
  // the extra sequential round trip that the old aliasRes → profileRes → bookRes waterfall imposed.
  // The book fetch uses the admin client to bypass RLS — visibility is enforced by canViewInContext below.
  const adminClient = getSupabaseAdmin();
  const signingClient = adminClient ?? supabase;
  const bookClient = adminClient ?? supabase;
  const [aliasRes, profileRes, authUserRes, bookRes] = await Promise.all([
    supabase.from("username_aliases").select("current_username").eq("old_username", usernameNorm).maybeSingle(),
    supabase
      .from("profiles")
      .select("id,username,display_name,bio,visibility,avatar_path,borrowable_default,borrow_request_scope")
      .eq("username", usernameNorm)
      .maybeSingle(),
    supabase.auth.getUser(),
    bookClient
      .from("user_books")
      .select(
        "*,edition:editions(id,isbn13,isbn10,title,authors,publisher,publish_date,description,subjects,cover_url),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,entity:entities(id,name,slug))"
      )
      .eq("id", bookId)
      .maybeSingle()
  ]);

  const alias = (aliasRes.data as any)?.current_username as string | undefined;
  if (alias && alias !== usernameNorm) {
    permanentRedirect(`/u/${alias}/b/${idSlug}`);
  }

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

  const viewerId = String(authUserRes.data.user?.id ?? "").trim() || null;
  const canViewInContextFast = String(book.owner_id ?? "") === String(profile.id ?? "");
  const membershipRequiredIds = !canViewInContextFast
    ? Array.from(new Set([String(profile.id ?? ""), String(viewerId ?? "")].filter(Boolean)))
    : [];

  const rawMediaRefs = Array.from(
    new Set([
      ...(book.media ?? []).map((m) => String(m.storage_path ?? "").trim()).filter(Boolean),
      ...(book.cover_original_url ? [String(book.cover_original_url).trim()] : []),
    ])
  );
  const rawToStorage = new Map<string, string>();
  const admin = getSupabaseAdmin();
  const storagePaths = Array.from(
    new Set(
      rawMediaRefs
        .map((raw) => {
          const storagePath = toStoragePathCandidate(raw);
          if (storagePath) rawToStorage.set(raw, storagePath);
          return storagePath;
        })
        .filter(Boolean) as string[]
    )
  );

  // Round trip 2: all post-book queries in parallel — avatar signing, follow counts,
  // catalog membership check (if needed), media signing, library name, copies count.
  const [
    avatarSignedRes,
    followCountsRes,
    membershipsRes,
    signedRes,
    libRes,
    copiesRes,
  ] = await Promise.all([
    profile.avatar_path
      ? signingClient.storage.from("avatars").createSignedUrl(profile.avatar_path, 60 * 30)
      : Promise.resolve(null),
    supabase.rpc("get_follow_counts", { target_username: profile.username }),
    membershipRequiredIds.length > 0
      ? supabase
          .from("catalog_members")
          .select("user_id,accepted_at")
          .eq("catalog_id", Number(book.library_id))
          .in("user_id", membershipRequiredIds)
          .not("accepted_at", "is", null)
      : Promise.resolve(null),
    storagePaths.length > 0
      ? signingClient.storage.from("user-book-media").createSignedUrls(storagePaths, 60 * 30)
      : Promise.resolve(null),
    admin && Number.isFinite(Number(book.library_id)) && Number(book.library_id) > 0
      ? admin.from("libraries").select("name").eq("id", Number(book.library_id)).maybeSingle()
      : Promise.resolve(null),
    book.edition?.id
      ? supabase
          .from("user_books")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", profile.id)
          .eq("library_id", Number(book.library_id))
          .eq("edition_id", book.edition.id)
      : Promise.resolve(null),
  ]);

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

  let canViewInContext = canViewInContextFast;
  if (!canViewInContext && membershipsRes && !membershipsRes.error) {
    const memberSet = new Set(
      ((membershipsRes.data ?? []) as any[])
        .map((r) => String(r.user_id ?? "").trim())
        .filter(Boolean)
    );
    const profileIsMember = memberSet.has(String(profile.id));
    const viewerAllowed = viewerId ? memberSet.has(String(viewerId)) : false;
    canViewInContext = profileIsMember && viewerAllowed;
  }

  if (!canViewInContext) {
    return <PublicBookAccessFallback username={profile.username} bookId={book.id} />;
  }

  const effectiveTitle = (book.title_override ?? "").trim() || book.edition?.title || "(untitled)";
  const isMusicObject = (book.object_type ?? "").trim() === "music";
  const isPeriodical = isMagazineObject(book.object_type);
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

  // Build role+name → entity slug lookup for secondary entity page links
  const entitySlugByRoleAndName = new Map<string, string>();
  for (const row of book.book_entities ?? []) {
    const role = String(row?.role ?? "").trim();
    const name = String(row?.entity?.name ?? "").trim();
    const slug = String(row?.entity?.slug ?? "").trim();
    if (role && name && slug) {
      entitySlugByRoleAndName.set(`${role}\0${name.toLowerCase()}`, slug);
    }
  }
  function entitySlugFor(roles: string[], name: string): string | null {
    for (const role of roles) {
      const s = entitySlugByRoleAndName.get(`${role}\0${name.toLowerCase()}`);
      if (s) return s;
    }
    return null;
  }

  const signedMap: Record<string, string> = {};
  for (const s of signedRes?.data ?? []) {
    if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
  }
  for (const raw of rawMediaRefs) {
    const storagePath = rawToStorage.get(raw);
    if (storagePath && signedMap[storagePath]) {
      signedMap[raw] = signedMap[storagePath];
      continue;
    }
    const externalUrl = toResolvedExternalImageUrl(raw);
    if (externalUrl) signedMap[raw] = externalUrl;
  }

  const avatarUrl = avatarSignedRes?.data?.signedUrl ?? null;

  const coverMedia = (book.media ?? []).find((m) => m.kind === "cover") ?? null;
  const resolvedCoverOriginalUrl = signedMap[String(book.cover_original_url ?? "").trim()] ?? null;
  const coverUrl: string | null =
    (coverMedia ? (signedMap[coverMedia.storage_path] ?? null) : null)
    ?? resolvedCoverOriginalUrl
    ?? book.edition?.cover_url
    ?? null;
  const cropData = book.cover_crop ?? null;
  const coverSrc: string | null = cropData && book.cover_original_url ? (resolvedCoverOriginalUrl ?? coverUrl) : coverUrl;
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
  const libName = String((libRes as any)?.data?.name ?? "").trim();
  if (libName) catalogName = libName;

  let memberPreviews: MemberPreview[] = [];
  if (admin && Number.isFinite(Number(book.library_id)) && Number(book.library_id) > 0) {
    const membersRes = await admin
      .from("catalog_members")
      .select("user_id,accepted_at")
      .eq("catalog_id", Number(book.library_id))
      .not("accepted_at", "is", null);
    if (!membersRes.error) {
      const memberRows = ((membersRes.data ?? []) as any[])
        .map((row) => ({
          userId: String(row.user_id ?? "").trim(),
          acceptedAt: String(row.accepted_at ?? "").trim(),
        }))
        .filter((row) => row.userId && row.userId !== String(profile.id ?? ""));
      const memberIds = Array.from(new Set(memberRows.map((row) => row.userId)));
      if (memberIds.length > 0) {
        const profilesRes = await admin.from("profiles").select("id,username,avatar_path").in("id", memberIds);
        if (!profilesRes.error) {
          const profilesById = new Map(
            ((profilesRes.data ?? []) as any[])
              .filter((row) => row?.id && row?.username)
              .map((row) => [String(row.id), { username: String(row.username), avatarPath: row.avatar_path ? String(row.avatar_path) : null }])
          );
          const avatarPaths = Array.from(
            new Set(
              Array.from(profilesById.values())
                .map((row) => String(row.avatarPath ?? "").trim())
                .filter(Boolean)
            )
          );
          const avatarByPath = new Map<string, string>();
          for (const avatarPath of avatarPaths.filter((value) => /^https?:\/\//i.test(value))) {
            avatarByPath.set(avatarPath, avatarPath);
          }
          const storageAvatarPaths = avatarPaths.filter((value) => !/^https?:\/\//i.test(value));
          if (storageAvatarPaths.length > 0) {
            const signedAvatarRes = await admin.storage.from("avatars").createSignedUrls(storageAvatarPaths, 60 * 30);
            if (!signedAvatarRes.error && Array.isArray(signedAvatarRes.data)) {
              for (const row of signedAvatarRes.data) {
                if (row.path && row.signedUrl) avatarByPath.set(row.path, row.signedUrl);
              }
            }
            for (const avatarPath of storageAvatarPaths) {
              if (avatarByPath.has(avatarPath)) continue;
              const publicAvatar = admin.storage.from("avatars").getPublicUrl(avatarPath);
              const fallback = String(publicAvatar.data?.publicUrl ?? "").trim();
              if (fallback) avatarByPath.set(avatarPath, fallback);
            }
          }
          memberPreviews = memberRows
            .map((row) => {
              const profileRow = profilesById.get(row.userId);
              if (!profileRow) return null;
              return {
                userId: row.userId,
                username: profileRow.username,
                avatarUrl: profileRow.avatarPath ? avatarByPath.get(profileRow.avatarPath) ?? null : null,
                acceptedAt: row.acceptedAt,
              };
            })
            .filter(Boolean)
            .sort((a, b) => Date.parse((a as any).acceptedAt) - Date.parse((b as any).acceptedAt))
            .slice(0, 10)
            .map((row: any) => ({ userId: row.userId, username: row.username, avatarUrl: row.avatarUrl }));
        }
      }
    }
  }

  let copiesCount = 1;
  if (copiesRes && !(copiesRes as any).error && typeof (copiesRes as any).count === "number" && (copiesRes as any).count > 0) {
    copiesCount = (copiesRes as any).count;
  }
  const publicBookPath = `/u/${profile.username}/b/${canonical}`;

  return (
    <PublicSignInGate>
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

        <hr className="divider" />

        <div className="card">
          <PublicBookDetailGrid coverSrc={coverSrc} cropData={cropData} effectiveTitle={effectiveTitle} images={images} signedMap={signedMap}>
            <div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-md)" }}>
                <div>{effectiveTitle}</div>
                <AddToLibraryButton
                  editionId={editionId}
                  titleFallback={effectiveTitle}
                  authorsFallback={effectiveAuthors}
                  publisherFallback={effectivePublisher}
                  publishDateFallback={effectivePublishDate}
                  sourceOwnerId={book.owner_id}
                  compact
                />
              </div>
              {isMusicObject ? (
                <>
                  {effectiveAuthors.length > 0 ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Primary artist</div>
                      <div>
                        <Link href={publicMusicFilterHref(profile.username, effectiveAuthors[0] ?? "", "author")}>
                          {effectiveAuthors[0]}
                        </Link>
                        {entitySlugFor(["author", "performer"], effectiveAuthors[0] ?? "") ? (
                          <> <Link href={`/entity/${entitySlugFor(["author", "performer"], effectiveAuthors[0] ?? "")}`} className="text-muted" style={{ textDecoration: "none" }}>↗</Link></>
                        ) : null}
                      </div>
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
                              {row.slug ? <> <Link href={`/entity/${row.slug}`} className="text-muted" style={{ textDecoration: "none" }}>↗</Link></> : null}
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
              ) : isPeriodical ? (
                <>
                  {effectiveEditors.length > 0 ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Editors</div>
                      <div>
                        {effectiveEditors.map((name, idx) => {
                          const entitySlug = entitySlugFor(["editor"], name);
                          return (
                            <span key={`editor-${name}`}>
                              {name}
                              {entitySlug ? <> <Link href={`/entity/${entitySlug}`} className="text-muted" style={{ textDecoration: "none" }}>↗</Link></> : null}
                              {idx < effectiveEditors.length - 1 ? <span>, </span> : null}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {effectiveAuthors.length > 0 ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Contributors</div>
                      <div className="om-hanging-value">
                        {effectiveAuthors.map((a, idx) => {
                          const entitySlug = entitySlugFor(["author"], a);
                          return (
                            <span key={a}>
                              <Link href={`/u/${profile.username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                              {entitySlug ? <> <Link href={`/entity/${entitySlug}`} className="text-muted" style={{ textDecoration: "none" }}>↗</Link></> : null}
                              {idx < effectiveAuthors.length - 1 ? <span>, </span> : null}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {effectiveDesigners.length > 0 ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Designers</div>
                      <div className="om-hanging-value">
                        {effectiveDesigners.map((name, idx) => {
                          const entitySlug = entitySlugFor(["designer", "design", "art direction"], name);
                          return (
                            <span key={`designer-${name}`}>
                              <Link href={`/u/${profile.username}?designer=${encodeURIComponent(name)}`}>{name}</Link>
                              {entitySlug ? <> <Link href={`/entity/${entitySlug}`} className="text-muted" style={{ textDecoration: "none" }}>↗</Link></> : null}
                              {idx < effectiveDesigners.length - 1 ? <span>, </span> : null}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {effectivePublishers.length > 0 ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Publisher</div>
                      <div>
                        {effectivePublishers.map((publisher, index) => {
                          const entitySlug = entitySlugFor(["publisher"], publisher);
                          return (
                            <span key={publisher}>
                              <Link href={`/u/${profile.username}/p/${encodeURIComponent(publisher)}`}>{publisher}</Link>
                              {entitySlug ? <> <Link href={`/entity/${entitySlug}`} className="text-muted" style={{ textDecoration: "none" }}>↗</Link></> : null}
                              {index < effectivePublishers.length - 1 ? <span>, </span> : null}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {effectivePublishDate ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Publish date</div>
                      <div>{displayPublishDate}</div>
                    </div>
                  ) : null}
                  {effectivePrinter ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Printer</div>
                      <div>{effectivePrinter}</div>
                    </div>
                  ) : null}
                  {effectiveMaterials ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Materials</div>
                      <div>{effectiveMaterials}</div>
                    </div>
                  ) : null}
                  {[
                    ["Issue volume", book.issue_volume],
                    ["Issue number", book.issue_number],
                    ["Issue season", book.issue_season ? formatDateShort(String(book.issue_season)) : null],
                    ["ISSN", book.issn],
                    ["ISBN", book.edition?.isbn13 ?? book.edition?.isbn10 ?? null]
                  ].map(([label, value]) =>
                    String(value ?? "").trim() ? (
                      <div key={String(label)} className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                        <div style={{ minWidth: 110 }} className="text-muted">{label}</div>
                        <div>{String(value)}</div>
                      </div>
                    ) : null
                  )}
                  {subjects.length > 0 ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-md)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Subjects</div>
                      <div style={{ flex: "1 1 auto" }}>
                        <ExpandableSubjects subjects={subjects} username={profile.username} />
                      </div>
                    </div>
                  ) : null}
                  {book.pages ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Pages</div>
                      <div>{book.pages}</div>
                    </div>
                  ) : null}
                  {(book as any)?.trim_width && (book as any)?.trim_height ? (
                    <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                      <div style={{ minWidth: 110 }} className="text-muted">Trim size</div>
                      <div>{`${(book as any).trim_width} × ${(book as any).trim_height} ${(book as any).trim_unit ?? "in"}`}</div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {!isMusicObject && !isPeriodical && effectiveAuthors.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-8)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Authors
                  </div>
                  <div className="om-hanging-value">
                    {effectiveAuthors.map((a, idx) => {
                      const entitySlug = entitySlugFor(["author"], a);
                      return (
                        <span key={a}>
                          <Link href={`/u/${profile.username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                          {entitySlug ? <> <Link href={`/entity/${entitySlug}`} className="text-muted" style={{ textDecoration: "none" }}>↗</Link></> : null}
                          {idx < effectiveAuthors.length - 1 ? <span>, </span> : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {!isMusicObject && !isPeriodical && effectiveEditors.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Editors
                  </div>
                  <div>
                    {effectiveEditors.map((name, idx) => {
                      const entitySlug = entitySlugFor(["editor"], name);
                      return (
                        <span key={`editor-${name}`}>
                          {name}
                          {entitySlug ? <> <Link href={`/entity/${entitySlug}`} className="text-muted" style={{ textDecoration: "none" }}>↗</Link></> : null}
                          {idx < effectiveEditors.length - 1 ? <span>, </span> : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {!isMusicObject && !isPeriodical && effectiveDesigners.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Designers
                  </div>
                  <div className="om-hanging-value">
                    {effectiveDesigners.map((name, idx) => {
                      const entitySlug = entitySlugFor(["designer", "design", "art direction"], name);
                      return (
                        <span key={`designer-${name}`}>
                          <Link href={`/u/${profile.username}?designer=${encodeURIComponent(name)}`}>{name}</Link>
                          {entitySlug ? <> <Link href={`/entity/${entitySlug}`} className="text-muted" style={{ textDecoration: "none" }}>↗</Link></> : null}
                          {idx < effectiveDesigners.length - 1 ? <span>, </span> : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {!isMusicObject && !isPeriodical && effectivePrinter ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Printer
                  </div>
                  <div>{effectivePrinter}</div>
                </div>
              ) : null}

              {!isMusicObject && !isPeriodical && effectiveMaterials ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Materials
                  </div>
                  <div>{effectiveMaterials}</div>
                </div>
              ) : null}

              {!isMusicObject && !isPeriodical && effectiveEdition ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Edition
                  </div>
                  <div>{effectiveEdition}</div>
                </div>
              ) : null}

              {!isMusicObject && !isPeriodical && effectivePublishers.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Publisher
                  </div>
                  <div>
                    {effectivePublishers.map((publisher, index) => {
                      const entitySlug = entitySlugFor(["publisher"], publisher);
                      return (
                        <span key={publisher}>
                          <Link href={`/u/${profile.username}/p/${encodeURIComponent(publisher)}`}>{publisher}</Link>
                          {entitySlug ? <> <Link href={`/entity/${entitySlug}`} className="text-muted" style={{ textDecoration: "none" }}>↗</Link></> : null}
                          {index < effectivePublishers.length - 1 ? <span>, </span> : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {!isMusicObject && !isPeriodical && effectivePublishDate ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Publish date
                  </div>
                  <div>{displayPublishDate}</div>
                </div>
              ) : null}

              {!isMusicObject && !isPeriodical && book.pages ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Pages
                  </div>
                  <div>{book.pages}</div>
                </div>
              ) : null}

              {!isMusicObject && !isPeriodical && (book as any)?.trim_width && (book as any)?.trim_height ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">Trim size</div>
                  <div>{`${(book as any).trim_width} × ${(book as any).trim_height} ${(book as any).trim_unit ?? "in"}`}</div>
                </div>
              ) : null}

              {(book.group_label ?? "").trim() ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Group
                  </div>
                  <div><a href={`/group/${slugify((book.group_label ?? "").trim())}`} style={{ textDecoration: "none" }}>{(book.group_label ?? "").trim()} ↗</a></div>
                </div>
              ) : null}

              {(book.object_type ?? "").trim() ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Object type
                  </div>
                  <div>{displayObjectTypeLabel(book.object_type ?? "")}</div>
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

              {!isMusicObject && !isPeriodical && subjects.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: "var(--space-md)" }}>
                  <div style={{ minWidth: 110 }} className="text-muted">
                    Subjects
                  </div>
                  <div style={{ flex: "1 1 auto" }}>
                    <ExpandableSubjects subjects={subjects} username={profile.username} />
                  </div>
                </div>
              ) : null}

              {!isMusicObject && !isPeriodical && (book.edition?.isbn13 || book.edition?.isbn10) ? (
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
                  <div className="row" style={{ alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
                    <span>{catalogName}</span>
                    {memberPreviews.length > 0 ? (
                      <span className="om-member-stack" aria-label="Shared catalog members">
                        {memberPreviews.slice(0, 6).map((m) => (
                          <Link key={m.userId} href={`/u/${m.username}`} aria-label={`Open ${m.username}'s profile`} title={m.username}>
                            {m.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img alt={m.username} src={m.avatarUrl} className="om-member-stack-avatar om-member-stack-avatar-detail-up" />
                            ) : (
                              <span className="om-member-stack-avatar om-member-stack-avatar-detail-up" />
                            )}
                          </Link>
                        ))}
                        {memberPreviews.length > 6 ? (
                          <span className="om-member-stack-overflow" title={`${memberPreviews.length - 6} more members`}>
                            +{memberPreviews.length - 6}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
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

          <div style={{ marginTop: 16 }}>
            {editionId ? <AlsoOwnedBy editionId={editionId} excludeUserBookId={book.id} excludeOwnerId={book.owner_id} /> : null}
          </div>

          <Suspense fallback={null}>
            <div style={{ marginTop: 16 }}>
              <PublicRelatedItemsSection
                profileId={profile.id}
                profileUsername={profile.username}
                profileVisibility={profile.visibility ?? null}
                book={book}
              />
            </div>
          </Suspense>
        </div>
        </AddToLibraryProvider>
      </main>
    </PublicSignInGate>
  );
}
