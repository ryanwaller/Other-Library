import Link from "next/link";
import type { Metadata } from "next";
import CoverImage, { type CoverCrop } from "../components/CoverImage";
import EntityBookGrid, { type GridItem } from "./entity/[slug]/EntityBookGrid";
import ExploreColumns from "./ExploreColumns";
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
  entityId: string;
  role: "author" | "designer" | "publisher" | "performer" | "tag" | "material";
  name: string;
  slug: string | null;
  count: number;
  items: GridItem[];
  heading?: string | null;
};

type ExploreUserHeading = {
  username: string;
  avatarUrl: string | null;
};

const EXPLORE_MAIN_MODULE_ITEMS = 8;
const DEFAULT_EXPLORE_RAIL_MODULE_COUNT = 3;
const EXPLORE_RAIL_ITEMS = 6;
const EXPLORE_RAIL_SURFACE = "explore_right_rail";
const EXPLORE_RAIL_ROLE_PRIORITY: Array<EntityCluster["role"]> = ["designer", "author", "publisher", "performer"];

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

function toRecentGridItem(
  row: ExploreBookRow,
  usernameByOwnerId: Map<string, string>,
  avatarUrlByOwnerId: Map<string, string | null>,
  signedMap: Record<string, string>
): GridItem | null {
  const item = toGridItem(row, usernameByOwnerId, signedMap);
  if (!item) return null;
  const username = usernameByOwnerId.get(row.owner_id);
  return {
    ...item,
    owner: username
      ? {
          username,
          href: `/u/${encodeURIComponent(username)}`,
          avatarUrl: avatarUrlByOwnerId.get(row.owner_id) ?? null,
          prefix: "Added by",
        }
      : null,
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

function railHeading(role: EntityCluster["role"], name: string): string {
  if (role === "designer") return `Designed by ${name}`;
  if (role === "author") return `Authored by ${name}`;
  if (role === "publisher") return `Published by ${name}`;
  if (role === "tag") return `Tagged ${name}`;
  if (role === "material") return `Material: ${name}`;
  return `Performed by ${name}`;
}

function rowMatchesPinnedCluster(row: ExploreBookRow, entityId: string, role: EntityCluster["role"]): boolean {
  if (role === "tag") {
    return (row.book_entities ?? []).some((entityRow) => {
      const entityRole = String(entityRow?.role ?? "").trim().toLowerCase();
      return (entityRole === "tag" || entityRole === "category") && String(entityRow?.entity?.id ?? "") === entityId;
    });
  }
  if (role === "material") {
    return (row.book_entities ?? []).some((entityRow) => {
      const entityRole = String(entityRow?.role ?? "").trim().toLowerCase();
      return entityRole === "material" && String(entityRow?.entity?.id ?? "") === entityId;
    });
  }
  return (row.book_entities ?? []).some((entityRow) => {
    const entityRole = String(entityRow?.role ?? "").trim().toLowerCase();
    if (role === "designer") return (entityRole === "designer" || entityRole === "design") && String(entityRow?.entity?.id ?? "") === entityId;
    return entityRole === role && String(entityRow?.entity?.id ?? "") === entityId;
  });
}

async function loadExploreData() {
  const supabase = getServerSupabase();
  const admin = getSupabaseAdmin();
  const db = admin ?? supabase;
  if (!db) return null;

  const publicProfilesRes = await db
    .from("profiles")
    .select("id,username,avatar_path")
    .eq("visibility", "public")
    .limit(500);

  const publicProfiles = (publicProfilesRes.data ?? []) as Array<{ id: string; username: string; avatar_path: string | null }>;
  const publicOwnerIds = publicProfiles.map((row) => row.id).filter(Boolean);
  if (publicOwnerIds.length === 0) {
    return {
      recentItems: [] as GridItem[],
      recentRecords: [] as GridItem[],
      recentPeriodicals: [] as GridItem[],
      recentOwnerHeading: null as ExploreUserHeading | null,
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
      recentOwnerHeading: null as ExploreUserHeading | null,
      recentOwnerItems: [] as GridItem[],
      editorHeading: null as { name: string; slug: string | null } | null,
      editorItems: [] as GridItem[],
      groupHeading: null as { label: string; slug: string } | null,
      groupItems: [] as GridItem[],
      railClusters: [] as EntityCluster[],
    };
  }

  const usernameByOwnerId = new Map(publicProfiles.map((row) => [row.id, row.username] as const));
  const avatarUrlByOwnerId = new Map<string, string | null>();

  const mediaPaths = [...new Set(recentRows.map((row) => coverStoragePath(row)).filter((path): path is string => Boolean(path)))];
  const signedMap: Record<string, string> = {};
  if (mediaPaths.length > 0) {
    const signedRes = await db.storage.from("user-book-media").createSignedUrls(mediaPaths, 60 * 30);
    for (const row of signedRes.data ?? []) {
      if (row.path && row.signedUrl) signedMap[row.path] = row.signedUrl;
    }
  }

  const avatarPaths = [...new Set(publicProfiles.map((row) => String(row.avatar_path ?? "").trim()).filter(Boolean))];
  const avatarSignedMap: Record<string, string> = {};
  if (avatarPaths.length > 0) {
    const signedRes = await db.storage.from("avatars").createSignedUrls(avatarPaths, 60 * 30);
    for (const row of signedRes.data ?? []) {
      if (row.path && row.signedUrl) avatarSignedMap[row.path] = row.signedUrl;
    }
  }
  for (const profile of publicProfiles) {
    const avatarPath = String(profile.avatar_path ?? "").trim();
    avatarUrlByOwnerId.set(profile.id, avatarPath ? avatarSignedMap[avatarPath] ?? null : null);
  }

  const recentRecords = recentRows
    .filter((row) => String(row.object_type ?? "").trim().toLowerCase() === "music")
    .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
    .filter((item): item is GridItem => Boolean(item))
    .slice(0, EXPLORE_MAIN_MODULE_ITEMS);

  const recentPeriodicals = recentRows
    .filter((row) => isMagazineObject(row.object_type))
    .map((row) => toRecentGridItem(row, usernameByOwnerId, avatarUrlByOwnerId, signedMap))
    .filter((item): item is GridItem => Boolean(item))
    .slice(0, EXPLORE_MAIN_MODULE_ITEMS);

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
        .slice(0, EXPLORE_MAIN_MODULE_ITEMS)
    : [];

  const ownerCounts = new Map<string, number>();
  const ownerLatestCreatedAt = new Map<string, string>();
  for (const row of recentRows) {
    ownerCounts.set(row.owner_id, (ownerCounts.get(row.owner_id) ?? 0) + 1);
    const currentLatest = ownerLatestCreatedAt.get(row.owner_id);
    if (!currentLatest || String(row.created_at ?? "") > currentLatest) {
      ownerLatestCreatedAt.set(row.owner_id, String(row.created_at ?? ""));
    }
  }
  const topOwnerId =
    [...ownerCounts.entries()]
      .filter(([ownerId, count]) => count >= 6 && usernameByOwnerId.has(ownerId))
      .sort((a, b) => {
        const aLatest = ownerLatestCreatedAt.get(a[0]) ?? "";
        const bLatest = ownerLatestCreatedAt.get(b[0]) ?? "";
        return bLatest.localeCompare(aLatest) || b[1] - a[1];
      })[0]?.[0] ?? null;

  const recentOwnerHeading = topOwnerId
    ? {
        username: usernameByOwnerId.get(topOwnerId)!,
        avatarUrl: avatarUrlByOwnerId.get(topOwnerId) ?? null,
      }
    : null;
  const recentOwnerItems = topOwnerId
    ? recentRows
        .filter((row) => row.owner_id === topOwnerId)
        .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
        .filter((item): item is GridItem => Boolean(item))
        .slice(0, EXPLORE_MAIN_MODULE_ITEMS)
    : [];

  const recentItems = recentRows
    .filter((row) => !topOwnerId || row.owner_id !== topOwnerId)
    .map((row) => toRecentGridItem(row, usernameByOwnerId, avatarUrlByOwnerId, signedMap))
    .filter((item): item is GridItem => Boolean(item))
    .slice(0, EXPLORE_MAIN_MODULE_ITEMS);

  function clusterItemsFor(entityId: string, role: "author" | "designer" | "publisher" | "performer") {
    return recentRows
      .filter((row) => rowMatchesPinnedCluster(row, entityId, role))
      .map((row) => toGridItem(row, usernameByOwnerId, signedMap))
      .filter((item): item is GridItem => Boolean(item))
      .slice(0, EXPLORE_RAIL_ITEMS);
  }

  const railCandidates = [
    ...[...designerCounts.values()],
    ...[...authorCounts.values()],
    ...[...publisherCounts.values()],
    ...[...performerCounts.values()],
  ]
    .filter((entry) => entry.count >= 3)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map((entry) => ({
      entityId: entry.id,
      role: entry.role,
      name: entry.name,
      slug: entry.slug,
      count: entry.count,
      items: clusterItemsFor(entry.id, entry.role),
      heading: null,
    }))
    .filter((entry) => entry.items.length > 0);

  const railClusters: EntityCluster[] = [];
  const seenRailKeys = new Set<string>();
  for (const role of EXPLORE_RAIL_ROLE_PRIORITY) {
    const candidate = railCandidates.find((entry) => entry.role === role && !seenRailKeys.has(`${entry.role}:${entry.entityId}`));
    if (!candidate) continue;
    railClusters.push(candidate);
    seenRailKeys.add(`${candidate.role}:${candidate.entityId}`);
    if (railClusters.length >= DEFAULT_EXPLORE_RAIL_MODULE_COUNT) break;
  }
  if (railClusters.length < DEFAULT_EXPLORE_RAIL_MODULE_COUNT) {
    for (const candidate of railCandidates) {
      const key = `${candidate.role}:${candidate.entityId}`;
      if (seenRailKeys.has(key)) continue;
      railClusters.push(candidate);
      seenRailKeys.add(key);
      if (railClusters.length >= DEFAULT_EXPLORE_RAIL_MODULE_COUNT) break;
    }
  }

  const railSlotRes = await db
    .from("homepage_feature_slots")
    .select("slot_index,mode,role,title_override,entity:entities(id,name,slug)")
    .eq("surface", EXPLORE_RAIL_SURFACE)
    .order("slot_index", { ascending: true });

  const pinnedSlotRows = (Array.isArray(railSlotRes.data) ? railSlotRes.data : []).filter(
    (row) => String((row as any).mode ?? "").trim().toLowerCase() === "pinned"
  );

  let allVisibleRows = recentRows;
  if (pinnedSlotRows.length > 0) {
    const broadRes = await db
      .from("user_books")
      .select(BOOK_SELECT)
      .in("owner_id", publicOwnerIds)
      .neq("visibility", "followers_only")
      .order("created_at", { ascending: false })
      .limit(2000);

    const broadRows = uniqueById((broadRes.data ?? []) as unknown as ExploreBookRow[]);
    if (broadRows.length > 0) {
      const missingMediaPaths = [
        ...new Set(
          broadRows
            .map((row) => coverStoragePath(row))
            .filter((path): path is string => Boolean(path) && !signedMap[path])
        ),
      ];
      if (missingMediaPaths.length > 0) {
        const signedRes = await db.storage.from("user-book-media").createSignedUrls(missingMediaPaths, 60 * 30);
        for (const row of signedRes.data ?? []) {
          if (row.path && row.signedUrl) signedMap[row.path] = row.signedUrl;
        }
      }
      allVisibleRows = broadRows;
    }
  }

  const autoQueue = [...railClusters];
  const usedKeys = new Set<string>();
  const railBySlot = new Map<number, EntityCluster>();

  const takeNextAuto = () => {
    while (autoQueue.length > 0) {
      const next = autoQueue.shift()!;
      const key = `${next.role}:${next.entityId}`;
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      return next;
    }
    return null;
  };

  const slotRows = (Array.isArray(railSlotRes.data) ? railSlotRes.data : [])
    .filter((row) => Number.isFinite(Number((row as any).slot_index)) && Number((row as any).slot_index) >= 1)
    .sort((a, b) => Number((a as any).slot_index) - Number((b as any).slot_index));
  const railSlotCount = slotRows.length > 0 ? slotRows.length : DEFAULT_EXPLORE_RAIL_MODULE_COUNT;
  for (const row of slotRows) {
    const slotIndex = Number(row.slot_index);
    if (!Number.isFinite(slotIndex) || slotIndex < 1 || slotIndex > railSlotCount) continue;
    const mode = String((row as any).mode ?? "").trim().toLowerCase();
    if (mode !== "pinned") continue;
    const roleValue = String((row as any).role ?? "").trim().toLowerCase();
    const role =
      roleValue === "designer" ||
      roleValue === "author" ||
      roleValue === "publisher" ||
      roleValue === "performer" ||
      roleValue === "tag" ||
      roleValue === "material"
        ? (roleValue as EntityCluster["role"])
        : null;
    const entity = (row as any).entity;
    const entityId = String(entity?.id ?? "").trim();
    const name = String(entity?.name ?? "").trim();
    const slug = String(entity?.slug ?? "").trim() || null;
    if (!role || !entityId || !name) continue;
    const items = allVisibleRows
      .filter((bookRow) => rowMatchesPinnedCluster(bookRow, entityId, role))
      .map((bookRow) => toGridItem(bookRow, usernameByOwnerId, signedMap))
      .filter((item): item is GridItem => Boolean(item))
      .slice(0, EXPLORE_RAIL_ITEMS);
    if (items.length === 0) continue;
    const key = `${role}:${entityId}`;
    usedKeys.add(key);
    railBySlot.set(slotIndex, {
      entityId,
      role,
      name,
      slug,
      count: items.length,
      items,
      heading: String((row as any).title_override ?? "").trim() || railHeading(role, name),
    });
  }

  const mergedRailClusters: EntityCluster[] = [];
  for (let slot = 1; slot <= railSlotCount; slot += 1) {
    const pinned = railBySlot.get(slot);
    if (pinned) {
      mergedRailClusters.push(pinned);
      continue;
    }
    const automatic = takeNextAuto();
    if (automatic) mergedRailClusters.push(automatic);
  }

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
        .slice(0, EXPLORE_MAIN_MODULE_ITEMS)
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
    railClusters: mergedRailClusters,
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
    <section id={id} className="om-explore-module">
      <hr className="divider" />
      <div className="row om-explore-module-header" style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: "var(--space-lg)" }}>
        <div>{title}</div>
        {href ? (
          <Link href={href} className="text-muted" style={{ textDecoration: "none" }}>
            View all
          </Link>
        ) : null}
      </div>
      <EntityBookGrid items={items} gridClassName="om-explore-main-grid" />
    </section>
  );
}

