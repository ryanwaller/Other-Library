import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../../lib/supabaseServer";
import FollowControls from "../FollowControls";

export const dynamic = "force-dynamic";

type MiniProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
};

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
          <div className="muted" style={{ marginTop: 8 }}>
            Not found (or private).
          </div>
        </div>
      </main>
    );
  }

  const listRes = await supabase.rpc("get_following", { target_username: usernameNorm, page_limit: 200, page_offset: 0 });
  if (listRes.error) {
    return (
      <main className="container">
        <div className="card">
          <div>
            <Link href={`/u/${profile.username}`}>{profile.username}</Link> · following
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Following list is not visible.
          </div>
        </div>
      </main>
    );
  }

  const rows = (listRes.data ?? []) as unknown as MiniProfile[];
  const avatarPaths = Array.from(new Set(rows.map((r) => r.avatar_path).filter(Boolean))) as string[];
  const signedMap: Record<string, string> = {};
  if (avatarPaths.length > 0) {
    const signed = await supabase.storage.from("avatars").createSignedUrls(avatarPaths, 60 * 30);
    for (const s of signed.data ?? []) {
      if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
    }
  }

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <Link href={`/u/${profile.username}`}>{profile.username}</Link> · following
          </div>
          <div className="muted">{rows.length}</div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {rows.length === 0 ? (
          <div className="muted">None.</div>
        ) : (
          rows.map((p) => {
            const avatarUrl = p.avatar_path ? signedMap[p.avatar_path] ?? null : null;
            const label = (p.display_name ?? "").trim() ? `${p.username} (${p.display_name})` : p.username;
            return (
              <div key={p.id} className="card" style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="om-avatar-lockup">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={avatarUrl} className="om-avatar-img" />
                    ) : null}
                    <Link href={`/u/${p.username}`}>{label}</Link>
                  </div>
                  <FollowControls profileId={p.id} profileUsername={p.username} compact />
                </div>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
