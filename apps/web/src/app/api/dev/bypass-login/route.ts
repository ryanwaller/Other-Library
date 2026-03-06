import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

function isLocalHost(host: string): boolean {
  const value = String(host ?? "").toLowerCase().split(":")[0] ?? "";
  if (!value) return false;
  if (value === "localhost" || value === "127.0.0.1" || value === "0.0.0.0") return true;
  if (value.endsWith(".local")) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  const match172 = value.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }
  return false;
}

export async function POST(req: Request) {
  try {
    if (process.env.NODE_ENV !== "development") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const host = req.headers.get("host") ?? "";
    if (!isLocalHost(host)) {
      return NextResponse.json({ error: "forbidden_host" }, { status: 403 });
    }

    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const email = String(process.env.DEV_BYPASS_EMAIL ?? "").trim().toLowerCase();
    const password = String(process.env.DEV_BYPASS_PASSWORD ?? "dev-local-login").trim();
    if (!email || !password) {
      return NextResponse.json({ error: "missing_dev_bypass_env" }, { status: 500 });
    }

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (users.error) return NextResponse.json({ error: users.error.message }, { status: 500 });
    const existing = (users.data.users ?? []).find((u) => String(u.email ?? "").toLowerCase() === email) ?? null;

    if (existing) {
      const updated = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
      if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 500 });
    } else {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) return NextResponse.json({ error: created.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, email, password });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "dev_bypass_failed" }, { status: 500 });
  }
}
