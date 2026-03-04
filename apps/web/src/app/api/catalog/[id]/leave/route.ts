import { NextResponse } from "next/server";
import { fail, parseCatalogId, requireAdminClient, requireUser, toApiError } from "../../_lib";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const catalogId = parseCatalogId(id);
    const current = await requireUser(req);
    const admin = requireAdminClient();

    const del = await admin
      .from("catalog_members")
      .delete()
      .eq("catalog_id", catalogId)
      .eq("user_id", current.id)
      .not("accepted_at", "is", null)
      .select("id")
      .maybeSingle();
    if (del.error) fail(500, del.error.message);
    if (!del.data) fail(404, "accepted_membership_not_found");

    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
