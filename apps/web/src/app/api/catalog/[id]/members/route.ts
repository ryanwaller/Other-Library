import { NextResponse } from "next/server";
import {
  assertAcceptedCatalogMember,
  fail,
  parseCatalogId,
  requireAdminClient,
  requireUser,
  toApiError
} from "../../_lib";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const catalogId = parseCatalogId(id);
    const current = await requireUser(req);
    const admin = requireAdminClient();

    const own = await admin.from("libraries").select("owner_id").eq("id", catalogId).maybeSingle();
    if (own.error) fail(500, own.error.message);
    if (!own.data) fail(404, "catalog_not_found");
    const isOwner = String((own.data as any).owner_id ?? "") === current.id;
    if (!isOwner) {
      await assertAcceptedCatalogMember(catalogId, current.id);
    }

    const rowsRes = await admin
      .from("catalog_members")
      .select("id,catalog_id,user_id,role,invited_by,invited_at,accepted_at")
      .eq("catalog_id", catalogId)
      .order("accepted_at", { ascending: true, nullsFirst: true })
      .order("invited_at", { ascending: true });
    if (rowsRes.error) fail(500, rowsRes.error.message);
    const rows = ((rowsRes.data as any[]) ?? []).map((r) => ({
      id: String(r.id),
      catalog_id: Number(r.catalog_id),
      user_id: String(r.user_id),
      role: String(r.role),
      invited_by: r.invited_by ? String(r.invited_by) : null,
      invited_at: String(r.invited_at),
      accepted_at: r.accepted_at ? String(r.accepted_at) : null
    }));

    const ids = Array.from(
      new Set(rows.flatMap((r) => [r.user_id, r.invited_by ?? ""]).filter(Boolean))
    );
    let profilesById: Record<string, { id: string; username: string; display_name: string | null; avatar_path: string | null; email: string | null }> = {};
    if (ids.length > 0) {
      const pr = await admin.from("profiles").select("id,username,display_name,avatar_path,email").in("id", ids);
      if (pr.error) fail(500, pr.error.message);
      profilesById = Object.fromEntries(
        ((pr.data as any[]) ?? []).map((p) => [
          String(p.id),
          {
            id: String(p.id),
            username: String(p.username ?? ""),
            display_name: p.display_name ? String(p.display_name) : null,
            avatar_path: p.avatar_path ? String(p.avatar_path) : null,
            email: p.email ? String(p.email) : null
          }
        ])
      );
    }

    return NextResponse.json({
      ok: true,
      members: rows.map((r) => ({
        ...r,
        profile: profilesById[r.user_id] ?? null,
        invited_by_profile: r.invited_by ? profilesById[r.invited_by] ?? null : null
      }))
    });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
