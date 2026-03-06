"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import FollowControls from "./FollowControls";
import IdentityRow from "../../components/IdentityRow";

type MiniProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
};

export default function PublicFollowListClient({ username, mode }: { username: string; mode: "followers" | "following" }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ id: string; username: string; avatar_path: string | null } | null>(null);
  const [rows, setRows] = useState<MiniProfile[]>([]);
  const [signedMap, setSignedMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) {
        if (!alive) return;
        setError("Supabase is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const profileRes = await supabase.from("profiles").select("id,username,avatar_path").eq("username", username).maybeSingle();
        const p = (profileRes.data as any) ?? null;
        if (!p) {
          if (!alive) return;
          setProfile(null);
          setRows([]);
          setLoading(false);
          return;
        }
        const avatarPath = p.avatar_path ? String(p.avatar_path) : null;
        if (!alive) return;
        setProfile({ id: String(p.id), username: String(p.username ?? username), avatar_path: avatarPath });

        const rpcName = mode === "followers" ? "get_followers" : "get_following";
        const listRes = await (supabase as any).rpc(rpcName, { target_username: username, page_limit: 200, page_offset: 0 });
        if (listRes.error) throw new Error(listRes.error.message);

        const nextRows = ((listRes.data ?? []) as unknown as MiniProfile[]) ?? [];
        if (!alive) return;
        setRows(nextRows);

        const avatarPaths = Array.from(
          new Set([avatarPath, ...nextRows.map((r) => r.avatar_path).filter(Boolean)])
        ).filter(Boolean) as string[];
        if (avatarPaths.length === 0) {
          setSignedMap({});
          setLoading(false);
          return;
        }
        const signed = await supabase.storage.from("avatars").createSignedUrls(avatarPaths, 60 * 30);
        if (!alive) return;
        const nextMap: Record<string, string> = {};
        for (const s of signed.data ?? []) {
          if (s.path && s.signedUrl) nextMap[s.path] = s.signedUrl;
        }
        setSignedMap(nextMap);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load");
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [username, mode]);

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

  const headingLabel = mode === "followers" ? "follows" : mode;
  const headerAvatarUrl = profile ? (profile.avatar_path ? signedMap[profile.avatar_path] ?? null : null) : null;
  const heading = (
    <div className="row" style={{ alignItems: "center", gap: "var(--space-8)" }}>
      <Link href={`/u/${profile.username}`} className="om-avatar-link">
        {headerAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" src={headerAvatarUrl} className="om-avatar-img" />
        ) : (
          <div className="om-avatar-img" style={{ background: "var(--bg-muted)" }} />
        )}
      </Link>
      <div>
        <Link href={`/u/${profile.username}`}>{profile.username}</Link> {headingLabel}
      </div>
    </div>
  );

  if (loading) {
    return (
      <main className="container">
        <div className="card">
          {heading}
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            Loading…
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="container">
        <div className="card">
          {heading}
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            {mode === "followers" ? "Followers list is not visible." : "Following list is not visible."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          {heading}
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
