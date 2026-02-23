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

function parsePublicBookId(pathname: string): number | null {
  const p = (pathname ?? "").trim();
  if (!p.startsWith("/u/")) return null;
  const parts = p.split("/").filter(Boolean);
  // ["u", "<username>", "b", "<idSlug>", ...]
  const bIdx = parts.findIndex((x) => x === "b");
  if (bIdx < 0) return null;
  const idSlug = parts[bIdx + 1] ?? "";
  const m = String(idSlug).match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function GlobalNav() {
  const pathname = usePathname();
  const viewingUsername = useMemo(() => parseViewingUsername(pathname), [pathname]);

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [me, setMe] = useState<{ username: string; avatar_path: string | null } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<number>(0);
  const [pendingBorrowRequests, setPendingBorrowRequests] = useState<number>(0);
  const [followersCount, setFollowersCount] = useState<number>(0);
  const [followingCount, setFollowingCount] = useState<number>(0);

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
    window.addEventListener("om:follows-changed", refreshPending);

    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
      window.removeEventListener("om:follows-changed", refreshPending);
    };
  }, [sessionUserId]);

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;

    async function refreshCounts() {
      if (!supabase || !sessionUserId) {
        setFollowersCount(0);
        setFollowingCount(0);
        return;
      }

      const [followersRes, followingRes] = await Promise.all([
        supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", sessionUserId).eq("status", "approved"),
        supabase.from("follows").select("followee_id", { count: "exact", head: true }).eq("follower_id", sessionUserId).eq("status", "approved")
      ]);

      if (!alive) return;
      setFollowersCount(followersRes.error ? 0 : (followersRes.count ?? 0));
      setFollowingCount(followingRes.error ? 0 : (followingRes.count ?? 0));
    }

    refreshCounts();
    timer = window.setInterval(refreshCounts, 30_000);
    window.addEventListener("om:follows-changed", refreshCounts);

    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
      window.removeEventListener("om:follows-changed", refreshCounts);
    };
  }, [sessionUserId]);

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;

    async function refreshPendingBorrow() {
      if (!supabase || !sessionUserId) {
        setPendingBorrowRequests(0);
        return;
      }
      const res = await supabase.rpc("unread_incoming_borrow_requests_count");
      if (!alive) return;
      if (res.error) {
        // Fallback to "all pending" if the unread RPC isn't installed yet.
        const fb = await supabase
          .from("borrow_requests")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", sessionUserId)
          .eq("kind", "borrow")
          .eq("status", "pending");
        if (!alive) return;
        setPendingBorrowRequests(fb.error ? 0 : (fb.count ?? 0));
        return;
      }
      setPendingBorrowRequests((res.data as any) ?? 0);
    }

    refreshPendingBorrow();
    timer = window.setInterval(refreshPendingBorrow, 30_000);
    window.addEventListener("om:borrow-requests-changed", refreshPendingBorrow);

    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
      window.removeEventListener("om:borrow-requests-changed", refreshPendingBorrow);
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

  const editInAppHref = useMemo(() => {
    if (!me?.username) return null;
    const viewing = (viewingUsername ?? "").trim().toLowerCase();
    const meUser = me.username.trim().toLowerCase();
    if (!viewing || viewing !== meUser) return null;
    const publicBookId = parsePublicBookId(pathname ?? "");
    if (publicBookId) return `/app/books/${publicBookId}`;
    return "/app";
  }, [me?.username, viewingUsername, pathname]);

  if (!supabase) return null;
  if (!sessionUserId) return null;

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <Link href="/app" style={{ textDecoration: "none" }}>
              Other Library
            </Link>
          </div>

          <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {editInAppHref ? (
              <Link href={editInAppHref} style={{ fontWeight: 600 }} aria-label="Edit this page in the app">
                Edit in app
              </Link>
            ) : null}

            {pendingBorrowRequests > 0 ? (
              <Link href="/app/messages" aria-label={`${pendingBorrowRequests} pending borrow requests`} style={{ textDecoration: "none" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 18,
                    height: 18,
                    padding: "0 6px",
                    borderRadius: 4,
                    background: "#b00020",
                    color: "white",
                    fontSize: 12,
                    lineHeight: "18px"
                  }}
                >
                  {pendingBorrowRequests}
                </span>
              </Link>
            ) : null}

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

            {avatarUrl ? (
              <Link href={me?.username ? `/u/${me.username}` : "/app"} aria-label="Open your public profile" style={{ display: "inline-flex" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  src={avatarUrl}
                  style={{ width: 18, height: 18, borderRadius: 999, border: "1px solid var(--border)", objectFit: "cover" }}
                />
              </Link>
            ) : null}

            {me?.username ? (
              <Link href="/app" className="muted" style={{ textDecoration: "none" }}>
                {me.username}
              </Link>
            ) : null}

            <Link href="/app/settings">Settings</Link>
            <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  );
}
