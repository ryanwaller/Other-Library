import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

function normalizeRole(input: any): "user" | "admin" | null {
  if (input === "user" || input === "admin") return input;
  return null;
}

function normalizeStatus(input: any): "active" | "disabled" | "pending" | null {
  if (input === "active" || input === "disabled" || input === "pending") return input;
  return null;
}

async function countActiveAdmins(admin: any): Promise<number> {
  const r = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("status", "active");
  return r.count ?? 0;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const current = await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const { id } = await ctx.params;
    const targetId = String(id || "").trim();
    if (!targetId) return NextResponse.json({ error: "missing_id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const nextRole = body.role !== undefined ? normalizeRole(body.role) : null;
    const nextStatus = body.status !== undefined ? normalizeStatus(body.status) : null;
    if (body.role !== undefined && !nextRole) return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    if (body.status !== undefined && !nextStatus) return NextResponse.json({ error: "invalid_status" }, { status: 400 });

    if (targetId === current.id && (nextRole || nextStatus)) {
      return NextResponse.json({ error: "cannot_change_self_admin_state" }, { status: 400 });
    }

    const cur = await admin.from("profiles").select("id,role,status").eq("id", targetId).maybeSingle();
    if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });
    if (!cur.data) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const curRole = (cur.data as any).role as string;
    const curStatus = (cur.data as any).status as string;

    const willDemoteAdmin = curRole === "admin" && nextRole === "user";
    const willDisableAdmin = curRole === "admin" && nextStatus === "disabled";
    if (willDemoteAdmin || willDisableAdmin) {
      const adminCount = await countActiveAdmins(admin);
      if (adminCount <= 1) return NextResponse.json({ error: "cannot_remove_last_admin" }, { status: 400 });
    }

    const patch: Record<string, any> = {};
    if (nextRole) patch.role = nextRole;
    if (nextStatus) patch.status = nextStatus;

    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, unchanged: true });

    const upd = await admin.from("profiles").update(patch).eq("id", targetId).select("id,role,status").maybeSingle();
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });

    // Guardrail: if we accidentally demoted/disabled the last admin due to race, revert.
    const afterCount = await countActiveAdmins(admin);
    if (afterCount <= 0) {
      await admin.from("profiles").update({ role: curRole, status: curStatus }).eq("id", targetId);
      return NextResponse.json({ error: "cannot_remove_last_admin" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, user: upd.data });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
