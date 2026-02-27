import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../../../lib/supabaseServer";
import { bookIdSlug } from "../../../../../lib/slug";
import { formatDateShort } from "../../../../../lib/formatDate";
import AddToLibraryButton from "../../AddToLibraryButton";
import AlsoOwnedBy from "../../AlsoOwnedBy";
import BorrowRequestWidget from "../../BorrowRequestWidget";
import ScrollToTopOnMount from "../../../../components/ScrollToTopOnMount";

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
  description_override: string | null;
  subjects_override: string[] | null;
  borrowable_override: boolean | null;
  borrow_request_scope_override: string | null;
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

  const bookRes = await supabase
    .from("user_books")
    .select(
      "id,owner_id,visibility,title_override,authors_override,editors_override,designers_override,publisher_override,printer_override,materials_override,edition_override,publish_date_override,description_override,subjects_override,borrowable_override,borrow_request_scope_override,edition:editions(id,isbn13,isbn10,title,authors,publisher,publish_date,description,subjects,cover_url),media:user_book_media(id,kind,storage_path,caption,created_at)"
    )
    .eq("id", bookId)
    .eq("owner_id", profile.id)
    .maybeSingle();

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

  const effectiveAuthors =
    (book.authors_override ?? []).filter(Boolean).length > 0
      ? (book.authors_override ?? []).filter(Boolean)
      : (book.edition?.authors ?? []).filter(Boolean);

  const effectiveEditors = (book.editors_override ?? []).filter(Boolean);
  const effectiveDesigners = (book.designers_override ?? []).filter(Boolean);
  const effectivePrinter = (book.printer_override ?? "").trim();
  const effectiveMaterials = (book.materials_override ?? "").trim();
  const effectiveEdition = (book.edition_override ?? "").trim();

  const effectivePublisher = (book.publisher_override ?? "").trim() || book.edition?.publisher || "";
  const effectivePublishDate = (book.publish_date_override ?? "").trim() || book.edition?.publish_date || "";
  const displayPublishDate = formatDateShort(effectivePublishDate || null);
  const effectiveDescription = (book.description_override ?? "").trim() || book.edition?.description || "";
  const effectiveSubjects =
    book.subjects_override !== null && book.subjects_override !== undefined
      ? ((book.subjects_override ?? []).filter(Boolean) as string[])
      : ((book.edition?.subjects ?? []).filter(Boolean) as string[]);
  const subjects = effectiveSubjects.slice().sort((a, b) => a.localeCompare(b));

  const paths = Array.from(new Set((book.media ?? []).map((m) => m.storage_path).filter(Boolean)));
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
  const coverUrl = coverMedia ? signedMap[coverMedia.storage_path] : book.edition?.cover_url ?? null;
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
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="om-avatar-lockup">
              {avatarUrl ? (
                <Link href={`/u/${profile.username}`} className="om-avatar-link" aria-label="Open profile">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" src={avatarUrl} className="om-avatar-img" />
                </Link>
              ) : null}
              <Link href={`/u/${profile.username}`}>{profile.username}</Link>
            </div>
          </div>
          <div className="muted">public</div>
        </div>
        {profile.display_name ? <div style={{ marginTop: 6 }}>{profile.display_name}</div> : null}
      </div>

      <div style={{ marginTop: 14 }} className="card">
        <div className="om-book-detail-grid">
          <div>
            {coverUrl ? (
              <div className="om-cover-slot" style={{ width: "100%", height: 280 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={effectiveTitle} src={coverUrl} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              </div>
            ) : (
              <div className="om-cover-slot" style={{ width: "100%", height: 280 }} />
            )}
          </div>

          <div>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <div style={{ fontWeight: 600 }}>{effectiveTitle}</div>
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

            {book.edition?.isbn13 || book.edition?.isbn10 ? (
              <div className="row om-row-baseline" style={{ marginTop: 6 }}>
                <div style={{ minWidth: 110 }} className="muted">
                  ISBN
                </div>
                <div>{book.edition?.isbn13 ?? book.edition?.isbn10}</div>
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

            <div style={{ marginTop: 12 }} className="muted">
              Borrowing
            </div>
            <div style={{ marginTop: 6 }} className="muted">
              {effectiveBorrowable ? `borrowable (${effectiveBorrowScope})` : "not borrowable"}
            </div>
            <div style={{ marginTop: 10 }}>
              <BorrowRequestWidget
                userBookId={book.id}
                ownerId={book.owner_id}
                ownerUsername={profile.username}
                bookTitle={effectiveTitle}
                borrowable={effectiveBorrowable}
                scope={effectiveBorrowScope}
              />
            </div>

            {subjects.length > 0 ? (
              <div className="row om-row-baseline" style={{ marginTop: 12 }}>
                <div style={{ minWidth: 110 }} className="muted">
                  Subjects
                </div>
                <div>
                  {subjects.map((s, idx) => (
                    <span key={s}>
                      <Link href={`/u/${profile.username}/s/${encodeURIComponent(s)}`}>{s}</Link>
                      {idx < subjects.length - 1 ? <span>, </span> : null}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {effectiveDescription ? (
              <>
                <div style={{ marginTop: 12 }} className="muted">
                  Description
                </div>
                <div className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                  {effectiveDescription}
                </div>
              </>
            ) : null}
          </div>
        </div>

        {images.length > 0 ? (
          <>
            <div style={{ marginTop: 14 }} className="muted">
              Images
            </div>
            <div className="om-images-grid" style={{ marginTop: 10 }}>
              {images.map((m) => {
                const url = signedMap[m.storage_path];
                return (
                  <a key={m.id} href={url || "#"} target="_blank" rel="noreferrer">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <div className="om-cover-slot" style={{ width: "100%", height: 180 }}>
                        <img alt="" src={url} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      </div>
                    ) : (
                      <div className="om-cover-slot" style={{ width: "100%", height: 180 }} />
                    )}
                  </a>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      {editionId ? <AlsoOwnedBy editionId={editionId} excludeUserBookId={book.id} excludeOwnerId={book.owner_id} /> : null}
    </main>
  );
}
