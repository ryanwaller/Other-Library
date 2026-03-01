import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../../../lib/supabaseServer";
import PublicPagedBookList from "../../../PublicPagedBookList";
import type { CoverCrop } from "../../../../../components/CoverImage";

export const dynamic = "force-dynamic";

type PublicBook = {
  id: number;
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  title_override: string | null;
  authors_override: string[] | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: { isbn13: string | null; title: string | null; authors: string[] | null; cover_url: string | null; publisher: string | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

export default async function PublicPublisherPage({ params }: { params: Promise<{ username: string; publisher: string }> }) {
  const { username, publisher } = await params;
  const usernameNorm = (username ?? "").trim().toLowerCase();
  const publisherName = safeDecode(publisher ?? "").trim();
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
    permanentRedirect(`/u/${usernameNorm}/p/${encodeURIComponent(publisherName)}`);
  }

  const aliasRes = await supabase.from("username_aliases").select("current_username").eq("old_username", usernameNorm).maybeSingle();
  const alias = (aliasRes.data as any)?.current_username as string | undefined;
  if (alias && alias !== usernameNorm) {
    permanentRedirect(`/u/${alias}/p/${encodeURIComponent(publisherName)}`);
  }

  const profileRes = await supabase
    .from("profiles")
    .select("id,username,display_name,bio,visibility,avatar_path")
    .eq("username", usernameNorm)
    .maybeSingle();

  const profile = profileRes.data as any;
  if (!profile) {
    return (
      <main className="container">
        <div className="card">
          <div>@{usernameNorm}</div>
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

  const booksRes = await supabase
    .from("user_books")
    .select(
      "id,library_id,visibility,title_override,authors_override,publisher_override,cover_original_url,cover_crop,edition:editions(isbn13,title,authors,cover_url,publisher),media:user_book_media(kind,storage_path)"
    )
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(1000);

  const books = (booksRes.data ?? []) as unknown as PublicBook[];

  const needle = publisherName.toLowerCase();
  const filtered = books.filter((b) => {
    const pub = (b as any).publisher_override?.trim() || b.edition?.publisher?.trim() || "";
    return pub.toLowerCase() === needle;
  });

  const paths = Array.from(
    new Set([
      ...filtered
        .flatMap((b) => (Array.isArray(b.media) ? b.media : []))
        .filter((m) => typeof m.storage_path === "string" && m.storage_path.length > 0)
        .map((m) => m.storage_path),
      ...filtered
        .filter((b) => b.cover_crop && typeof b.cover_original_url === "string" && b.cover_original_url)
        .map((b) => b.cover_original_url as string)
    ])
  );

  const signedMap: Record<string, string> = {};
  if (paths.length > 0) {
    const signedRes = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 30);
    if (signedRes.data) {
      for (const s of signedRes.data) {
        if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
      }
    }
  }

  const librariesRes = await supabase
    .from("libraries")
    .select("id,name,created_at")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: true });

  const librariesRaw = (librariesRes.data ?? []) as Array<{ id: number; name: string; created_at: string }>;
  const fallbackLibraries = Array.from(new Set(filtered.map((b) => Number(b.library_id)).filter((n) => Number.isFinite(n) && n > 0)))
    .sort((a, b) => a - b)
    .map((id) => ({ id, name: `Catalog ${id}`, created_at: new Date(0).toISOString() }));
  const libraries = librariesRaw.length > 0 ? librariesRaw : fallbackLibraries;

  const groupsByLibraryId = new Map<number, PublicBook[]>();
  for (const b of filtered) {
    const libId = Number(b.library_id);
    if (!Number.isFinite(libId) || libId <= 0) continue;
    const cur = groupsByLibraryId.get(libId);
    if (!cur) groupsByLibraryId.set(libId, [b]);
    else cur.push(b);
  }

  const visibleLibraryCount = libraries.filter((lib) => (groupsByLibraryId.get(lib.id) ?? []).length > 0).length;

  return (
    <main className="container">
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
          <div className="muted">publisher</div>
        </div>
        <div style={{ marginTop: 8 }}>{publisherName || "—"}</div>
      </div>

      <div className="row muted" style={{ marginTop: 14, justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div className="row muted" style={{ gap: 12 }}>
          <span>Catalogs</span>
          <span>{visibleLibraryCount}</span>
          <span>Books</span>
          <span>{filtered.length}</span>
        </div>
        <div className="row muted" style={{ gap: 8 }}>
          <span>Publisher</span>
          <span style={{ color: "var(--fg)" }}>{publisherName || "—"}</span>
          <Link href={`/u/${profile.username}`} className="om-inline-link-muted">
            clear
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 14 }}>
        {libraries.map((lib) => {
          const libraryBooks = groupsByLibraryId.get(lib.id) ?? [];
          if (libraryBooks.length === 0) return null;
          return (
            <div key={lib.id}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <div>{lib.name}</div>
                <div className="muted">
                  {libraryBooks.length} book{libraryBooks.length === 1 ? "" : "s"}
                </div>
              </div>
              <PublicPagedBookList
                books={libraryBooks}
                username={profile.username}
                signedMap={signedMap}
              />
            </div>
          );
        })}
      </div>
    </main>
  );
}
