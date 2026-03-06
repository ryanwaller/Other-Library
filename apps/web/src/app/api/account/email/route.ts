import { NextResponse } from "next/server";
import { getCurrentUser, getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeEmail(input: unknown): string {
  return String(input ?? "").trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) return fail(401, "not_authenticated");

  const admin = getSupabaseAdmin();
  if (!admin) return fail(500, "admin_not_configured");

  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email) return fail(400, "email_required");
  if (!isValidEmail(email)) return fail(400, "invalid_email");

  const existing = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });
  if (existing.error) return fail(500, existing.error.message);

  const otherUser = (existing.data.users ?? []).find((user) => {
    const userEmail = normalizeEmail(user.email);
    return userEmail === email && user.id !== current.id;
  });
  if (otherUser) return fail(409, "email_taken");

  const updated = await admin.auth.admin.updateUserById(current.id, {
    email,
    email_confirm: true
  });
  if (updated.error) return fail(400, updated.error.message);

  const profileUpdate = await admin.from("profiles").update({ email }).eq("id", current.id);
  if (profileUpdate.error) return fail(500, profileUpdate.error.message);

  return NextResponse.json({ ok: true, email });
}
