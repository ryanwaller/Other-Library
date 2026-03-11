import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServerSupabase } from "../../../lib/supabaseServer";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { bookIdSlug } from "../../../lib/slug";
import type { CoverCrop } from "../../../components/CoverImage";
import { formatIssueDisplay, isMagazineObject } from "../../../lib/magazine";
import EntityPageModules, { type ModuleData, type EntityModuleItem, type OwnerEntry } from "./EntityPageModules";
import EntityLibraryOwners, { type OwnerProfile } from "./EntityLibraryOwners";

export const dynamic = "force-dynamic";

type EntityRow = { id: string; name: string; slug: string };

type BookRow = {
  id: number;
  owner_id: string;
  created_at: string;
  edition_id: number | null;
  title_override: string | null;
  object_type: string | null;
  issue_number: string | null;
  issue_volume: string | null;
  issue_season: string | null;
  issue_year: number | null;
  issn: string | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: { title: string | null; isbn13: string | null; cover_url: string | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

const BOOK_SELECT =
  "id,owner_id,created_at,edition_id,title_override,object_type,issue_number,issue_volume,issue_season,issue_year,issn,cover_original_url,cover_crop,edition:editions(title,isbn13,cover_url),media:user_book_media(kind,storage_path)";

const ROLE_ORDER = [
  "author", "performer", "editor", "publisher", "composer", "producer",
  "designer", "design", "art direction", "engineer", "mastering",
  "featured artist", "arranger", "conductor", "orchestra",
  "printer", "subject", "tag", "category", "material", "artwork", "photography"
];

function roleSortIndex(role: string): number {
  const idx = ROLE_ORDER.indexOf(role.toLowerCase());
  return idx === -1 ? 999 : idx;
}

function roleHeading(role: string, name: string): string {
  switch (role.toLowerCase()) {
    case "author": return `Books by ${name}`;
    case "editor": return `Edited by ${name}`;
    case "designer":
    case "design": return `Designed by ${name}`;
    case "publisher": return `Published by ${name}`;
    case "printer": return `Printed by ${name}`;
    case "subject": return `About ${name}`;
    case "tag": return `Tagged "${name}"`;
    case "category": return `In ${name}`;
    case "material": return `Items using ${name}`;
    case "performer": return `Records by ${name}`;
    case "composer": return `Composed by ${name}`;
    case "producer": return `Produced by ${name}`;
    case "engineer": return `Engineered by ${name}`;
    case "mastering": return `Mastering by ${name}`;
    case "featured artist": return `Featuring ${name}`;
    case "arranger": return `Arranged by ${name}`;
    case "conductor": return `Conducted by ${name}`;
    case "orchestra": return `Orchestra: ${name}`;
    case "art direction": return `Art direction by ${name}`;
    case "artwork": return `Artwork by ${name}`;
    case "photography": return `Photography by ${name}`;
    default: return `${name} — ${role}`;
  }
}

function roleSummaryLabel(role: string, count: number): string {
  const item = count === 1 ? "item" : "items";
  const book = count === 1 ? "book" : "books";
  const record = count === 1 ? "record" : "records";
  switch (role.toLowerCase()) {
    case "author": return `Authored ${count} ${book}`;
    case "editor": return `Edited ${count} ${item}`;
    case "designer":
    case "design": return `Designed ${count} ${item}`;
    case "art direction": return `Art direction on ${count} ${item}`;
    case "publisher": return `Published ${count} ${item}`;
    case "printer": return `Printed ${count} ${item}`;
    case "performer": return `Performed ${count} ${record}`;
    case "composer": return `Composed ${count} ${record}`;
    case "producer": return `Produced ${count} ${record}`;
    case "engineer": return `Engineered ${count} ${record}`;
    case "mastering": return `Mastering on ${count} ${record}`;
    case "featured artist": return `Featured on ${count} ${record}`;
    case "arranger": return `Arranged ${count} ${record}`;
    case "conductor": return `Conducted ${count} ${record}`;
    default: return `${count} ${item} (${role})`;
  }
}

function effectiveTitle(row: BookRow): string {
  return String(row.title_override ?? "").trim() || String(row.edition?.title ?? "").trim() || "(untitled)";
}

function effectiveSecondaryLine(row: BookRow): string | null {
  if (!isMagazineObject(row.object_type)) return null;
  return formatIssueDisplay(row) || null;
}

function editionKey(row: BookRow): string {
  if (row.edition_id) return `eid:${row.edition_id}`;
  if (isMagazineObject(row.object_type)) return `mag:${row.id}`;
  const isbn = String(row.edition?.isbn13 ?? "").trim();
  if (isbn) return `isbn:${isbn}`;
  const title = effectiveTitle(row).toLowerCase().replace(/\s+/g, " ");
  return `title:${title}`;
}

function isRemoteUrl(s: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(s ?? "").trim());
}

function coverStoragePath(row: BookRow): string | null {
  const coverMedia = (row.media ?? []).find((m) => m.kind === "cover")?.storage_path ?? null;
  if (coverMedia) return coverMedia;
  const firstMedia = (row.media ?? [])[0]?.storage_path ?? null;
  if (firstMedia) return firstMedia;
  const original = String(row.cover_original_url ?? "").trim();
  return original && !isRemoteUrl(original) ? original : null;
}

function coverSrc(row: BookRow, signedMap: Record<string, string>): string | null {
  const original = String(row.cover_original_url ?? "").trim();
  if (original) {
    if (isRemoteUrl(original)) return original;
    if (signedMap[original]) return signedMap[original];
  }
  const storagePath = coverStoragePath(row);
  if (storagePath && signedMap[storagePath]) return signedMap[storagePath];
  return String(row.edition?.cover_url ?? "").trim() || null;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug ?? "").trim().toLowerCase();
  const supabase = getServerSupabase();
  if (!supabase || !slug) return { title: "Entity" };
  const res = await supabase.from("entities").select("name").eq("slug", slug).maybeSingle();
  const name = String(res.data?.name ?? "").trim();
  return { title: name || "Entity" };
}

