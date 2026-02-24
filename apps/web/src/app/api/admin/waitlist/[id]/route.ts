import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin, requireAdmin } from "../../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

function getOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (!host) return new URL(req.url).origin;
  return `${proto}://${host}`;
}

function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const current = await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const { id } = await ctx.params;
    const waitlistId = String(id || "").trim();
    if (!waitlistId) return NextResponse.json({ error: "missing_id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    if (action !== "approve" && action !== "reject") return NextResponse.json({ error: "invalid_action" }, { status: 400 });

    const cur = await admin.from("waitlist").select("id,email,status").eq("id", waitlistId).maybeSingle();
    if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });
    if (!cur.data) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const email = ((cur.data as any).email as string) ?? "";

    if (action === "reject") {
      const upd = await admin
        .from("waitlist")
        .update({ status: "rejected", approved_by: current.id, approved_at: new Date().toISOString() })
        .eq("id", waitlistId)
        .select("id,email,status,created_at,approved_by,approved_at")
        .maybeSingle();
      if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
      return NextResponse.json({ ok: true, waitlist: upd.data });
    }

    // Approve: generate invite + mark waitlist approved.
    const token = newToken();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const inv = await admin
      .from("invites")
      .insert({ token, email, created_by: current.id, expires_at: expiresAt })
      .select("id,token,email,expires_at,used_at,created_at")
      .maybeSingle();
    if (inv.error) return NextResponse.json({ error: inv.error.message }, { status: 500 });

    const upd = await admin
      .from("waitlist")
      .update({ status: "approved", approved_by: current.id, approved_at: new Date().toISOString() })
      .eq("id", waitlistId)
      .select("id,email,status,created_at,approved_by,approved_at")
      .maybeSingle();
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });

    const origin = getOrigin(req);
    const link = `${origin}/accept-invite?token=${encodeURIComponent(token)}`;
    return NextResponse.json({ ok: true, waitlist: upd.data, invite: inv.data, link });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
