import { NextResponse } from "next/server";
import { fail, parseCatalogId, requireAdminClient, requireUser, toApiError } from "../../_lib";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const catalogId = parseCatalogId(id);
    const current = await requireUser(req);
    const admin = requireAdminClient();

    const upd = await admin
      .from("catalog_members")
      .update({ accepted_at: new Date().toISOString() })
      .eq("catalog_id", catalogId)
      .eq("user_id", current.id)
      .is("accepted_at", null)
      .select("id,catalog_id,user_id,role,invited_by,invited_at,accepted_at")
      .maybeSingle();
    if (upd.error) fail(500, upd.error.message);
    if (!upd.data) fail(404, "pending_invitation_not_found");

    return NextResponse.json({ ok: true, membership: upd.data });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
