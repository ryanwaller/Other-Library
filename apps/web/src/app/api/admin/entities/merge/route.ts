import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

type SearchEntity = {
  id: string;
  name: string;
  slug: string | null;
  count: number;
};

type EntityRoleGroupKey =
  | "author"
  | "contributor"
  | "editor"
  | "designer"
  | "publisher"
  | "printer"
  | "subject"
  | "material"
  | "tag"
  | "category"
  | "other";

type GroupedEntity = SearchEntity & {
  rawRoles: string[];
};

type EntityRoleGroup = {
  key: EntityRoleGroupKey;
  label: string;
  entities: GroupedEntity[];
};

const ROLE_GROUP_ORDER: EntityRoleGroupKey[] = [
  "author",
  "contributor",
  "editor",
  "designer",
  "publisher",
  "printer",
  "subject",
  "material",
  "tag",
  "category",
  "other",
];

const ROLE_GROUP_LABELS: Record<EntityRoleGroupKey, string> = {
  author: "Author",
  contributor: "Contributor",
  editor: "Editor",
  designer: "Design",
  publisher: "Publisher",
  printer: "Printer",
  subject: "Subject",
  material: "Material",
  tag: "Tag",
  category: "Category",
  other: "Other",
};

function normalizeRoleGroup(role: string): EntityRoleGroupKey {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "author") return "author";
  if (normalized === "editor") return "editor";
  if (normalized === "publisher") return "publisher";
  if (normalized === "printer") return "printer";
  if (normalized === "subject") return "subject";
  if (normalized === "material") return "material";
  if (normalized === "tag") return "tag";
  if (normalized === "category") return "category";
  if (normalized === "designer" || normalized === "design" || normalized === "art direction" || normalized === "artwork" || normalized === "photography") {
    return "designer";
  }
  if (
    normalized === "performer" ||
    normalized === "composer" ||
    normalized === "producer" ||
    normalized === "engineer" ||
    normalized === "mastering" ||
    normalized === "featured artist" ||
    normalized === "arranger" ||
    normalized === "conductor" ||
    normalized === "orchestra"
  ) {
    return "contributor";
  }
  return "other";
}

async function loadGroupedEntities(admin: any, q: string): Promise<EntityRoleGroup[]> {
  const rows: Array<{ role: string; entity_id: string; entity: { id: string; name: string; slug: string | null } | null }> = [];
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const res = await admin
      .from("book_entities")
      .select("role,entity_id,entity:entities(id,name,slug)")
      .range(from, from + pageSize - 1);
    if (res.error) throw new Error(res.error.message);
    const chunk = (res.data ?? []) as Array<{ role: string; entity_id: string; entity: { id: string; name: string; slug: string | null } | null }>;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  const grouped = new Map<EntityRoleGroupKey, Map<string, GroupedEntity>>();
  const query = q.trim().toLowerCase();
  for (const row of rows) {
    const entityId = String(row.entity_id ?? "").trim();
    const entityName = String(row.entity?.name ?? "").trim();
    if (!entityId || !entityName) continue;
    if (query && !entityName.toLowerCase().includes(query)) continue;
    const groupKey = normalizeRoleGroup(row.role);
    if (!grouped.has(groupKey)) grouped.set(groupKey, new Map());
    const bucket = grouped.get(groupKey)!;
    const existing = bucket.get(entityId);
    if (existing) {
      existing.count += 1;
      if (!existing.rawRoles.includes(String(row.role ?? ""))) existing.rawRoles.push(String(row.role ?? ""));
      continue;
    }
    bucket.set(entityId, {
      id: entityId,
      name: entityName,
      slug: row.entity?.slug ? String(row.entity.slug) : null,
      count: 1,
      rawRoles: [String(row.role ?? "")].filter(Boolean),
    });
  }

  return ROLE_GROUP_ORDER.map((key) => ({
    key,
    label: ROLE_GROUP_LABELS[key],
    entities: [...(grouped.get(key)?.values() ?? [])].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    }),
  })).filter((group) => group.entities.length > 0);
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") ?? "").trim();
    const sections = await loadGroupedEntities(admin, q);
    return NextResponse.json({ sections });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const sourceIds = Array.from(
      new Set(
        [
          ...((Array.isArray(body?.source_entity_ids) ? body.source_entity_ids : []).map((value: unknown) => String(value ?? "").trim())),
          String(body?.source_entity_id ?? "").trim(),
        ].filter(Boolean)
      )
    );
    const targetId = String(body?.target_entity_id ?? "").trim();

    if (sourceIds.length === 0 || !targetId) return NextResponse.json({ error: "source_and_target_required" }, { status: 400 });
    if (sourceIds.includes(targetId)) return NextResponse.json({ error: "source_and_target_must_differ" }, { status: 400 });

    const entitiesRes = await admin
      .from("entities")
      .select("id,name,slug")
      .in("id", [...sourceIds, targetId]);
    if (entitiesRes.error) return NextResponse.json({ error: entitiesRes.error.message }, { status: 500 });

    const entities = (entitiesRes.data ?? []) as Array<{ id: string; name: string; slug: string }>;
    const target = entities.find((row) => String(row.id) === targetId);
    const sources = entities.filter((row) => sourceIds.includes(String(row.id)));
    if (!target || sources.length !== sourceIds.length) return NextResponse.json({ error: "entity_not_found" }, { status: 404 });

    for (const source of sources) {
      const sourceLinksRes = await admin
        .from("book_entities")
        .select("user_book_id,role,position")
        .eq("entity_id", source.id)
        .limit(10000);
      if (sourceLinksRes.error) return NextResponse.json({ error: sourceLinksRes.error.message }, { status: 500 });

      const sourceLinks = (sourceLinksRes.data ?? []) as Array<{ user_book_id: number; role: string; position: number | null }>;
      if (sourceLinks.length > 0) {
        const upsertRes = await admin
          .from("book_entities")
          .upsert(
            sourceLinks.map((row) => ({
              user_book_id: row.user_book_id,
              entity_id: targetId,
              role: row.role,
              position: row.position,
            })),
            { onConflict: "user_book_id,entity_id,role" }
          );
        if (upsertRes.error) return NextResponse.json({ error: upsertRes.error.message }, { status: 500 });

        const deleteLinksRes = await admin
          .from("book_entities")
          .delete()
          .eq("entity_id", source.id);
        if (deleteLinksRes.error) return NextResponse.json({ error: deleteLinksRes.error.message }, { status: 500 });
      }

      const homepageRes = await admin
        .from("homepage_feature_slots")
        .update({ entity_id: targetId })
        .eq("entity_id", source.id);
      if (homepageRes.error && homepageRes.error.code !== "42P01") {
        return NextResponse.json({ error: homepageRes.error.message }, { status: 500 });
      }

      if (source.slug) {
        const aliasRes = await admin
          .from("entity_aliases")
          .upsert(
            [{ slug: source.slug, name: source.name, entity_id: targetId }],
            { onConflict: "slug" }
          );
        if (aliasRes.error?.code === "42P01") {
          return NextResponse.json({ error: "migration_required" }, { status: 409 });
        }
        if (aliasRes.error) {
          return NextResponse.json({ error: aliasRes.error.message }, { status: 500 });
        }
      }

      const deleteEntityRes = await admin.from("entities").delete().eq("id", source.id);
      if (deleteEntityRes.error) return NextResponse.json({ error: deleteEntityRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      merged_count: sources.length,
      target: { id: target.id, name: target.name, slug: target.slug },
    });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
