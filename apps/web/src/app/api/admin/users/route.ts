import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

function clampInt(input: string | null, def: number, min: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeSort(input: string | null): "email" | "role" | "status" | "created_at" {
  if (input === "email" || input === "role" || input === "status" || input === "created_at") return input;
  return "created_at";
}

function normalizeDir(input: string | null): "asc" | "desc" {
  return input === "asc" ? "asc" : "desc";
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const status = (url.searchParams.get("status") ?? "").trim(); // active|disabled|pending|all
    const role = (url.searchParams.get("role") ?? "").trim(); // admin|user|all
    const sort = normalizeSort(url.searchParams.get("sort"));
    const dir = normalizeDir(url.searchParams.get("dir"));
    const pageSize = clampInt(url.searchParams.get("pageSize"), 20, 1, 200);
    const page = clampInt(url.searchParams.get("page"), 1, 1, 10_000);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = admin.from("profiles").select("id,email,username,display_name,role,status,created_at", { count: "exact" });
    if (q) query = query.ilike("email", `%${q}%`);
    if (status && status !== "all") query = query.eq("status", status);
    if (role && role !== "all") query = query.eq("role", role);

    query = query.order(sort, { ascending: dir === "asc" }).order("id", { ascending: true }).range(from, to);

    const res = await query;
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });

    const total = res.count ?? 0;

    // Summary metrics (independent of search/filter so the top bar stays stable)
    const [mTotal, mActive, mDisabled, mPending] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("status", "disabled"),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending")
    ]);

    return NextResponse.json({
      users: res.data ?? [],
      page,
      pageSize,
      total,
      metrics: {
        total: mTotal.count ?? 0,
        active: mActive.count ?? 0,
        disabled: mDisabled.count ?? 0,
        pending: mPending.count ?? 0
      }
    });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
