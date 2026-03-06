import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const { id } = await ctx.params;
    const inviteId = String(id || "").trim();
    if (!inviteId) return NextResponse.json({ error: "missing_id" }, { status: 400 });

    const existing = await admin
      .from("invites")
      .select("id,used_at")
      .eq("id", inviteId)
      .maybeSingle();
    if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
    if (!existing.data) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (existing.data.used_at) return NextResponse.json({ error: "invite_already_used" }, { status: 400 });

    const deleted = await admin.from("invites").delete().eq("id", inviteId);
    if (deleted.error) return NextResponse.json({ error: deleted.error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
