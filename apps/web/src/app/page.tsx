import Link from "next/link";
import type { Metadata } from "next";
import CoverImage, { type CoverCrop } from "../components/CoverImage";
import EntityBookGrid, { type GridItem } from "./entity/[slug]/EntityBookGrid";
import { effectiveAuthorsFor } from "../lib/book";
import { formatIssueDisplay, isMagazineObject } from "../lib/magazine";
import { parseMusicMetadata } from "../lib/music";
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

type EntityCluster = {
  role: "author" | "designer" | "publisher" | "performer";
  name: string;
  slug: string | null;
  count: number;
  items: GridItem[];
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

function toRecentGridItem(row: ExploreBookRow, usernameByOwnerId: Map<string, string>, signedMap: Record<string, string>): GridItem | null {
  const item = toGridItem(row, usernameByOwnerId, signedMap);
  if (!item) return null;
  const username = usernameByOwnerId.get(row.owner_id);
  return {
    ...item,
    tertiaryLine: username ? `Added by ${username}` : null,
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

  const publicProfilesRes = await db
    .from("profiles")
    .select("id,username")
    .eq("visibility", "public")
    .limit(500);

  const publicProfiles = (publicProfilesRes.data ?? []) as Array<{ id: string; username: string }>;
  const publicOwnerIds = publicProfiles.map((row) => row.id).filter(Boolean);
  if (publicOwnerIds.length === 0) {
    return {
      recentItems: [] as GridItem[],
      recentRecords: [] as GridItem[],
      recentPeriodicals: [] as GridItem[],
      recentOwnerHeading: null as { username: string } | null,
      recentOwnerItems: [] as GridItem[],
      editorHeading: null as { name: string; slug: string | null } | null,
      editorItems: [] as GridItem[],
      groupHeading: null as { label: string; slug: string } | null,
      groupItems: [] as GridItem[],
      railClusters: [] as EntityCluster[],
    };
  }

  const recentRes = await db
    .from("user_books")
    .select(BOOK_SELECT)
    .in("owner_id", publicOwnerIds)
    .neq("visibility", "followers_only")
    .order("created_at", { ascending: false })
    .limit(120);

  const recentRows = uniqueById((recentRes.data ?? []) as unknown as ExploreBookRow[]);
  if (recentRows.length === 0) {
    return {
      recentItems: [] as GridItem[],
      recentRecords: [] as GridItem[],
      recentPeriodicals: [] as GridItem[],
      recentOwnerHeading: null as { username: string } | null,
      recentOwnerItems: [] as GridItem[],
      editorHeading: null as { name: string; slug: string | null } | null,
      editorItems: [] as GridItem[],
      groupHeading: null as { label: string; slug: string } | null,
      groupItems: [] as GridItem[],
      railClusters: [] as EntityCluster[],
    };
  }

  const usernameByOwnerId = new Map(publicProfiles.map((row) => [row.id, row.username] as const));

  const mediaPaths = [...new Set(recentRows.map((row) => coverStoragePath(row)).filter((path): path is string => Boolean(path)))];
  const signedMap: Record<string, string> = {};
  if (mediaPaths.length > 0) {
    const signedRes = await db.storage.from("user-book-media").createSignedUrls(mediaPaths, 60 * 30);
    for (const row of signedRes.data ?? []) {
      if (row.path && row.signedUrl) signedMap[row.path] = row.signedUrl;
    }
  }

  const recentRecords = recentRows
    .filter((row) => String(row.object_type ?? "").trim().toLowerCase() === "music")
    .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
    .filter((item): item is GridItem => Boolean(item))
    .slice(0, 8);

  const recentPeriodicals = recentRows
    .filter((row) => isMagazineObject(row.object_type))
    .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
    .filter((item): item is GridItem => Boolean(item))
    .slice(0, 8);

  const designerCounts = new Map<string, { id: string; name: string; slug: string | null; count: number; role: "designer" }>();
  const editorCounts = new Map<string, { id: string; name: string; slug: string | null; count: number }>();
  const authorCounts = new Map<string, { id: string; name: string; slug: string | null; count: number; role: "author" }>();
  const publisherCounts = new Map<string, { id: string; name: string; slug: string | null; count: number; role: "publisher" }>();
  const performerCounts = new Map<string, { id: string; name: string; slug: string | null; count: number; role: "performer" }>();

  function incrementEntityCount<T extends "author" | "designer" | "publisher" | "performer">(
    map: Map<string, { id: string; name: string; slug: string | null; count: number; role: T }>,
    entityId: string,
    name: string,
    slug: string | null,
    role: T
  ) {
    const current = map.get(entityId) ?? { id: entityId, name, slug, count: 0, role };
    current.count += 1;
    map.set(entityId, current);
  }

  for (const row of recentRows) {
    const seenInRow = new Set<string>();
    for (const entityRow of row.book_entities ?? []) {
      const role = String(entityRow?.role ?? "").trim().toLowerCase();
      const entity = entityRow?.entity;
      const entityId = String(entity?.id ?? "").trim();
      const name = String(entity?.name ?? "").trim();
      if (!entityId || !name || seenInRow.has(entityId)) continue;
      seenInRow.add(entityId);
      const slug = String(entity?.slug ?? "").trim() || null;
      if (role === "designer" || role === "design") incrementEntityCount(designerCounts, entityId, name, slug, "designer");
      if (role === "editor") editorCounts.set(entityId, { id: entityId, name, slug, count: (editorCounts.get(entityId)?.count ?? 0) + 1 });
      if (role === "author") incrementEntityCount(authorCounts, entityId, name, slug, "author");
      if (role === "publisher") incrementEntityCount(publisherCounts, entityId, name, slug, "publisher");
      if (role === "performer") incrementEntityCount(performerCounts, entityId, name, slug, "performer");
    }
  }

  const topEditor = [...editorCounts.values()]
    .filter((entry) => entry.count >= 4)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0] ?? null;

  const editorItems = topEditor
    ? recentRows
        .filter((row) =>
          (row.book_entities ?? []).some((entityRow) => {
            const role = String(entityRow?.role ?? "").trim().toLowerCase();
            return role === "editor" && String(entityRow?.entity?.id ?? "") === topEditor.id;
          })
        )
        .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
        .filter((item): item is GridItem => Boolean(item))
        .slice(0, 8)
    : [];

  const ownerCounts = new Map<string, number>();
  for (const row of recentRows) {
    ownerCounts.set(row.owner_id, (ownerCounts.get(row.owner_id) ?? 0) + 1);
  }
  const topOwnerId =
    [...ownerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .find(([ownerId, count]) => count >= 3 && usernameByOwnerId.has(ownerId))?.[0] ?? null;

  const recentOwnerHeading = topOwnerId ? { username: usernameByOwnerId.get(topOwnerId)! } : null;
  const recentOwnerItems = topOwnerId
    ? recentRows
        .filter((row) => row.owner_id === topOwnerId)
        .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
        .filter((item): item is GridItem => Boolean(item))
        .slice(0, 8)
    : [];

  const recentItems = recentRows
    .filter((row) => !topOwnerId || row.owner_id !== topOwnerId)
    .map((row) => toRecentGridItem(row, usernameByOwnerId, signedMap))
    .filter((item): item is GridItem => Boolean(item))
    .slice(0, 12);

  function clusterItemsFor(entityId: string, role: "author" | "designer" | "publisher" | "performer") {
    return recentRows
      .filter((row) =>
        (row.book_entities ?? []).some((entityRow) => {
          const entityRole = String(entityRow?.role ?? "").trim().toLowerCase();
          if (role === "designer") return (entityRole === "designer" || entityRole === "design") && String(entityRow?.entity?.id ?? "") === entityId;
          return entityRole === role && String(entityRow?.entity?.id ?? "") === entityId;
        })
      )
      .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
      .filter((item): item is GridItem => Boolean(item))
      .slice(0, 4);
  }

  const railClusters = [
    ...[...designerCounts.values()],
    ...[...authorCounts.values()],
    ...[...publisherCounts.values()],
    ...[...performerCounts.values()],
  ]
    .filter((entry) => entry.count >= 3)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map((entry) => ({
      role: entry.role,
      name: entry.name,
      slug: entry.slug,
      count: entry.count,
      items: clusterItemsFor(entry.id, entry.role),
    }))
    .filter((entry) => entry.items.length > 0);

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
    recentRecords,
    recentPeriodicals,
    recentOwnerHeading,
    recentOwnerItems,
    editorHeading: topEditor ? { name: topEditor.name, slug: topEditor.slug } : null,
    editorItems,
    groupHeading: topGroupLabel ? { label: topGroupLabel, slug: slugify(topGroupLabel) } : null,
    groupItems,
    railClusters,
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

function ExploreRailModule({
  cluster,
}: {
  cluster: EntityCluster;
}) {
  if (cluster.items.length === 0) return null;
  const heading =
    cluster.role === "designer"
      ? `Designed by ${cluster.name}`
      : cluster.role === "author"
        ? `Authored by ${cluster.name}`
        : cluster.role === "publisher"
          ? `Published by ${cluster.name}`
          : `Performed by ${cluster.name}`;
  return (
    <section style={{ marginTop: "var(--space-xl)" }}>
      <hr className="divider" />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: "var(--space-lg)", gap: "var(--space-md)" }}>
        <div>{heading}</div>
        {cluster.slug ? (
          <Link href={`/entity/${encodeURIComponent(cluster.slug)}`} className="text-muted" style={{ textDecoration: "none" }}>
            More
          </Link>
        ) : null}
      </div>
      <div className="om-explore-rail-grid" style={{ marginTop: "var(--space-md)" }}>
        {cluster.items.map((item) => (
          <div key={`${cluster.role}-${cluster.name}-${item.id}`}>
            {item.href ? (
              <Link href={item.href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
                  <CoverImage
                    alt={item.title}
                    src={item.coverUrl}
                    cropData={item.coverCrop}
                    style={{ width: "100%", height: "auto", display: "block" }}
                    objectFit="contain"
                  />
                </div>
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function HomePage() {
  const data = await loadExploreData();

  return (
    <main className="container" style={{ paddingBottom: "var(--space-2xl)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: "var(--space-xl)",
          paddingTop: "var(--space-md)",
        }}
      >
        <div className="om-explore-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "var(--space-xl)" }}>
          <div className="om-explore-main" style={{ minWidth: 0 }}>
            <ExploreModule id="recent-additions" title="Recent additions" items={data?.recentItems ?? []} />
            <ExploreModule title="Recent records" items={data?.recentRecords ?? []} />
            <ExploreModule title="Recent periodicals" items={data?.recentPeriodicals ?? []} />
            <ExploreModule
              title={data?.recentOwnerHeading ? <>Recently added by {data.recentOwnerHeading.username}</> : "Recently added by"}
              href={data?.recentOwnerHeading ? `/u/${encodeURIComponent(data.recentOwnerHeading.username)}` : null}
              items={data?.recentOwnerItems ?? []}
            />
            <ExploreModule
              title={data?.editorHeading ? <>Edited by {data.editorHeading.name}</> : "Edited by"}
              href={data?.editorHeading?.slug ? `/entity/${encodeURIComponent(data.editorHeading.slug)}` : null}
              items={data?.editorItems ?? []}
            />
            <ExploreModule
              title={data?.groupHeading ? <>From the run: {data.groupHeading.label}</> : "From the run"}
              href={data?.groupHeading ? `/group/${encodeURIComponent(data.groupHeading.slug)}` : null}
              items={data?.groupItems ?? []}
            />
          </div>

          <aside className="om-explore-rail" style={{ minWidth: 0 }}>
            {(data?.railClusters ?? []).map((cluster) => (
              <ExploreRailModule key={`${cluster.role}-${cluster.slug ?? cluster.name}`} cluster={cluster} />
            ))}
          </aside>
        </div>
      </div>
    </main>
  );
}
