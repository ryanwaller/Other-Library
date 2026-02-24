import { NextResponse } from "next/server";
import { getServerSupabase } from "../../../../lib/supabaseServer";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sb = getServerSupabase();
  if (!sb) return NextResponse.json({ error: "supabase_not_configured" }, { status: 500 });

  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  const { data, error } = await sb.rpc("invite_status", { input_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ result: data });
}