function ExploreUserLink({
  username,
  avatarUrl,
}: {
  username: string;
  avatarUrl: string | null;
}) {
  return (
    <Link
      href={`/u/${encodeURIComponent(username)}`}
      className="om-explore-user-link"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        textDecoration: "none",
        color: "inherit",
        ["--avatar-size" as any]: "18px",
      }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" src={avatarUrl} className="om-avatar-img om-explore-avatar-img" />
      ) : (
        <div className="om-avatar-img om-explore-avatar-img" style={{ background: "var(--bg-muted)" }} />
      )}
      <span className="om-explore-user-link-text">{username}</span>
    </Link>
  );
}

function ExploreUserHeading({
  prefix,
  username,
  avatarUrl,
}: {
  prefix: string;
  username: string;
  avatarUrl: string | null;
}) {
  return (
    <div className="om-explore-user-heading" style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
      <span className="om-explore-user-heading-prefix">{prefix}</span>
      <ExploreUserLink username={username} avatarUrl={avatarUrl} />
    </div>
  );
}

function ExploreRailModule({
  cluster,
}: {
  cluster: EntityCluster;
}) {
  if (cluster.items.length === 0) return null;
  const heading = cluster.heading ?? railHeading(cluster.role, cluster.name);
  return (
    <section className="om-explore-module">
      <hr className="divider" />
      <div className="row om-explore-module-header om-explore-rail-module-header" style={{ justifyContent: "space-between", alignItems: "flex-start", marginTop: "var(--space-lg)", gap: "var(--space-md)", flexWrap: "nowrap" }}>
        <div className="om-explore-rail-module-title" style={{ minWidth: 0, flex: "1 1 auto" }}>{heading}</div>
        {cluster.slug ? (
          <Link
            href={`/entity/${encodeURIComponent(cluster.slug)}`}
            className="text-muted om-explore-rail-module-more"
            style={{ textDecoration: "none", flex: "0 0 auto", alignSelf: "flex-start" }}
          >
            More
          </Link>
        ) : null}
      </div>
      <div className="om-explore-rail-grid om-explore-module-content">
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
    <main className="container" style={{ paddingBottom: "calc(var(--space-xl) + var(--space-32) + var(--space-md))" }}>
      <div style={{ paddingTop: "var(--space-md)" }}>
        <ExploreColumns
          main={
            <>
            <ExploreModule id="recent-additions" title="Recent additions" items={data?.recentItems ?? []} />
            <ExploreModule title="Recent records" items={data?.recentRecords ?? []} />
            <ExploreModule title="Recent periodicals" items={data?.recentPeriodicals ?? []} />
            <ExploreModule
              title={
                data?.recentOwnerHeading ? (
                  <ExploreUserHeading
                    prefix="Recently added by"
                    username={data.recentOwnerHeading.username}
                    avatarUrl={data.recentOwnerHeading.avatarUrl}
                  />
                ) : (
                  "Recently added by"
                )
              }
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
            </>
          }
          rail={
            <>
            {(data?.railClusters ?? []).map((cluster) => (
              <ExploreRailModule key={`${cluster.role}-${cluster.slug ?? cluster.name}`} cluster={cluster} />
            ))}
            </>
          }
        />
      </div>
    </main>
  );
}
