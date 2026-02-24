import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

function getOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (!host) return new URL(req.url).origin;
  return `${proto}://${host}`;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const { id } = await ctx.params;
    const inviteId = String(id || "").trim();
    if (!inviteId) return NextResponse.json({ error: "missing_id" }, { status: 400 });

    const res = await admin.from("invites").select("id,token,email,expires_at,used_at,created_at").eq("id", inviteId).maybeSingle();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    if (!res.data) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const origin = getOrigin(req);
    const link = `${origin}/accept-invite?token=${encodeURIComponent((res.data as any).token ?? "")}`;
    return NextResponse.json({ invite: res.data, link });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
