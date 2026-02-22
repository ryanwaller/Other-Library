"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function parseViewingUsername(pathname: string): string | null {
  const p = (pathname ?? "").trim();
  if (!p.startsWith("/u/")) return null;
  const rest = p.slice("/u/".length);
  const seg = rest.split("/")[0] ?? "";
  const username = seg.trim();
  return username ? username : null;
}

export default function GlobalNav() {
  const pathname = usePathname();
  const viewingUsername = useMemo(() => parseViewingUsername(pathname), [pathname]);

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [me, setMe] = useState<{ username: string; avatar_path: string | null } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<number>(0);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSessionUserId(newSession?.user?.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;

    async function refreshPending() {
      if (!supabase || !sessionUserId) {
        setPendingRequests(0);
        return;
      }
      const res = await supabase
        .from("follows")
        .select("follower_id", { count: "exact", head: true })
        .eq("followee_id", sessionUserId)
        .eq("status", "pending");
      if (!alive) return;
      if (res.error) {
        setPendingRequests(0);
        return;
      }
      setPendingRequests(res.count ?? 0);
    }

    refreshPending();
    timer = window.setInterval(refreshPending, 30_000);

    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [sessionUserId]);

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

  const label = useMemo(() => {
    if (!me?.username) return null;
    const viewing = (viewingUsername ?? "").trim().toLowerCase();
    const meUser = me.username.trim().toLowerCase();
    if (!viewing) return `Signed in as ${me.username}.`;
    if (viewing === meUser) return `Signed in as ${me.username}. Viewing your public page.`;
    return `Signed in as ${me.username}. Viewing ${viewingUsername}.`;
  }, [me?.username, viewingUsername]);

  if (!supabase) return null;
  if (!sessionUserId) return null;

  return (
    <div className="container">
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
            <Link href="/app/settings">Settings</Link>
            {me?.username ? <Link href={`/u/${me.username}`}>My public page</Link> : null}
            {pendingRequests > 0 ? (
              <Link href="/app/follows" aria-label={`${pendingRequests} pending follow requests`} style={{ textDecoration: "none" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 18,
                    height: 18,
                    padding: "0 6px",
                    borderRadius: 999,
                    background: "#b00020",
                    color: "white",
                    fontSize: 12,
                    lineHeight: "18px"
                  }}
                >
                  {pendingRequests}
                </span>
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

