import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

function isLocalHost(host: string): boolean {
  const value = String(host ?? "").toLowerCase();
  return value.includes("localhost") || value.includes("127.0.0.1");
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

