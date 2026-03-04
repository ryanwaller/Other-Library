import { NextResponse } from "next/server";
import { requireAdminClient, requireUser, toApiError } from "../_lib";

export async function GET(req: Request) {
  try {
    const current = await requireUser(req);
    const admin = requireAdminClient();

    const ownedRes = await admin
      .from("libraries")
      .select("id,name,created_at,sort_order,owner_id")
      .eq("owner_id", current.id)
      .order("sort_order", { ascending: true });
    if (ownedRes.error) throw new Error(ownedRes.error.message);

    const membershipsRes = await admin
      .from("catalog_members")
      .select("catalog_id,role,accepted_at")
      .eq("user_id", current.id)
      .not("accepted_at", "is", null);
    if (membershipsRes.error) throw new Error(membershipsRes.error.message);

    const acceptedMemberships = ((membershipsRes.data ?? []) as any[])
      .map((r) => ({
        catalog_id: Number(r.catalog_id),
        role: (String(r.role ?? "").toLowerCase() === "owner" ? "owner" : "editor") as "owner" | "editor"
      }))
      .filter((r) => Number.isFinite(r.catalog_id) && r.catalog_id > 0);

    const roleByCatalog = new Map<number, "owner" | "editor">();
    for (const m of acceptedMemberships) roleByCatalog.set(m.catalog_id, m.role);

    const membershipCatalogIds = Array.from(new Set(acceptedMemberships.map((m) => m.catalog_id)));
    const sharedIds = membershipCatalogIds.filter((id) => !((ownedRes.data ?? []) as any[]).some((l) => Number(l.id) === id));

    let sharedLibs: any[] = [];
    if (sharedIds.length > 0) {
      const libsRes = await admin.from("libraries").select("id,name,created_at,sort_order,owner_id").in("id", sharedIds);
      if (!libsRes.error) sharedLibs = (libsRes.data ?? []) as any[];
    }

    const all = [...((ownedRes.data ?? []) as any[]), ...sharedLibs];
    const byId = new Map<number, any>();
    for (const l of all) byId.set(Number(l.id), l);

    const catalogs = Array.from(byId.values()).map((l) => {
      const id = Number(l.id);
      const role = roleByCatalog.get(id) ?? (String(l.owner_id ?? "") === current.id ? "owner" : "editor");
      return {
        id,
        name: String(l.name ?? `Catalog ${id}`),
        created_at: String(l.created_at ?? new Date(0).toISOString()),
        sort_order: Number.isFinite(Number(l.sort_order)) ? Number(l.sort_order) : null,
        owner_id: l.owner_id ? String(l.owner_id) : null,
        myRole: role
      };
    });

    return NextResponse.json({ ok: true, catalogs });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
