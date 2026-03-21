import Link from "next/link";
import type { Metadata } from "next";
import type { CoverCrop } from "../components/CoverImage";
import ExploreAuthPanel from "./ExploreAuthPanel";
import EntityBookGrid, { type GridItem } from "./entity/[slug]/EntityBookGrid";
import { effectiveAuthorsFor } from "../lib/book";
import { formatIssueDisplay, isMagazineObject } from "../lib/magazine";
import { parseMusicMetadata } from "../lib/music";
import { SITE_TITLE } from "../lib/pageTitle";
import { bookIdSlug, slugify } from "../lib/slug";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { getServerSupabase } from "../lib/supabaseServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Home"
};

type ExploreBookRow = {
  id: number;
  owner_id: string;
  created_at: string;
  visibility: "inherit" | "followers_only" | "public";
  group_label: string | null;
  object_type: string | null;
  title_override: string | null;
  subtitle_override: string | null;
  issue_number: string | null;
  issue_volume: string | null;
  issue_season: string | null;
  issue_year: number | null;
  authors_override?: string[] | null;
  editors_override?: string[] | null;
  music_metadata?: unknown;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: { title: string | null; authors?: string[] | null; cover_url: string | null } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
  book_entities?: Array<{ role: string; entity: { id: string; name: string; slug: string } | null }> | null;
};

const BOOK_SELECT =
  "id,owner_id,created_at,visibility,group_label,object_type,title_override,subtitle_override,issue_number,issue_volume,issue_season,issue_year,authors_override,editors_override,music_metadata,cover_original_url,cover_crop,edition:editions(title,authors,cover_url),media:user_book_media(kind,storage_path),book_entities:book_entities(role,entity:entities(id,name,slug))";

