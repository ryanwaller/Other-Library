import { NextResponse } from "next/server";
import { assertCatalogOwner, fail, parseCatalogId, requireAdminClient, requireUser, toApiError } from "../../../_lib";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const { id, userId } = await ctx.params;
    const catalogId = parseCatalogId(id);
    const current = await requireUser(req);
    await assertCatalogOwner(catalogId, current.id);

    const memberUserId = String(userId ?? "").trim();
    if (!memberUserId) fail(400, "missing_user_id");

    const admin = requireAdminClient();

    const own = await admin.from("libraries").select("owner_id").eq("id", catalogId).maybeSingle();
    if (own.error) fail(500, own.error.message);
    if (!own.data) fail(404, "catalog_not_found");
    if ((own.data as any).owner_id === memberUserId) fail(400, "cannot_remove_owner");

    const del = await admin
      .from("catalog_members")
      .delete()
      .eq("catalog_id", catalogId)
      .eq("user_id", memberUserId)
      .select("id")
      .maybeSingle();
    if (del.error) fail(500, del.error.message);
    if (!del.data) fail(404, "member_not_found");

    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const { id, userId } = await ctx.params;
    const catalogId = parseCatalogId(id);
    const current = await requireUser(req);
    await assertCatalogOwner(catalogId, current.id);

    const memberUserId = String(userId ?? "").trim();
    if (!memberUserId) fail(400, "missing_user_id");

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      fail(400, "invalid_json");
    }
    const role = String(body?.role ?? "").trim().toLowerCase();
    if (role !== "editor") fail(400, "invalid_role");

    const admin = requireAdminClient();
    const own = await admin.from("libraries").select("owner_id").eq("id", catalogId).maybeSingle();
    if (own.error) fail(500, own.error.message);
    if (!own.data) fail(404, "catalog_not_found");
    if ((own.data as any).owner_id === memberUserId) fail(400, "cannot_change_owner_role");

    const upd = await admin
      .from("catalog_members")
      .update({ role })
      .eq("catalog_id", catalogId)
      .eq("user_id", memberUserId)
      .select("id,catalog_id,user_id,role,invited_by,invited_at,accepted_at")
      .maybeSingle();
    if (upd.error) fail(500, upd.error.message);
    if (!upd.data) fail(404, "member_not_found");

    return NextResponse.json({ ok: true, member: upd.data });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
