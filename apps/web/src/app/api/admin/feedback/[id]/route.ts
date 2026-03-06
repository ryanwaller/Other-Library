import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

function normalizeStatus(input: unknown): "new" | "reviewing" | "resolved" | "wont_fix" | null {
  const v = String(input ?? "").trim().toLowerCase();
  if (v === "new" || v === "reviewing" || v === "resolved" || v === "wont_fix") return v;
  return null;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const { id } = await ctx.params;
    const feedbackId = String(id ?? "").trim();
    if (!feedbackId) return NextResponse.json({ error: "invalid_feedback_id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const status = normalizeStatus((body as any)?.status);
    const adminNotesRaw = (body as any)?.admin_notes;
    const adminNotes = typeof adminNotesRaw === "string" ? adminNotesRaw : adminNotesRaw === null ? null : undefined;

    const patch: Record<string, unknown> = {};
    if (status) patch.status = status;
    if (adminNotes !== undefined) patch.admin_notes = adminNotes;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "no_updates" }, { status: 400 });

    const res = await admin.from("feedback").update(patch).eq("id", feedbackId).select("id").maybeSingle();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    if (!res.data) return NextResponse.json({ error: "feedback_not_found" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

