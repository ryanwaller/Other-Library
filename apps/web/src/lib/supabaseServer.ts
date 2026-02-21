import { createClient } from "@supabase/supabase-js";
import { getPublicEnvOptional } from "./env";

export function getServerSupabase() {
  const env = getPublicEnvOptional();
  if (!env) return null;

  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

