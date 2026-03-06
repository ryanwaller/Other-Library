import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../../lib/supabaseServer";
import PublicFollowListClient from "../PublicFollowListClient";

export const dynamic = "force-dynamic";

export default async function PublicFollowingPage({ params }: { params: Promise<{ username: string }> }) {
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
    permanentRedirect(`/u/${usernameNorm}/following`);
  }

  const aliasRes = await supabase.from("username_aliases").select("current_username").eq("old_username", usernameNorm).maybeSingle();
  const alias = (aliasRes.data as any)?.current_username as string | undefined;
  if (alias && alias !== usernameNorm) {
    permanentRedirect(`/u/${alias}/following`);
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

  return <PublicFollowListClient username={String(profile.username ?? usernameNorm)} mode="following" />;
}
