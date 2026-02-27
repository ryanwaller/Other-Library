import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin, requireAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

function clampInt(input: string | null, def: number, min: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeSort(input: string | null): "created_at" {
  if (input === "created_at") return input;
  return "created_at";
}

function normalizeDir(input: string | null): "asc" | "desc" {
  return input === "asc" ? "asc" : "desc";
}

function getOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (!host) return new URL(req.url).origin;
  return `${proto}://${host}`;
}

function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const sort = normalizeSort(url.searchParams.get("sort"));
    const dir = normalizeDir(url.searchParams.get("dir"));
    const pageSize = clampInt(url.searchParams.get("pageSize"), 20, 1, 200);
    const page = clampInt(url.searchParams.get("page"), 1, 1, 10_000);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = admin
      .from("invites")
      .select("id,token,email,created_by,expires_at,used_by,used_at,created_at", { count: "exact" })
      .order(sort, { ascending: dir === "asc" })
      .order("id", { ascending: true })
      .range(from, to);
    if (q) query = query.ilike("email", `%${q}%`);

    const res = await query;
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    const nowIso = new Date().toISOString();
    const [mTotal, mUsed, mExpired] = await Promise.all([
      admin.from("invites").select("id", { count: "exact", head: true }),
      admin.from("invites").select("id", { count: "exact", head: true }).not("used_at", "is", null),
      admin.from("invites").select("id", { count: "exact", head: true }).is("used_at", null).lt("expires_at", nowIso)
    ]);
    const totalCount = mTotal.count ?? 0;
    const usedCount = mUsed.count ?? 0;
    const expiredCount = mExpired.count ?? 0;
    const pendingCount = Math.max(0, totalCount - usedCount - expiredCount);

    return NextResponse.json({
      invites: res.data ?? [],
      page,
      pageSize,
      total: res.count ?? 0,
      metrics: {
        total: totalCount,
        pending: pendingCount,
        used: usedCount,
        expired: expiredCount
      }
    });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const current = await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const expiresInDays = Number.isFinite(Number(body.expiresInDays)) ? Number(body.expiresInDays) : 14;
    const expiresAt = new Date(Date.now() + Math.max(1, expiresInDays) * 24 * 60 * 60 * 1000).toISOString();

    const token = newToken();
    const ins = await admin
      .from("invites")
      .insert({
        token,
        email: email || null,
        created_by: current.id,
        expires_at: expiresAt
      })
      .select("id,token,email,expires_at,used_at,created_at")
      .maybeSingle();
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

    const origin = getOrigin(req);
    const link = `${origin}/accept-invite?token=${encodeURIComponent(token)}`;
    return NextResponse.json({ invite: ins.data, link });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
