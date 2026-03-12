import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServerSupabase } from "../../../lib/supabaseServer";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { bookIdSlug, slugify } from "../../../lib/slug";
import type { CoverCrop } from "../../../components/CoverImage";
import { formatIssueDisplay, isMagazineObject } from "../../../lib/magazine";
import EntityBookGrid, { type GridItem } from "../../entity/[slug]/EntityBookGrid";
import EntityLibraryOwners, { type OwnerProfile } from "../../entity/[slug]/EntityLibraryOwners";

export const dynamic = "force-dynamic";

type BookRow = {
  id: number;
  owner_id: string;
  library_id: number | null;
  object_type: string | null;
  title_override: string | null;
  subtitle_override: string | null;
  issue_number: string | null;
  issue_volume: string | null;
  issue_season: string | null;
  issue_year: number | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: { title: string | null; cover_url: string | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

const BOOK_SELECT =
  "id,owner_id,library_id,object_type,title_override,subtitle_override,issue_number,issue_volume,issue_season,issue_year,cover_original_url,cover_crop,edition:editions(title,cover_url),media:user_book_media(kind,storage_path)";

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

function effectiveTitle(row: BookRow): string {
  return String(row.title_override ?? "").trim() || String(row.edition?.title ?? "").trim() || "(untitled)";
}

function effectiveSecondaryLine(row: BookRow): string | null {
  const subtitle = String(row.subtitle_override ?? "").trim();
  const issue = formatIssueDisplay(row) || null;
  if (subtitle && issue) return `${subtitle}, ${issue}`;
  return subtitle || issue || null;
}

function issueSortKey(row: BookRow): string {
  const year = String(row.issue_year ?? "9999").padStart(4, "0");
  const volume = String(row.issue_volume ?? "").trim().padStart(6, "0");
  const num = String(row.issue_number ?? "").trim().padStart(6, "0");
  const season = String(row.issue_season ?? "").trim().toLowerCase();
  return [year, volume, num, season].join("|");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug ?? "").trim();
  const supabase = getServerSupabase();
  if (!supabase || !slug) return { title: "Group" };
  // Find a canonical group_label matching this slug
  const res = await supabase
    .from("user_books")
    .select("group_label")
    .not("group_label", "is", null)
    .limit(500);
  const labels = [...new Set((res.data ?? []).map((r: any) => String(r.group_label ?? "").trim()).filter(Boolean))];
  const canonical = labels.find((label) => slugify(label) === slug);
  return { title: canonical || "Group" };
}

export default async function GroupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug ?? "").trim();
  if (!slug) notFound();

  const supabase = getServerSupabase();
  const admin = getSupabaseAdmin();
  if (!supabase) notFound();

  // Step 1: Find the canonical group_label for this slug
  const labelsRes = await supabase
    .from("user_books")
    .select("group_label")
    .not("group_label", "is", null)
    .limit(1000);
  const allLabels = [...new Set(
    (labelsRes.data ?? [])
      .map((r: any) => String(r.group_label ?? "").trim())
      .filter(Boolean)
  )];
  const canonicalLabel = allLabels.find((label) => slugify(label) === slug);
  if (!canonicalLabel) notFound();

  // Step 2: Fetch all publicly visible books with this group_label
  const booksRes = await supabase
    .from("user_books")
    .select(BOOK_SELECT)
    .eq("group_label", canonicalLabel)
    .order("issue_year", { ascending: true })
    .limit(500);

  const books = (booksRes.data ?? []) as unknown as BookRow[];
  if (books.length === 0) notFound();

  // Sort by issue info
  const sorted = books.slice().sort((a, b) => issueSortKey(a).localeCompare(issueSortKey(b), undefined, { numeric: true }));

  // Sign cover URLs
  const mediaPaths = [...new Set(sorted.map((b) => coverStoragePath(b)).filter((p): p is string => Boolean(p)))];
  const signedMap: Record<string, string> = {};
  const signingClient = admin ?? supabase;
  if (mediaPaths.length > 0) {
    const signed = await signingClient.storage.from("user-book-media").createSignedUrls(mediaPaths, 60 * 30);
    for (const row of signed.data ?? []) {
      if (row.path && row.signedUrl) signedMap[row.path] = row.signedUrl;
    }
  }

  // Owner profiles (publicly visible owners only)
  const ownerIds = [...new Set(sorted.map((b) => b.owner_id).filter(Boolean))];
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

  const avatarPaths = ownerProfiles.map((p) => p.avatar_path).filter((p): p is string => Boolean(p));
  const avatarSignedMap: Record<string, string> = {};
  if (avatarPaths.length > 0) {
    const signed = await signingClient.storage.from("avatars").createSignedUrls(avatarPaths, 60 * 30);
    for (const row of signed.data ?? []) {
      if (row.path && row.signedUrl) avatarSignedMap[row.path] = row.signedUrl;
    }
  }

  // Build grid items — one per book (each issue is distinct)
  const items: GridItem[] = sorted.map((row) => {
    const title = effectiveTitle(row);
    const username = profileByOwnerId.get(row.owner_id);
    const href = username
      ? `/u/${encodeURIComponent(username)}/b/${bookIdSlug(row.id, title)}`
      : null;
    return {
      id: row.id,
      title,
      secondaryLine: effectiveSecondaryLine(row),
      coverUrl: coverSrc(row, signedMap),
      coverCrop: row.cover_crop,
      href,
    };
  });

  const ownersForClient: OwnerProfile[] = ownerProfiles
    .map((p) => ({
      id: p.id,
      username: p.username,
      avatarUrl: p.avatar_path ? (avatarSignedMap[p.avatar_path] ?? null) : null,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));

  return (
    <main className="container">
      <div>{canonicalLabel}</div>
      <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
        {items.length} {items.length === 1 ? "issue" : "issues"}
      </div>
      <EntityBookGrid items={items} />
      {ownersForClient.length > 0 && (
        <div id="section-libraries" style={{ marginTop: "var(--space-xl)" }}>
          <hr className="divider" />
          <EntityLibraryOwners owners={ownersForClient} />
        </div>
      )}
    </main>
  );
}