export default async function EntityPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug ?? "").trim().toLowerCase();
  if (!slug) notFound();

  const supabase = getServerSupabase();
  const admin = getSupabaseAdmin();
  if (!supabase) notFound();

  // 1. Look up entity by slug
  const entityRes = await supabase
    .from("entities")
    .select("id,name,slug")
    .eq("slug", slug)
    .maybeSingle();
  if (entityRes.error || !entityRes.data) notFound();
  const entity = entityRes.data as EntityRow;

  // 2. Get all book_entity links for this entity
  const bookEntityRes = await supabase
    .from("book_entities")
    .select("user_book_id,role")
    .eq("entity_id", entity.id)
    .limit(2000);
  const bookEntityLinks = (bookEntityRes.data ?? []) as Array<{ user_book_id: number; role: string }>;

  const idToRoles = new Map<number, Set<string>>();
  for (const link of bookEntityLinks) {
    const id = Number(link.user_book_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (!idToRoles.has(id)) idToRoles.set(id, new Set());
    idToRoles.get(id)!.add(String(link.role ?? "").trim().toLowerCase());
  }
  const linkedBookIds = Array.from(idToRoles.keys());

  // 3. Fetch linked user_books — RLS filters to publicly visible only
  const linkedBooksMap = new Map<number, BookRow>();
  if (linkedBookIds.length > 0) {
    const booksRes = await supabase
      .from("user_books")
      .select(BOOK_SELECT)
      .in("id", linkedBookIds)
      .order("created_at", { ascending: false })
      .limit(500);
    if (!booksRes.error) {
      for (const book of (booksRes.data ?? []) as unknown as BookRow[]) {
        linkedBooksMap.set(book.id, book);
      }
    }
  }

  // 4. Fetch override-field matches (exclude already-linked IDs)
  const excludeList = linkedBookIds.length > 0 ? linkedBookIds : null;

  const arrayOverrides: Array<{ field: string; role: string }> = [
    { field: "authors_override", role: "author" },
    { field: "editors_override", role: "editor" },
    { field: "designers_override", role: "designer" },
    { field: "subjects_override", role: "subject" },
  ];

  const stringOverrides: Array<{ field: string; role: string }> = [
    { field: "publisher_override", role: "publisher" },
    { field: "printer_override", role: "printer" },
    { field: "materials_override", role: "material" },
  ];

  const [arrayOverrideResults, stringOverrideResults] = await Promise.all([
    Promise.all(
      arrayOverrides.map(async ({ field, role }) => {
        let q = supabase!
          .from("user_books")
          .select(BOOK_SELECT)
          .contains(field, [entity.name]);
        if (excludeList) q = q.not("id", "in", `(${excludeList.join(",")})`);
        const res = await q.order("created_at", { ascending: false }).limit(200);
        return { role, books: (res.data ?? []) as unknown as BookRow[] };
      })
    ),
    Promise.all(
      stringOverrides.map(async ({ field, role }) => {
        let q = supabase!
          .from("user_books")
          .select(BOOK_SELECT)
          .eq(field, entity.name);
        if (excludeList) q = q.not("id", "in", `(${excludeList.join(",")})`);
        const res = await q.order("created_at", { ascending: false }).limit(200);
        return { role, books: (res.data ?? []) as unknown as BookRow[] };
      })
    ),
  ]);

  // 5. Merge all results into role buckets
  const byRole = new Map<string, Map<number, BookRow>>();

  const addBook = (role: string, book: BookRow) => {
    if (!byRole.has(role)) byRole.set(role, new Map());
    byRole.get(role)!.set(book.id, book);
  };

  for (const [bookId, roles] of idToRoles.entries()) {
    const book = linkedBooksMap.get(bookId);
    if (!book) continue;
    for (const role of roles) addBook(role, book);
  }

  for (const { role, books } of [...arrayOverrideResults, ...stringOverrideResults]) {
    for (const book of books) addBook(role, book);
  }

  for (const [role, books] of byRole.entries()) {
    if (books.size === 0) byRole.delete(role);
  }

  if (byRole.size === 0) {
    return (
      <main className="container">
        <div>{entity.name}</div>
        <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>No items found.</div>
      </main>
    );
  }

  // 6. Sort roles
  const sortedRoles = Array.from(byRole.entries()).sort(
    (a, b) => roleSortIndex(a[0]) - roleSortIndex(b[0])
  );

  // 7. Group books by edition within each role (newest-first within each group)
  type EditionGroup = { rep: BookRow; allBooks: BookRow[] };

  const roleGroups = sortedRoles.map(([role, booksMap]) => {
    const sorted = Array.from(booksMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const byEd = new Map<string, BookRow[]>();
    for (const book of sorted) {
      const key = editionKey(book);
      if (!byEd.has(key)) byEd.set(key, []);
      byEd.get(key)!.push(book);
    }
    const groups: EditionGroup[] = Array.from(byEd.values()).map((books) => ({
      rep: books[0],
      allBooks: books
    }));
    return { role, groups };
  });

  // Collect ALL copies across all edition groups (for signing and owner queries)
  const allCopies = roleGroups.flatMap(({ groups }) => groups.flatMap((g) => g.allBooks));

  // 8. Sign cover storage URLs for ALL copies (not just representatives —
  //    viewers' own copies may have different uploaded covers)
  const mediaPaths = Array.from(
    new Set(allCopies.map((b) => coverStoragePath(b)).filter((p): p is string => Boolean(p)))
  );
  const signedMap: Record<string, string> = {};
  const signingClient = admin ?? supabase;
  if (mediaPaths.length > 0) {
    const signed = await signingClient.storage
      .from("user-book-media")
      .createSignedUrls(mediaPaths, 60 * 30);
    for (const row of signed.data ?? []) {
      if (row.path && row.signedUrl) signedMap[row.path] = row.signedUrl;
    }
  }

  // 9. Owner profiles (public only — for library section and fallback hrefs)
  const ownerIds = Array.from(new Set(allCopies.map((b) => b.owner_id).filter(Boolean)));
  let ownerProfiles: Array<{ id: string; username: string; avatar_path: string | null }> = [];
  if (ownerIds.length > 0) {
    const profilesRes = await supabase
      .from("profiles")
      .select("id,username,avatar_path")
      .in("id", ownerIds)
      .eq("visibility", "public")
      .limit(100);
    if (!profilesRes.error) ownerProfiles = (profilesRes.data ?? []) as any[];
  }
  const profileByOwnerId = new Map(ownerProfiles.map((p) => [p.id, p.username]));

  // Sign avatar URLs
  const avatarPaths = ownerProfiles.map((p) => p.avatar_path).filter((p): p is string => Boolean(p));
  const avatarSignedMap: Record<string, string> = {};
  if (avatarPaths.length > 0) {
    const signed = await signingClient.storage
      .from("avatars")
      .createSignedUrls(avatarPaths, 60 * 30);
    for (const row of signed.data ?? []) {
      if (row.path && row.signedUrl) avatarSignedMap[row.path] = row.signedUrl;
    }
  }

  // 10. Finalize modules — ownerEntries carry per-copy cover data so the
  //     client can build "Your copies" with the viewer's own covers.
  const modules: ModuleData[] = roleGroups.flatMap(({ role, groups }) => {
    const splitByPeriodical = role === "publisher" || role === "editor";
    const buckets = splitByPeriodical
      ? [
          { key: `${role}:default`, heading: roleHeading(role, entity.name), groups: groups.filter(({ rep }) => !isMagazineObject(rep.object_type)) },
          { key: `${role}:magazine`, heading: role === "publisher" ? `Issues published by ${entity.name}` : `Issues edited by ${entity.name}`, groups: groups.filter(({ rep }) => isMagazineObject(rep.object_type)) }
        ]
      : [{ key: role, heading: roleHeading(role, entity.name), groups }];

    return buckets
      .filter((bucket) => bucket.groups.length > 0)
      .map((bucket) => {
        const total = bucket.groups.length;
        const displayed = bucket.groups.slice(0, 12);

        const items: EntityModuleItem[] = displayed.map(({ rep, allBooks }) => {
          const title = effectiveTitle(rep);

          const ownerEntries: OwnerEntry[] = allBooks
            .map((b): OwnerEntry | null => {
              if (!profileByOwnerId.has(b.owner_id)) return null;
              return {
                ownerId: b.owner_id,
                userBookId: b.id,
                coverUrl: coverSrc(b, signedMap),
                coverCrop: b.cover_crop,
                title: effectiveTitle(b)
              };
            })
            .filter((e): e is OwnerEntry => e !== null);

          const firstPublic = allBooks.find((b) => profileByOwnerId.has(b.owner_id));
          const publicFallbackHref = firstPublic
            ? `/u/${encodeURIComponent(profileByOwnerId.get(firstPublic.owner_id)!)}/b/${bookIdSlug(firstPublic.id, title)}`
            : null;

          return {
            id: rep.id,
            title,
            secondaryLine: effectiveSecondaryLine(rep),
            coverUrl: coverSrc(rep, signedMap),
            coverCrop: rep.cover_crop,
            ownerEntries,
            publicFallbackHref
          };
        });

        return {
          role: bucket.key,
          heading: bucket.heading,
          items,
          total,
          viewAllHref:
            total > 12
              ? `/facet/${encodeURIComponent(role)}/${encodeURIComponent(entity.slug)}`
              : null
        };
      });
  });

  // 11. Library section
  const ownersForClient: OwnerProfile[] = ownerProfiles
    .map((p) => ({
      id: p.id,
      username: p.username,
      avatarUrl: p.avatar_path ? (avatarSignedMap[p.avatar_path] ?? null) : null
    }))
    .sort((a, b) => a.username.localeCompare(b.username));

  // 12. Summary line
  const summaryParts: string[] = modules
    .map((mod) => roleSummaryLabel(mod.role, mod.total))
    .filter(Boolean);
  if (ownersForClient.length > 0) {
    const n = ownersForClient.length;
    summaryParts.push(`In ${n} ${n === 1 ? "library" : "libraries"}`);
  }

  return (
    <main className="container">
      <div>{entity.name}</div>
      {summaryParts.length > 0 && (
        <div
          className="text-muted"
          style={{ marginTop: "var(--space-sm)", display: "flex", flexWrap: "wrap", gap: "var(--space-lg)" }}
        >
          {summaryParts.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>
      )}

      <EntityPageModules modules={modules} />

      {ownersForClient.length > 0 && (
        <div style={{ marginTop: "var(--space-xl)" }}>
          <hr className="divider" />
          <EntityLibraryOwners owners={ownersForClient} />
        </div>
      )}
    </main>
  );
}
