import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getServerSupabase } from "../../../../lib/supabaseServer";
import FollowControls from "../FollowControls";
import IdentityRow from "../../../components/IdentityRow";

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
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
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
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
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
          <div className="text-muted">{rows.length}</div>
        </div>
      </div>

      <div style={{ marginTop: "var(--space-md)" }}>
        {rows.length === 0 ? (
          <div className="text-muted">None.</div>
        ) : (
          rows.map((p) => {
            const avatarUrl = p.avatar_path ? signedMap[p.avatar_path] ?? null : null;
            return (
              <div key={p.id} className="card" style={{ marginTop: "var(--space-10)" }}>
                <IdentityRow
                  avatarUrl={avatarUrl}
                  displayName={p.display_name}
                  username={p.username}
                  rightSlot={<FollowControls profileId={p.id} profileUsername={p.username} compact />}
                />
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
