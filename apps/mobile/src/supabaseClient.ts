import { createClient } from "@supabase/supabase-js";
import { getExpoPublicEnv } from "./env";

const { url, anonKey } = getExpoPublicEnv();

export const supabase = createClient(url, anonKey);

