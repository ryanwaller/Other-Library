import { createClient } from "@supabase/supabase-js";
import { getPublicEnvOptional } from "./env";

const env = getPublicEnvOptional();

export const supabase = env ? createClient(env.url, env.anonKey) : null;
