import { NextResponse } from "next/server";
import {
  assertCatalogOwner,
  fail,
  parseCatalogId,
  requireAdminClient,
  requireUser,
  resolveUserIdByIdentifier,
  toApiError
} from "../../_lib";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const catalogId = parseCatalogId(id);
    const current = await requireUser(req);
    await assertCatalogOwner(catalogId, current.id);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      fail(400, "invalid_json");
    }

    const identifier = String(body?.username ?? body?.email ?? body?.identifier ?? "").trim();
    if (!identifier) fail(400, "missing_username_or_email");
    const role = String(body?.role ?? "editor").trim().toLowerCase();
    if (role !== "editor") fail(400, "invalid_role");

    const targetUserId = await resolveUserIdByIdentifier(identifier);
    const admin = requireAdminClient();

    const own = await admin.from("libraries").select("owner_id").eq("id", catalogId).maybeSingle();
    if (own.error) fail(500, own.error.message);
    if (own.data?.owner_id === targetUserId) fail(400, "cannot_invite_owner");

    const ins = await admin
      .from("catalog_members")
      .insert({
        catalog_id: catalogId,
        user_id: targetUserId,
        role,
        invited_by: current.id,
        accepted_at: null
      })
      .select("id,catalog_id,user_id,role,invited_by,invited_at,accepted_at")
      .single();
    if (ins.error) {
      if ((ins.error.message ?? "").toLowerCase().includes("duplicate key")) fail(409, "already_invited_or_member");
      fail(500, ins.error.message);
    }

    return NextResponse.json({ ok: true, invitation: ins.data });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
