import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

type SearchEntity = {
  id: string;
  name: string;
  slug: string | null;
  count: number;
};

async function loadCounts(admin: any, ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of Array.from(new Set(ids.map((value) => String(value || "").trim()).filter(Boolean)))) {
    const res = await admin
      .from("book_entities")
      .select("*", { count: "exact", head: true })
      .eq("entity_id", id);
    if (!res.error) counts.set(id, Number(res.count ?? 0));
  }
  return counts;
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") ?? "").trim();

    let query = admin.from("entities").select("id,name,slug");
    if (q) query = query.ilike("name", `%${q}%`);

    const entityRes = await query.order("name", { ascending: true }).limit(q ? 20 : 50);
    if (entityRes.error) return NextResponse.json({ error: entityRes.error.message }, { status: 500 });

    const rows = (entityRes.data ?? []) as Array<{ id: string; name: string; slug: string | null }>;
    const counts = await loadCounts(admin, rows.map((row) => row.id));
    const entities: SearchEntity[] = rows
      .map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        slug: String(row.slug ?? "") || null,
        count: counts.get(String(row.id)) ?? 0,
      }))
      .sort((a, b) => {
        if (!q && b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      });

    return NextResponse.json({ entities });
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
    const sourceId = String(body?.source_entity_id ?? "").trim();
    const targetId = String(body?.target_entity_id ?? "").trim();

    if (!sourceId || !targetId) return NextResponse.json({ error: "source_and_target_required" }, { status: 400 });
    if (sourceId === targetId) return NextResponse.json({ error: "source_and_target_must_differ" }, { status: 400 });

    const entitiesRes = await admin
      .from("entities")
      .select("id,name,slug")
      .in("id", [sourceId, targetId]);
    if (entitiesRes.error) return NextResponse.json({ error: entitiesRes.error.message }, { status: 500 });

    const entities = (entitiesRes.data ?? []) as Array<{ id: string; name: string; slug: string }>;
    const source = entities.find((row) => String(row.id) === sourceId);
    const target = entities.find((row) => String(row.id) === targetId);
    if (!source || !target) return NextResponse.json({ error: "entity_not_found" }, { status: 404 });

    const sourceLinksRes = await admin
      .from("book_entities")
      .select("user_book_id,role,position")
      .eq("entity_id", sourceId)
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
        .eq("entity_id", sourceId);
      if (deleteLinksRes.error) return NextResponse.json({ error: deleteLinksRes.error.message }, { status: 500 });
    }

    const homepageRes = await admin
      .from("homepage_feature_slots")
      .update({ entity_id: targetId })
      .eq("entity_id", sourceId);
    if (homepageRes.error && homepageRes.error.code !== "42P01") {
      return NextResponse.json({ error: homepageRes.error.message }, { status: 500 });
    }

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

    const deleteEntityRes = await admin.from("entities").delete().eq("id", sourceId);
    if (deleteEntityRes.error) return NextResponse.json({ error: deleteEntityRes.error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      target: { id: target.id, name: target.name, slug: target.slug },
    });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