function isRemoteUrl(value: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

function coverStoragePath(row: ExploreBookRow): string | null {
  const coverMedia = (row.media ?? []).find((entry) => entry.kind === "cover")?.storage_path ?? null;
  if (coverMedia) return coverMedia;
  const firstMedia = (row.media ?? [])[0]?.storage_path ?? null;
  if (firstMedia) return firstMedia;
  const original = String(row.cover_original_url ?? "").trim();
  return original && !isRemoteUrl(original) ? original : null;
}

function coverSrc(row: ExploreBookRow, signedMap: Record<string, string>): string | null {
  const original = String(row.cover_original_url ?? "").trim();
  if (original) {
    if (isRemoteUrl(original)) return original;
    if (signedMap[original]) return signedMap[original];
  }
  const storagePath = coverStoragePath(row);
  if (storagePath && signedMap[storagePath]) return signedMap[storagePath];
  return String(row.edition?.cover_url ?? "").trim() || null;
}

function effectiveTitle(row: ExploreBookRow): string {
  return String(row.title_override ?? "").trim() || String(row.edition?.title ?? "").trim() || "(untitled)";
}

function effectiveSecondaryLine(row: ExploreBookRow): string | null {
  if (isMagazineObject(row.object_type)) {
    const subtitle = String(row.subtitle_override ?? "").trim();
    const issue = formatIssueDisplay(row);
    const values = [subtitle, issue].filter(Boolean);
    return values.length > 0 ? values.join(", ") : null;
  }

  if (String(row.object_type ?? "").trim().toLowerCase() === "music") {
    const primaryArtist = String(parseMusicMetadata(row.music_metadata)?.primary_artist ?? "").trim();
    return primaryArtist || null;
  }

  const authors = effectiveAuthorsFor(row as any);
  return authors.length > 0 ? authors.join(", ") : null;
}

function toGridItem(row: ExploreBookRow, usernameByOwnerId: Map<string, string>, signedMap: Record<string, string>): GridItem | null {
  const username = usernameByOwnerId.get(row.owner_id);
  if (!username) return null;
  const title = effectiveTitle(row);
  return {
    id: row.id,
    title,
    secondaryLine: effectiveSecondaryLine(row),
    coverUrl: coverSrc(row, signedMap),
    coverCrop: row.cover_crop,
    href: `/u/${encodeURIComponent(username)}/b/${bookIdSlug(row.id, title)}`,
  };
}

function uniqueById(rows: ExploreBookRow[]): ExploreBookRow[] {
  const seen = new Set<number>();
  const out: ExploreBookRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

async function loadExploreData() {
  const supabase = getServerSupabase();
  const admin = getSupabaseAdmin();
  const db = admin ?? supabase;
  if (!db) return null;

  const recentRes = await db
    .from("user_books")
    .select(BOOK_SELECT)
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(60);

  const recentRows = uniqueById((recentRes.data ?? []) as unknown as ExploreBookRow[]);
  if (recentRows.length === 0) {
    return {
      recentItems: [] as GridItem[],
      recentPeriodicals: [] as GridItem[],
      designerHeading: null as { name: string; slug: string | null } | null,
      designerItems: [] as GridItem[],
      groupHeading: null as { label: string; slug: string } | null,
      groupItems: [] as GridItem[],
    };
  }

  const ownerIds = [...new Set(recentRows.map((row) => row.owner_id).filter(Boolean))];
  const profilesRes = ownerIds.length
    ? await db.from("profiles").select("id,username").in("id", ownerIds).eq("visibility", "public")
    : { data: [] as Array<{ id: string; username: string }> };

  const usernameByOwnerId = new Map(
    ((profilesRes.data ?? []) as Array<{ id: string; username: string }>)
      .map((row) => [row.id, row.username] as const)
  );

  const mediaPaths = [...new Set(recentRows.map((row) => coverStoragePath(row)).filter((path): path is string => Boolean(path)))];
  const signedMap: Record<string, string> = {};
  if (mediaPaths.length > 0) {
    const signedRes = await db.storage.from("user-book-media").createSignedUrls(mediaPaths, 60 * 30);
    for (const row of signedRes.data ?? []) {
      if (row.path && row.signedUrl) signedMap[row.path] = row.signedUrl;
    }
  }

  const recentItems = recentRows
    .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
    .filter((item): item is GridItem => Boolean(item))
    .slice(0, 12);

  const recentPeriodicals = recentRows
    .filter((row) => isMagazineObject(row.object_type))
    .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
    .filter((item): item is GridItem => Boolean(item))
    .slice(0, 8);

  const designerCounts = new Map<string, { id: string; name: string; slug: string | null; count: number }>();
  for (const row of recentRows) {
    const seenInRow = new Set<string>();
    for (const entityRow of row.book_entities ?? []) {
      const role = String(entityRow?.role ?? "").trim().toLowerCase();
      if (role !== "designer" && role !== "design") continue;
      const entity = entityRow?.entity;
      const entityId = String(entity?.id ?? "").trim();
      const name = String(entity?.name ?? "").trim();
      if (!entityId || !name || seenInRow.has(entityId)) continue;
      seenInRow.add(entityId);
      const current = designerCounts.get(entityId) ?? { id: entityId, name, slug: String(entity?.slug ?? "").trim() || null, count: 0 };
      current.count += 1;
      designerCounts.set(entityId, current);
    }
  }

  const topDesigner = [...designerCounts.values()]
    .filter((entry) => entry.count >= 4)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0] ?? null;

  const designerItems = topDesigner
    ? recentRows
        .filter((row) =>
          (row.book_entities ?? []).some((entityRow) => {
            const role = String(entityRow?.role ?? "").trim().toLowerCase();
            return (role === "designer" || role === "design") && String(entityRow?.entity?.id ?? "") === topDesigner.id;
          })
        )
        .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
        .filter((item): item is GridItem => Boolean(item))
        .slice(0, 8)
    : [];

  const groupCounts = new Map<string, number>();
  for (const row of recentRows) {
    const label = String(row.group_label ?? "").trim();
    if (!label) continue;
    groupCounts.set(label, (groupCounts.get(label) ?? 0) + 1);
  }
  const topGroupLabel =
    [...groupCounts.entries()]
      .filter(([, count]) => count >= 4)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

  const groupItems = topGroupLabel
    ? recentRows
        .filter((row) => String(row.group_label ?? "").trim() === topGroupLabel)
        .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
        .filter((item): item is GridItem => Boolean(item))
        .slice(0, 8)
    : [];

  return {
    recentItems,
    recentPeriodicals,
    designerHeading: topDesigner ? { name: topDesigner.name, slug: topDesigner.slug } : null,
    designerItems,
    groupHeading: topGroupLabel ? { label: topGroupLabel, slug: slugify(topGroupLabel) } : null,
    groupItems,
  };
}

function ExploreModule({
  id,
  title,
  href,
  items,
}: {
  id?: string;
  title: React.ReactNode;
  href?: string | null;
  items: GridItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section id={id} style={{ marginTop: "var(--space-xl)" }}>
      <hr className="divider" />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: "var(--space-lg)" }}>
        <div>{title}</div>
        {href ? (
          <Link href={href} className="text-muted" style={{ textDecoration: "none" }}>
            View all
          </Link>
        ) : null}
      </div>
      <EntityBookGrid items={items} />
    </section>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const loginParam = Array.isArray(params.login) ? params.login[0] : params.login;
  const showLogin = String(loginParam ?? "").trim() === "1";
  const data = await loadExploreData();

  return (
    <main className="container" style={{ paddingBottom: "var(--space-2xl)" }}>
      <section style={{ paddingTop: "var(--space-lg)" }}>
        <div className="text-muted">Explore</div>
        <h1 style={{ fontSize: "clamp(28px, 4vw, 48px)", lineHeight: 1.05, margin: "var(--space-sm) 0 0" }}>
          Public additions, runs, and connections across {SITE_TITLE}.
        </h1>
        <div className="text-muted" style={{ marginTop: "var(--space-md)", maxWidth: 760 }}>
          Browse recent objects, periodicals, and related clusters without dropping into the working library.
        </div>
        <div className="row" style={{ gap: "var(--space-md)", marginTop: "var(--space-md)" }}>
          <Link href="#recent-additions">Recent additions</Link>
          <Link href="/?login=1#signin">Sign in</Link>
        </div>
      </section>

      <ExploreAuthPanel open={showLogin} />

      <ExploreModule id="recent-additions" title="Recent additions" items={data?.recentItems ?? []} />
      <ExploreModule title="Recent periodicals" items={data?.recentPeriodicals ?? []} />
      <ExploreModule
        title={data?.designerHeading ? <>Designed by {data.designerHeading.name}</> : "Designed by"}
        href={data?.designerHeading?.slug ? `/entity/${encodeURIComponent(data.designerHeading.slug)}` : null}
        items={data?.designerItems ?? []}
      />
      <ExploreModule
        title={data?.groupHeading ? <>From the run: {data.groupHeading.label}</> : "From the run"}
        href={data?.groupHeading ? `/group/${encodeURIComponent(data.groupHeading.slug)}` : null}
        items={data?.groupItems ?? []}
      />
    </main>
  );
}
