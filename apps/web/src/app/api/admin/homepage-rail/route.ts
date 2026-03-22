import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

const SURFACE = "explore_right_rail";
const DEFAULT_SLOTS = 3;

type SlotMode = "automatic" | "pinned";
type SlotRole = "author" | "designer" | "publisher" | "performer" | "tag" | "material";

function normalizeMode(value: unknown): SlotMode {
  return value === "pinned" ? "pinned" : "automatic";
}

function normalizeRole(value: unknown): SlotRole {
  const next = String(value ?? "").trim().toLowerCase();
  if (next === "author" || next === "designer" || next === "publisher" || next === "performer" || next === "tag" || next === "material") return next;
  return "designer";
}

function defaultSlots() {
  return Array.from({ length: DEFAULT_SLOTS }, (_, idx) => ({
    slot_index: idx + 1,
    mode: "automatic" as SlotMode,
    role: "designer" as SlotRole,
    entity_id: null as string | null,
    title_override: "",
    entity: null as { id: string; name: string; slug: string | null } | null,
  }));
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") ?? "").trim();

    if (q) {
      const entityRes = await admin
        .from("entities")
        .select("id,name,slug")
        .ilike("name", `%${q}%`)
        .order("name", { ascending: true })
        .limit(8);
      if (entityRes.error) return NextResponse.json({ error: entityRes.error.message }, { status: 500 });
      return NextResponse.json({ entities: entityRes.data ?? [] });
    }

    const res = await admin
      .from("homepage_feature_slots")
      .select("slot_index,mode,role,entity_id,title_override,entity:entities(id,name,slug)")
      .eq("surface", SURFACE)
      .order("slot_index", { ascending: true });
    if (res.error) {
      if ((res.error as any).code === "42P01") return NextResponse.json({ slots: defaultSlots(), migrationRequired: true });
      return NextResponse.json({ error: res.error.message }, { status: 500 });
    }

    const rows = (res.data ?? [])
      .map((row) => ({
        slot_index: Number(row.slot_index),
        mode: normalizeMode(row.mode),
        role: normalizeRole(row.role),
        entity_id: row.entity_id ? String(row.entity_id) : null,
        title_override: String(row.title_override ?? ""),
        entity: row.entity && typeof row.entity === "object" ? {
          id: String((row.entity as any).id ?? ""),
          name: String((row.entity as any).name ?? ""),
          slug: String((row.entity as any).slug ?? "") || null,
        } : null,
      }))
      .filter((row) => Number.isFinite(row.slot_index) && row.slot_index >= 1)
      .sort((a, b) => a.slot_index - b.slot_index)
      .map((row, idx) => ({ ...row, slot_index: idx + 1 }));

    return NextResponse.json({ slots: rows.length > 0 ? rows : defaultSlots() });
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
    const inputSlots = Array.isArray(body?.slots) ? body.slots : [];
    const normalizedSlots = (inputSlots.length > 0 ? inputSlots : defaultSlots()).map((raw, idx) => {
      const mode = normalizeMode(raw.mode);
      const role = normalizeRole(raw.role);
      return {
        surface: SURFACE,
        slot_index: idx + 1,
        mode,
        role: mode === "pinned" ? role : null,
        entity_id: mode === "pinned" && raw.entity_id ? String(raw.entity_id) : null,
        title_override: String(raw.title_override ?? "").trim() || null,
      };
    });

    const del = await admin.from("homepage_feature_slots").delete().eq("surface", SURFACE);
    if (del.error) {
      if ((del.error as any).code === "42P01") return NextResponse.json({ error: "migration_required" }, { status: 409 });
      return NextResponse.json({ error: del.error.message }, { status: 500 });
    }

    const ins = await admin.from("homepage_feature_slots").insert(normalizedSlots);
    if (ins.error) {
      if ((ins.error as any).code === "23514") return NextResponse.json({ error: "migration_required" }, { status: 409 });
      return NextResponse.json({ error: ins.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
