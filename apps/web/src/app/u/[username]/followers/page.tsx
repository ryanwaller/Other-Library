import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../../lib/supabaseServer";
import PublicFollowListClient from "../PublicFollowListClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const usernameNorm = (username ?? "").trim().toLowerCase();
  const supabase = getServerSupabase();
  if (!supabase || !usernameNorm) return { title: "Followers" };

  const profileRes = await supabase.from("profiles").select("username,display_name").eq("username", usernameNorm).maybeSingle();
  const profile = profileRes.data as { username?: string | null; display_name?: string | null } | null;
  const context = String(profile?.display_name ?? "").trim() || String(profile?.username ?? "").trim() || username;
  return { title: `${context} is followed by` };
}

export default async function PublicFollowersPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const usernameNorm = (username ?? "").trim().toLowerCase();
  const supabase = getServerSupabase();

  if (!supabase) {
    return (
      <main className="container">
        <div className="card">Supabase is not configured.</div>
      </main>
    );
  }

  if (usernameNorm && usernameNorm !== username) {
    permanentRedirect(`/u/${usernameNorm}/followers`);
  }

  const aliasRes = await supabase.from("username_aliases").select("current_username").eq("old_username", usernameNorm).maybeSingle();
  const alias = (aliasRes.data as any)?.current_username as string | undefined;
  if (alias && alias !== usernameNorm) {
    permanentRedirect(`/u/${alias}/followers`);
  }

  const profileRes = await supabase.from("profiles").select("id,username").eq("username", usernameNorm).maybeSingle();
  const profile = profileRes.data as any;
  if (!profile) {
    return (
      <main className="container">
        <div className="card">
          <div>@{username}</div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            Not found (or private).
          </div>
        </div>
      </main>
    );
  }

  return <PublicFollowListClient username={String(profile.username ?? usernameNorm)} mode="followers" />;
}
