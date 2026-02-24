import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!email || !email.includes("@")) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const res = await admin
    .from("waitlist")
    .insert({ email, note: note || null })
    .select("id,email,status,created_at")
    .maybeSingle();

  if (res.error) {
    const msg = res.error.message || "failed";
    // Handle "unique" gently.
    if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
      return NextResponse.json({ ok: true, already: true });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true, row: res.data });
}
