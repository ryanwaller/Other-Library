import { createClient, type User } from "@supabase/supabase-js";
import { getPublicEnvOptional } from "./env";

type CurrentUser = { id: string; email: string | null; user: User };

export function getSupabaseAdmin() {
  const env = getPublicEnvOptional();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !serviceKey) return null;

  return createClient(env.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

export async function getCurrentUser(req: Request): Promise<CurrentUser | null> {
  // TODO: swap this out for @supabase/ssr (or auth-helpers) once chosen, so we can read cookies.
  // For now we accept a Bearer access token from the client.
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() ?? "";
  if (!token) return null;

  const env = getPublicEnvOptional();
  if (!env) return null;

  const sb = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null, user: data.user };
}

export async function requireAdmin(req: Request): Promise<CurrentUser> {
  const current = await getCurrentUser(req);
  if (!current) throw new Error("not_authenticated");

  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("admin_not_configured");

  const pr = await admin.from("profiles").select("role,status").eq("id", current.id).maybeSingle();
  if (pr.error) throw new Error(pr.error.message);
  const role = (pr.data as any)?.role ?? "user";
  const status = (pr.data as any)?.status ?? "active";
  if (status !== "active") throw new Error("account_not_active");
  if (role !== "admin") throw new Error("forbidden");

  return current;
}

