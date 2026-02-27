import Link from "next/link";
import { getServerSupabase } from "../../../../lib/supabaseServer";
import { bookIdSlug } from "../../../../lib/slug";

export const dynamic = "force-dynamic";

const FACET_ROLES = ["author", "editor", "designer", "subject", "tag", "category", "material", "printer", "publisher"] as const;
type FacetRole = (typeof FACET_ROLES)[number];

type FacetEntity = { id: string; name: string; slug: string };
type FacetBook = {
  id: number;
  owner_id: string;
  title_override: string | null;
  authors_override: string[] | null;
  publisher_override: string | null;
  publish_date_override: string | null;
  edition: {
    title: string | null;
    authors: string[] | null;
    publisher: string | null;
    publish_date: string | null;
    cover_url: string | null;
  } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

function isFacetRole(input: string): input is FacetRole {
  return FACET_ROLES.includes(input as FacetRole);
}

function headingFor(role: FacetRole, name: string): string {
  if (role === "author") return `By ${name}`;
  if (role === "editor") return `Edited by ${name}`;
  if (role === "designer") return `Designed by ${name}`;
  if (role === "subject") return `Subject: ${name}`;
  if (role === "tag") return `Tag: ${name}`;
  if (role === "category") return `Category: ${name}`;
  if (role === "material") return `Material: ${name}`;
  if (role === "printer") return `Printed by ${name}`;
  return `Published by ${name}`;
}

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

export default async function FacetBrowsePage({ params }: { params: Promise<{ role: string; slug: string }> }) {
  const { role: roleRaw, slug: slugRaw } = await params;
  const role = (roleRaw ?? "").trim().toLowerCase();
  const slug = safeDecode(slugRaw ?? "").trim().toLowerCase();

  if (!isFacetRole(role) || !slug) {
    return (
      <main className="container">
        <div className="card">Not found.</div>
      </main>
    );
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return (
      <main className="container">
        <div className="card">Supabase is not configured.</div>
      </main>
    );
  }

  const entityRes = await supabase.from("entities").select("id,name,slug").eq("slug", slug).maybeSingle();
  if (entityRes.error) {
    return (
      <main className="container">
        <div className="card">Facet browse is unavailable until migrations are applied.</div>
      </main>
    );
  }
  const entity = (entityRes.data ?? null) as FacetEntity | null;
  if (!entity) {
    return (
      <main className="container">
        <div className="card">No matching facet.</div>
      </main>
    );
  }

  const idsRes = await supabase
    .from("book_entities")
    .select("user_book_id,position")
    .eq("role", role)
    .eq("entity_id", entity.id)
    .order("position", { ascending: true })
    .limit(500);

  if (idsRes.error) {
    return (
      <main className="container">
        <div className="card">Facet browse is unavailable until migrations are applied.</div>
      </main>
    );
  }

  const bookIds = Array.from(
    new Set(
      (idsRes.data ?? [])
        .map((r: any) => Number(r.user_book_id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  let books: FacetBook[] = [];
  if (bookIds.length > 0) {
    const booksRes = await supabase
      .from("user_books")
      .select(
        "id,owner_id,title_override,authors_override,publisher_override,publish_date_override,edition:editions(title,authors,publisher,publish_date,cover_url),media:user_book_media(kind,storage_path)"
      )
      .in("id", bookIds)
      .order("created_at", { ascending: false })
      .limit(500);
    if (!booksRes.error) {
      books = (booksRes.data ?? []) as unknown as FacetBook[];
    }
  }

  const ownerIds = Array.from(new Set(books.map((b) => b.owner_id).filter(Boolean)));
  const usernamesByOwnerId: Record<string, string> = {};
  if (ownerIds.length > 0) {
    const profilesRes = await supabase.from("profiles").select("id,username").in("id", ownerIds);
    for (const p of profilesRes.data ?? []) {
      const id = String((p as any).id ?? "");
      const username = String((p as any).username ?? "").trim();
      if (id && username) usernamesByOwnerId[id] = username;
    }
  }

  const mediaPaths = Array.from(
    new Set(
      books
        .flatMap((b) => (Array.isArray(b.media) ? b.media : []))
        .map((m) => m.storage_path)
        .filter((p): p is string => typeof p === "string" && p.length > 0)
    )
  );
  const signedByPath: Record<string, string> = {};
  if (mediaPaths.length > 0) {
    const signedRes = await supabase.storage.from("user-book-media").createSignedUrls(mediaPaths, 60 * 30);
    for (const row of signedRes.data ?? []) {
      if (row.path && row.signedUrl) signedByPath[row.path] = row.signedUrl;
    }
  }

  return (
    <main className="container">
      <div>{headingFor(role, entity.name)}</div>
      <div className="muted" style={{ marginTop: 4 }}>
        {books.length} result{books.length === 1 ? "" : "s"}
      </div>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
        {books.map((b) => {
          const title = String((b.title_override ?? "").trim() || b.edition?.title || "(untitled)");
          const authors =
            (b.authors_override ?? []).filter(Boolean).length > 0
              ? (b.authors_override ?? []).filter(Boolean)
              : (b.edition?.authors ?? []).filter(Boolean);
          const coverMedia = (b.media ?? []).find((m) => m.kind === "cover");
          const coverUrl = coverMedia ? signedByPath[coverMedia.storage_path] : b.edition?.cover_url ?? null;
          const username = usernamesByOwnerId[b.owner_id] ?? "";
          const href = username ? `/u/${username}/b/${bookIdSlug(b.id, title)}` : "";
          const publisher = String((b.publisher_override ?? "").trim() || b.edition?.publisher || "").trim();
          const publishDate = String((b.publish_date_override ?? "").trim() || b.edition?.publish_date || "").trim();
          return (
            <div key={b.id} className="card">
              {href ? (
                <Link href={href} className="om-book-card-link">
                  <div className="om-cover-slot" style={{ width: "100%", height: 220 }}>
                    {coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={title} src={coverUrl} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                    ) : null}
                  </div>
                  <div style={{ marginTop: 10 }} className="book-title">
                    {title}
                  </div>
                </Link>
              ) : (
                <>
                  <div className="om-cover-slot" style={{ width: "100%", height: 220 }}>
                    {coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={title} src={coverUrl} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                    ) : null}
                  </div>
                  <div style={{ marginTop: 10 }} className="book-title">
                    {title}
                  </div>
                </>
              )}
              {authors.length > 0 ? <div className="om-book-secondary">{authors.join(", ")}</div> : null}
              {publisher || publishDate ? (
                <div className="om-book-secondary">
                  {[publisher, publishDate].filter(Boolean).join(" · ")}
                </div>
              ) : null}
              {username ? (
                <div className="om-book-secondary">
                  <Link href={`/u/${username}`}>{username}</Link>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
