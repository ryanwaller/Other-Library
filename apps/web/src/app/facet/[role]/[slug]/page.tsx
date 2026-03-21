import Link from "next/link";
import type { Metadata } from "next";
import { getServerSupabase } from "../../../../lib/supabaseServer";
import FacetBookList from "./FacetBookList";
import ActiveFilterDisplay from "../../../../components/ActiveFilterDisplay";
import type { CoverCrop } from "../../../../components/CoverImage";
import { facetLabelForRole } from "../../../../lib/pageTitle";
import PublicSignInGate from "../../../components/PublicSignInGate";

export const dynamic = "force-dynamic";

const FACET_ROLES = ["author", "editor", "designer", "subject", "tag", "category", "material", "printer", "publisher", "performer", "composer", "producer", "engineer", "mastering", "featured artist", "arranger", "conductor", "orchestra", "art direction", "artwork", "design", "photography"] as const;
type FacetRole = (typeof FACET_ROLES)[number];

type FacetEntity = { id: string; name: string; slug: string };
type FacetBook = {
  id: number;
  owner_id: string;
  library_id: number | null;
  created_at: string;
  object_type?: string | null;
  title_override: string | null;
  subtitle_override?: string | null;
  authors_override: string[] | null;
  editors_override?: string[] | null;
  issue_number?: string | null;
  issue_volume?: string | null;
  issue_season?: string | null;
  issue_year?: number | null;
  music_metadata?: Record<string, unknown> | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: {
    title: string | null;
    authors: string[] | null;
    subjects?: string[] | null;
    publisher?: string | null;
    publish_date?: string | null;
    description?: string | null;
    cover_url: string | null;
  } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

function isFacetRole(input: string): input is FacetRole {
  return FACET_ROLES.includes(input as FacetRole);
}

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function labelForRole(role: FacetRole): string {
  return facetLabelForRole(role);
}

function effectiveTitle(row: FacetBook): string {
  return String(row.title_override ?? "").trim() || String(row.edition?.title ?? "").trim() || "(untitled)";
}

function titleSortKey(row: FacetBook): string {
  const title = effectiveTitle(row).trim().toLowerCase().replace(/\s+/g, " ");
  if ((String(row.object_type ?? "").trim().toLowerCase()) !== "magazine") return title;
  const volume = String(row.issue_volume ?? "").trim().toLowerCase();
  const issueNumber = String(row.issue_number ?? "").trim().toLowerCase();
  const season = String(row.issue_season ?? "").trim().toLowerCase();
  const year = String(row.issue_year ?? "").trim().toLowerCase();
  return [title, volume && `vol ${volume}`, issueNumber && `issue ${issueNumber}`, season, year]
    .filter(Boolean)
    .join(" | ");
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ role: string; slug: string }>;
}): Promise<Metadata> {
  const { role: roleRaw, slug: slugRaw } = await params;
  const role = (roleRaw ?? "").trim().toLowerCase();
  const slug = safeDecode(slugRaw ?? "").trim().toLowerCase();

  if (!isFacetRole(role) || !slug) return { title: "Search" };

  const supabase = getServerSupabase();
  if (!supabase) {
    return { title: `${facetLabelForRole(role)}: ${safeDecode(slugRaw ?? "")}` };
  }

  const entityRes = await supabase.from("entities").select("name").eq("slug", slug).maybeSingle();
  const entity = (entityRes.data ?? null) as { name?: string | null } | null;
  const value = String(entity?.name ?? "").trim() || safeDecode(slugRaw ?? "");
  return { title: `${facetLabelForRole(role)}: ${value}` };
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
    .limit(1000);

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
      .select("id,owner_id,library_id,created_at,object_type,title_override,subtitle_override,authors_override,editors_override,issue_number,issue_volume,issue_season,issue_year,music_metadata,cover_original_url,cover_crop,edition:editions(title,authors,subjects,publisher,publish_date,description,cover_url),media:user_book_media(kind,storage_path)")
      .in("id", bookIds)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (!booksRes.error) books = (booksRes.data ?? []) as unknown as FacetBook[];
  }

  const libraryIds = Array.from(new Set(books.map((b) => b.library_id).filter((id): id is number => Number.isFinite(id as number))));
  const libraryNameById: Record<number, string> = {};
  const librarySortById: Record<number, number> = {};
  if (libraryIds.length > 0) {
    let libraryRows: any[];
    const librariesRes = await supabase.from("libraries").select("id,name,sort_order").in("id", libraryIds);
    if (!librariesRes.error) {
      libraryRows = (librariesRes.data ?? []) as any[];
    } else {
      const msg = (librariesRes.error.message ?? "").toLowerCase();
      if (msg.includes("sort_order") && msg.includes("does not exist")) {
        const fallback = await supabase.from("libraries").select("id,name").in("id", libraryIds);
        libraryRows = ((fallback.data ?? []) as any[]).map((r) => ({ ...r, sort_order: null }));
      } else {
        libraryRows = [];
      }
    }
    for (const row of libraryRows) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;
      libraryNameById[id] = String(row.name ?? "").trim() || `Catalog ${id}`;
      const sortOrder = Number(row.sort_order);
      librarySortById[id] = Number.isFinite(sortOrder) ? sortOrder : 0;
    }
  }

  const mediaPaths = Array.from(
    new Set([
      ...books
        .flatMap((b) => (Array.isArray(b.media) ? b.media : []))
        .map((m) => m.storage_path)
        .filter((p): p is string => typeof p === "string" && p.length > 0),
      ...books
        .filter((b) => b.cover_crop && typeof b.cover_original_url === "string" && b.cover_original_url)
        .map((b) => b.cover_original_url as string),
    ])
  );
  const signedByPath: Record<string, string> = {};
  if (mediaPaths.length > 0) {
    const signedRes = await supabase.storage.from("user-book-media").createSignedUrls(mediaPaths, 60 * 30);
    if (signedRes.data) {
      for (const row of signedRes.data) {
        if (row.path && row.signedUrl) signedByPath[row.path] = row.signedUrl;
      }
    }
  }

  const grouped = new Map<number, FacetBook[]>();
  for (const book of books) {
    const libId = Number(book.library_id ?? 0) || 0;
    if (!grouped.has(libId)) grouped.set(libId, []);
    grouped.get(libId)!.push(book);
  }

  const groups = Array.from(grouped.entries())
    .map(([libraryId, rows]) => ({
      libraryId,
      name: libraryId > 0 ? libraryNameById[libraryId] ?? `Catalog ${libraryId}` : "Unassigned",
      sortOrder: libraryId > 0 ? librarySortById[libraryId] ?? 0 : 999999,
      rows: rows.sort((a, b) =>
        titleSortKey(a).localeCompare(titleSortKey(b), undefined, { numeric: true, sensitivity: "base" })
      )
    }))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name);
    });

  const catalogsCount = groups.length;
  const booksCount = books.length;
  const facetLabel = labelForRole(role);

  return (
    <PublicSignInGate>
      <main className="container">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="om-stat-line">
            <span className="om-stat-pair">
              <span className="text-muted">Catalogs</span>
              <span>{catalogsCount}</span>
            </span>
            <span className="om-stat-pair">
              <span className="text-muted">Items</span>
              <span>{booksCount}</span>
            </span>
          </div>
          <ActiveFilterDisplay
            pairs={[{ label: facetLabel, value: entity.name, key: role, clearHref: "/app" }]}
          />
        </div>

        <hr className="om-hr" style={{ marginTop: "var(--space-10)" }} />

        {groups.length === 0 ? (
          <div className="card muted">No items in this facet yet.</div>
        ) : (
          groups.map((group, index) => (
            <div key={group.libraryId} style={{ marginTop: index === 0 ? 0 : 12 }}>
              {index > 0 ? <hr className="om-hr" /> : null}
              <div className="row" style={{ gap: "var(--space-10)", marginTop: "var(--space-8)", marginBottom: "var(--space-10)" }}>
                <span>{group.name}</span>
                <span className="text-muted">
                  {group.rows.length} item{group.rows.length === 1 ? "" : "s"}
                </span>
              </div>

              <FacetBookList
                books={group.rows}
                signedByPath={signedByPath}
              />
            </div>
          ))
        )}
      </main>
    </PublicSignInGate>
  );
}
