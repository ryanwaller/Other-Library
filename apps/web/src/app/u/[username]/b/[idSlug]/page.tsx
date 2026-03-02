import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../../../lib/supabaseServer";
import { bookIdSlug } from "../../../../../lib/slug";
import { formatDateShort } from "../../../../../lib/formatDate";
import AddToLibraryButton from "../../AddToLibraryButton";
import AddToLibraryProvider from "../../AddToLibraryProvider";
import BorrowRequestWidget from "../../BorrowRequestWidget";
import ScrollToTopOnMount from "../../../../components/ScrollToTopOnMount";
import ExpandableContent from "../../../../../components/ExpandableContent";
import FollowControls from "../../FollowControls";
import CoverImage, { type CoverCrop } from "../../../../../components/CoverImage";
import PublicImageGrid from "./PublicImageGrid";
import AlsoOwnedBy from "../../AlsoOwnedBy";

export const dynamic = "force-dynamic";

type PublicBookDetail = {
  id: number;
  owner_id: string;
  visibility: "inherit" | "followers_only" | "public";
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
  decade: string | null;
  description_override: string | null;
  subjects_override: string[] | null;
  borrowable_override: boolean | null;
  borrow_request_scope_override: string | null;
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
};

function parseBookId(idSlug: string): number | null {
  const m = idSlug.match(/^(\d+)/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default async function PublicBookPage({ params }: { params: Promise<{ username: string; idSlug: string }> }) {
  const { username, idSlug } = await params;
  const usernameNorm = (username ?? "").trim().toLowerCase();
  const bookId = parseBookId(idSlug);
  const supabase = getServerSupabase();

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
          <div className="muted" style={{ marginTop: 8 }}>
            Not found (or private).
          </div>
        </div>
      </main>
    );
  }

  const [followersCountRes, followingCountRes] = await Promise.all([
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", profile.id).eq("status", "approved"),
    supabase.from("follows").select("followee_id", { count: "exact", head: true }).eq("follower_id", profile.id).eq("status", "approved")
  ]);
  const followersCount = followersCountRes.count;
  const followingCount = followingCountRes.count;

  const bookRes = await supabase
    .from("user_books")
    .select(
      "*,edition:editions(id,isbn13,isbn10,title,authors,publisher,publish_date,description,subjects,cover_url),media:user_book_media(id,kind,storage_path,caption,created_at)"
    )
    .eq("id", bookId)
    .eq("owner_id", profile.id)
    .maybeSingle();

  if (bookRes.error) {
    return (
      <main className="container">
        <div className="card">
          <div>Error loading book.</div>
          <div className="muted" style={{ marginTop: 8 }}>
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
          <div className="muted" style={{ marginTop: 8 }}>
            Book not found (or private).
          </div>
        </div>
      </main>
    );
  }

  const effectiveTitle = (book.title_override ?? "").trim() || book.edition?.title || "(untitled)";
  const canonical = bookIdSlug(book.id, effectiveTitle);
  if (idSlug !== canonical) {
    permanentRedirect(`/u/${profile.username}/b/${canonical}`);
  }

  const effectiveAuthors = (
    (book.authors_override ?? []).filter(Boolean).length > 0
      ? (book.authors_override ?? []).filter(Boolean)
      : (book.edition?.authors ?? []).filter(Boolean)
  ).map(String);

  const effectiveEditors = (book.editors_override ?? []).filter(Boolean).map(String);
  const effectiveDesigners = (book.designers_override ?? []).filter(Boolean).map(String);
  const effectivePrinter = (book.printer_override ?? "").trim();
  const effectiveMaterials = (book.materials_override ?? "").trim();
  const effectiveEdition = (book.edition_override ?? "").trim();

  const effectivePublisher = (book.publisher_override ?? "").trim() || book.edition?.publisher || "";
  const effectivePublishDate = (book.publish_date_override ?? "").trim() || book.edition?.publish_date || "";
  const displayPublishDate = formatDateShort(effectivePublishDate || null);
  const effectiveDescription = (book.description_override ?? "").trim() || book.edition?.description || "";
  const effectiveSubjects = (
    book.subjects_override !== null && book.subjects_override !== undefined
      ? ((book.subjects_override ?? []).filter(Boolean) as string[])
      : ((book.edition?.subjects ?? []).filter(Boolean) as string[])
  ).map(String);
  const subjects = effectiveSubjects.slice().sort((a, b) => a.localeCompare(b));

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

  return (
    <main className="container">
      <ScrollToTopOnMount />
      <AddToLibraryProvider editionIds={editionId ? [editionId] : []}>
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="om-avatar-lockup">
                {avatarUrl ? (
                  <Link href={`/u/${profile.username}`} className="om-avatar-link" aria-label="Open profile">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src={avatarUrl} className="om-avatar-img om-avatar-img-public" />
                  </Link>
                ) : null}
                <Link href={`/u/${profile.username}`}>{profile.username}</Link>
              </div>
            </div>
            <div className="muted">public</div>
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

        <div style={{ marginTop: 14 }} className="card">
          <div className="om-book-detail-grid">
            <div>
              <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
                <CoverImage alt={effectiveTitle} src={coverSrc} cropData={cropData} style={{ width: "100%", height: "auto", display: "block" }} objectFit="contain" />
              </div>
            </div>

            <div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <div>{effectiveTitle}</div>
                <AddToLibraryButton
                  editionId={editionId}
                  titleFallback={effectiveTitle}
                  authorsFallback={effectiveAuthors}
                  sourceOwnerId={book.owner_id}
                  compact
                />
              </div>
              {effectiveAuthors.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: 8 }}>
                  <div style={{ minWidth: 110 }} className="muted">
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

              {effectiveEditors.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Editors
                  </div>
                  <div>{effectiveEditors.join(", ")}</div>
                </div>
              ) : null}

              {effectiveDesigners.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Designers
                  </div>
                  <div>{effectiveDesigners.join(", ")}</div>
                </div>
              ) : null}

              {effectivePrinter ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Printer
                  </div>
                  <div>{effectivePrinter}</div>
                </div>
              ) : null}

              {effectiveMaterials ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Materials
                  </div>
                  <div>{effectiveMaterials}</div>
                </div>
              ) : null}

              {effectiveEdition ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Edition
                  </div>
                  <div>{effectiveEdition}</div>
                </div>
              ) : null}

              {effectivePublisher ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Publisher
                  </div>
                  <div>
                    <Link href={`/u/${profile.username}/p/${encodeURIComponent(effectivePublisher)}`}>{effectivePublisher}</Link>
                  </div>
                </div>
              ) : null}

              {effectivePublishDate ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Publish date
                  </div>
                  <div>{displayPublishDate}</div>
                </div>
              ) : null}

              {book.pages ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Pages
                  </div>
                  <div>{book.pages}</div>
                </div>
              ) : null}

              {(book.group_label ?? "").trim() ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Group
                  </div>
                  <div>{(book.group_label ?? "").trim()}</div>
                </div>
              ) : null}

              {(book.object_type ?? "").trim() ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Object type
                  </div>
                  <div>{(book.object_type ?? "").trim()}</div>
                </div>
              ) : null}

              {(book.decade ?? "").trim() ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Decade
                  </div>
                  <div>{(book.decade ?? "").trim()}</div>
                </div>
              ) : null}

              {subjects.length > 0 ? (
                <div className="row om-row-baseline" style={{ marginTop: 12 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Subjects
                  </div>
                  <div style={{ flex: "1 1 auto" }}>
                    <ExpandableContent
                      items={subjects}
                      limit={15}
                      renderVisible={(visible, isExpanded) => (
                        <div>
                          {visible.map((s, idx) => (
                            <span key={s}>
                              <Link href={`/u/${profile.username}/s/${encodeURIComponent(s)}`}>{s}</Link>
                              {idx < visible.length - 1 ? <span>, </span> : null}
                            </span>
                          ))}
                          {!isExpanded && subjects.length > 15 ? " …" : ""}
                        </div>
                      )}
                    />
                  </div>
                </div>
              ) : null}

              {book.edition?.isbn13 || book.edition?.isbn10 ? (
                <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    ISBN
                  </div>
                  <div>{book.edition?.isbn13 ?? book.edition?.isbn10}</div>
                </div>
              ) : null}

              {effectiveDescription ? (
                <div style={{ marginTop: 12 }}>
                  <div className="muted">
                    Description
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <ExpandableContent
                      items={effectiveDescription.trim().split(/\s+/)}
                      limit={100}
                      renderVisible={(visible, isExpanded) => (
                        <div style={{ whiteSpace: "pre-wrap" }}>
                          {isExpanded ? effectiveDescription : visible.join(" ") + (effectiveDescription.trim().split(/\s+/).length > 100 ? "…" : "")}
                        </div>
                      )}
                    />
                  </div>
                </div>
              ) : null}

              <div style={{ marginTop: 12 }}>
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
          </div>

          {images.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <hr className="om-hr" style={{ marginBottom: 16 }} />
              <div className="muted">
                Images
              </div>
              <PublicImageGrid images={images} signedMap={signedMap} />
            </div>
          ) : null}

          <div style={{ marginTop: 16 }}>
            {editionId ? <AlsoOwnedBy editionId={editionId} excludeUserBookId={book.id} excludeOwnerId={book.owner_id} /> : null}
          </div>
        </div>
      </AddToLibraryProvider>
    </main>
  );
}
