import { getCurrentUser, getSupabaseAdmin } from "../../../lib/supabaseAdmin";

type ApiError = { status: number; message: string };

export function fail(status: number, message: string): never {
  throw { status, message } satisfies ApiError;
}

export function toApiError(err: unknown): ApiError {
  const maybe = err as Partial<ApiError> | null | undefined;
  if (maybe && typeof maybe.status === "number" && typeof maybe.message === "string") {
    return { status: maybe.status, message: maybe.message };
  }
  return { status: 500, message: (err as any)?.message ?? "internal_error" };
}

export function parseCatalogId(input: string): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) fail(400, "invalid_catalog_id");
  return n;
}

export async function requireUser(req: Request): Promise<{ id: string; email: string | null }> {
  const current = await getCurrentUser(req);
  if (!current) fail(401, "not_authenticated");
  return { id: current.id, email: current.email ?? null };
}

export function requireAdminClient() {
  const admin = getSupabaseAdmin();
  if (!admin) fail(500, "admin_not_configured");
  return admin;
}

export async function assertCatalogOwner(catalogId: number, userId: string): Promise<void> {
  const admin = requireAdminClient();
  const own = await admin.from("libraries").select("id,owner_id").eq("id", catalogId).maybeSingle();
  if (own.error) fail(500, own.error.message);
  if (!own.data) fail(404, "catalog_not_found");
  if ((own.data as any).owner_id !== userId) fail(403, "forbidden");
}

export async function assertAcceptedCatalogMember(catalogId: number, userId: string): Promise<void> {
  const admin = requireAdminClient();
  const m = await admin
    .from("catalog_members")
    .select("id")
    .eq("catalog_id", catalogId)
    .eq("user_id", userId)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (m.error) fail(500, m.error.message);
  if (!m.data) fail(403, "forbidden");
}

export async function resolveUserIdByIdentifier(identifier: string): Promise<string> {
  const admin = requireAdminClient();
  const value = String(identifier ?? "").trim();
  if (!value) fail(400, "missing_identifier");

  if (value.includes("@")) {
    const email = value.toLowerCase();
    const pr = await admin.from("profiles").select("id,email").eq("email", email).maybeSingle();
    if (pr.error) fail(500, pr.error.message);
    if (!pr.data?.id) fail(404, "user_not_found");
    return String(pr.data.id);
  }

  const username = value.toLowerCase();
  const pr = await admin.from("profiles").select("id,username").eq("username", username).maybeSingle();
  if (pr.error) fail(500, pr.error.message);
  if (!pr.data?.id) fail(404, "user_not_found");
  return String(pr.data.id);
}
