import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const res = await admin
      .from("profiles")
      .select("id,email,username,display_name,role,status,created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });

    return NextResponse.json({ users: res.data ?? [] });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
