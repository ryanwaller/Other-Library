"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

export default function SignedInAppNav({ viewingUsername }: { viewingUsername?: string | null }) {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [me, setMe] = useState<{ username: string; avatar_path: string | null } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSessionUserId(newSession?.user?.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !sessionUserId) {
        setMe(null);
        setAvatarUrl(null);
        return;
      }
      const res = await supabase.from("profiles").select("username,avatar_path").eq("id", sessionUserId).maybeSingle();
      if (!alive) return;
      if (res.error || !res.data?.username) {
        setMe(null);
        setAvatarUrl(null);
        return;
      }
      const next = { username: res.data.username as string, avatar_path: (res.data as any).avatar_path as string | null };
      setMe(next);

      if (next.avatar_path) {
        const signed = await supabase.storage.from("avatars").createSignedUrl(next.avatar_path, 60 * 30);
        if (!alive) return;
        setAvatarUrl(signed.data?.signedUrl ?? null);
      } else {
        setAvatarUrl(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionUserId]);

  const viewing = (viewingUsername ?? "").trim().toLowerCase();
  const meUser = (me?.username ?? "").trim().toLowerCase();
  const isMe = !!viewing && !!meUser && viewing === meUser;

  const label = useMemo(() => {
    if (!me?.username) return null;
    if (!viewing) return `Signed in as ${me.username}.`;
    return isMe ? `Signed in as ${me.username}. You’re viewing your public page.` : `Signed in as ${me.username}. You’re viewing ${viewingUsername}.`;
  }, [me?.username, viewing, isMe, viewingUsername]);

  if (!supabase) return null;
  if (!sessionUserId) return null;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          {avatarUrl ? (
            <Link href={me?.username ? `/u/${me.username}` : "/app"} aria-label="Open your public profile">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" src={avatarUrl} style={{ width: 18, height: 18, borderRadius: 999, border: "1px solid var(--border)" }} />
            </Link>
          ) : null}
          <span className="muted">{label ?? "Signed in."}</span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Link href="/app">App home</Link>
          {me?.username ? <Link href={`/u/${me.username}`}>My public page</Link> : null}
        </div>
      </div>
    </div>
  );
}

