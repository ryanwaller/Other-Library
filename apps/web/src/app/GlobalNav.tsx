"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  const router = useRouter();
  const viewingUsername = useMemo(() => parseViewingUsername(pathname), [pathname]);

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [me, setMe] = useState<{ username: string; avatar_path: string | null; role?: string | null; status?: string | null } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<number>(0);
  const [pendingIncomingBorrows, setPendingIncomingBorrows] = useState<number>(0);
  const [pendingCatalogInvites, setPendingCatalogInvites] = useState<number>(0);
  const [unreadThreads, setUnreadThreads] = useState<number>(0);
  const [unreadLatestId, setUnreadLatestId] = useState<number | null>(null);
  const [unreadLatestStatus, setUnreadLatestStatus] = useState<string | null>(null);
  const [followersCount, setFollowersCount] = useState<number>(0);
  const [followingCount, setFollowingCount] = useState<number>(0);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  async function signOut() {
    try {
      await supabase?.auth.signOut();
    } finally {
      router.push("/");
      router.refresh();
    }
  }

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

    async function refreshPendingIncomingBorrows() {
      if (!supabase || !sessionUserId) {
        setPendingIncomingBorrows(0);
        return;
      }
      const res = await supabase
        .from("borrow_requests")
        .select("id")
        .eq("owner_id", sessionUserId)
        .eq("kind", "borrow")
        .eq("status", "pending")
        .limit(500);
      if (!alive) return;
      if (res.error) {
        setPendingIncomingBorrows(0);
        return;
      }
      const ids = ((res.data ?? []) as any[])
        .map((r) => Number(r.id))
        .filter((n) => Number.isFinite(n));
      if (ids.length === 0) {
        setPendingIncomingBorrows(0);
        return;
      }
      const del = await supabase
        .from("borrow_request_deleted_for")
        .select("borrow_request_id")
        .eq("user_id", sessionUserId)
        .in("borrow_request_id", ids);
      if (!alive) return;
      if (del.error) {
        setPendingIncomingBorrows(ids.length);
        return;
      }
      const hidden = new Set(
        ((del.data ?? []) as any[])
          .map((r) => Number(r.borrow_request_id))
          .filter((n) => Number.isFinite(n))
      );
      setPendingIncomingBorrows(ids.filter((id) => !hidden.has(id)).length);
    }

    refreshPendingIncomingBorrows();
    timer = window.setInterval(refreshPendingIncomingBorrows, 30_000);
    window.addEventListener("om:borrow-requests-changed", refreshPendingIncomingBorrows);
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
      window.removeEventListener("om:borrow-requests-changed", refreshPendingIncomingBorrows);
    };
  }, [sessionUserId]);

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;

    async function refreshPendingCatalogInvites() {
      if (!supabase || !sessionUserId) {
        setPendingCatalogInvites(0);
        return;
      }
      try {
        const sess = await supabase.auth.getSession();
        const token = sess.data.session?.access_token ?? null;
        if (!token) {
          if (!alive) return;
          setPendingCatalogInvites(0);
          return;
        }
        const res = await fetch("/api/catalog/invitations/pending", {
          method: "GET",
          headers: { authorization: `Bearer ${token}` }
        });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setPendingCatalogInvites(0);
          return;
        }
        const invitations = Array.isArray((json as any)?.invitations) ? ((json as any).invitations as any[]) : [];
        setPendingCatalogInvites(invitations.length);
      } catch {
        if (!alive) return;
        setPendingCatalogInvites(0);
      }
    }

    refreshPendingCatalogInvites();
    timer = window.setInterval(refreshPendingCatalogInvites, 30_000);
    window.addEventListener("om:catalog-members-changed", refreshPendingCatalogInvites);
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
      window.removeEventListener("om:catalog-members-changed", refreshPendingCatalogInvites);
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

    async function refreshUnreadThreads() {
      if (!supabase || !sessionUserId) {
        setUnreadThreads(0);
        setUnreadLatestId(null);
        setUnreadLatestStatus(null);
        return;
      }
      const summary = await supabase.rpc("unread_borrow_threads_summary");
      if (!alive) return;
      if (!summary.error && summary.data) {
        const row = Array.isArray(summary.data) ? (summary.data[0] as any) : (summary.data as any);
        const count = Number(row?.unread_count ?? 0);
        const latestId = row?.latest_borrow_request_id ? Number(row.latest_borrow_request_id) : null;
        setUnreadThreads(Number.isFinite(count) ? count : 0);
        setUnreadLatestId(Number.isFinite(latestId as any) ? (latestId as number) : null);
        setUnreadLatestStatus(row?.latest_status ? String(row.latest_status) : null);
        return;
      }

      // Fallbacks (older RPCs).
      const res = await supabase.rpc("unread_borrow_threads_count");
      if (!alive) return;
      if (!res.error) {
        setUnreadThreads((res.data as any) ?? 0);
        setUnreadLatestId(null);
        setUnreadLatestStatus(null);
        return;
      }

      const old = await supabase.rpc("unread_incoming_borrow_requests_count");
      if (!alive) return;
      setUnreadThreads(old.error ? 0 : ((old.data as any) ?? 0));
      setUnreadLatestId(null);
      setUnreadLatestStatus(null);
    }

    refreshUnreadThreads();
    timer = window.setInterval(refreshUnreadThreads, 30_000);
    window.addEventListener("om:borrow-requests-changed", refreshUnreadThreads);

    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
      window.removeEventListener("om:borrow-requests-changed", refreshUnreadThreads);
    };
  }, [sessionUserId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !sessionUserId) {
        setMe(null);
        setAvatarUrl(null);
        setIsAdmin(false);
        return;
      }
      const res = await supabase.from("profiles").select("username,avatar_path,role,status").eq("id", sessionUserId).maybeSingle();
      if (!alive) return;
      if (res.error || !res.data?.username) {
        setMe(null);
        setAvatarUrl(null);
        setIsAdmin(false);
        return;
      }
      const next = {
        username: res.data.username as string,
        avatar_path: (res.data as any).avatar_path as string | null,
        role: ((res.data as any).role as string | null) ?? null,
        status: ((res.data as any).status as string | null) ?? null
      };
      setMe(next);
      setIsAdmin(String(next.role ?? "") === "admin" && String(next.status ?? "") !== "disabled");

      if (next.avatar_path) {
        const path = String(next.avatar_path ?? "").trim();
        if (/^https?:\/\//i.test(path)) {
          setAvatarUrl(path);
          return;
        }
        const signed = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 30);
        if (!alive) return;
        if (signed.data?.signedUrl) {
          setAvatarUrl(signed.data.signedUrl);
        } else {
          const pub = supabase.storage.from("avatars").getPublicUrl(path);
          setAvatarUrl(pub.data?.publicUrl ?? null);
        }
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

  const messagesHref = useMemo(() => {
    if (unreadLatestId) return `/app/messages/${unreadLatestId}`;
    return "/app/messages";
  }, [unreadThreads, unreadLatestId]);

  const messagesBadge = useMemo(() => {
    if (unreadThreads <= 0) return null;
    const status = String(unreadLatestStatus ?? "").toLowerCase();
    if (unreadThreads === 1 && (status === "approved" || status === "rejected")) {
      return {
        text: status === "approved" ? "✓" : "×",
        bg: status === "approved" ? "#0b6b2e" : "#b00020"
      };
    }
    return { text: String(unreadThreads), bg: "#b00020" };
  }, [unreadThreads, unreadLatestStatus]);

  if (!supabase) return null;
  const adminActive = (pathname ?? "").startsWith("/admin");
  const settingsActive = (pathname ?? "").startsWith("/app/settings");

  return (
    <div className="container">
      <div style={{ padding: "8px 0 6px" }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-10)" }}>
          <div>
            <Link href={sessionUserId ? "/app" : "/"} style={{ textDecoration: "none" }}>
              Other Library
            </Link>
          </div>

          <div className="row" style={{ gap: "var(--space-md)", alignItems: "center", flexWrap: "wrap" }}>
            {sessionUserId && editInAppHref ? (
              <Link href={editInAppHref} aria-label="Edit this page in the app">
                Edit in app
              </Link>
            ) : null}

            {sessionUserId && messagesBadge ? (
              <Link href={messagesHref} aria-label={`${unreadThreads} unread conversations`} style={{ textDecoration: "none" }}>
                <span className="om-nav-badge om-nav-badge--square" style={{ background: messagesBadge.bg }}>
                  {messagesBadge.text}
                </span>
              </Link>
            ) : null}

            {sessionUserId && pendingRequests > 0 ? (
              <Link href="/app/follows" aria-label={`${pendingRequests} pending follow requests`} style={{ textDecoration: "none" }}>
                <span className="om-nav-badge om-nav-badge--circle" style={{ background: "#b00020" }}>
                  {pendingRequests}
                </span>
              </Link>
            ) : null}

            {sessionUserId && pendingIncomingBorrows > 0 ? (
              <Link href="/app/settings?tab=loans" aria-label={`${pendingIncomingBorrows} pending incoming borrow requests`} style={{ textDecoration: "none" }}>
                <span className="om-nav-badge om-nav-badge--circle" style={{ background: "#b00020" }}>
                  {pendingIncomingBorrows}
                </span>
              </Link>
            ) : null}

            {sessionUserId && pendingCatalogInvites > 0 ? (
              <Link href="/app/catalog-invitations" aria-label={`${pendingCatalogInvites} pending catalog invitations`} style={{ textDecoration: "none" }}>
                <span className="om-nav-badge om-nav-badge--circle" style={{ background: "#2563eb" }}>
                  {pendingCatalogInvites}
                </span>
              </Link>
            ) : null}

            {sessionUserId && (avatarUrl || me?.username) ? (
              <div className="om-avatar-lockup">
                {avatarUrl ? (
                  <Link href={me?.username ? `/u/${me.username}` : "/app"} aria-label="Open your public profile" className="om-avatar-link">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src={avatarUrl} className="om-avatar-img om-avatar-img-nav" />
                  </Link>
                ) : null}

                {me?.username ? (
                  <Link href="/app" className="text-muted" style={{ textDecoration: "none" }}>
                    {me.username}
                  </Link>
                ) : null}
              </div>
            ) : null}

            {sessionUserId && isAdmin ? (
              <Link href="/admin" style={adminActive ? { textDecoration: "underline" } : undefined}>
                Admin
              </Link>
            ) : null}
            {sessionUserId ? (
              <Link href="/app/settings" style={settingsActive ? { textDecoration: "underline" } : undefined}>
                Settings
              </Link>
            ) : null}
            {sessionUserId && <button onClick={signOut}>Sign out</button>}
            {!sessionUserId && <Link href="/">Sign in</Link>}
          </div>
        </div>
      </div>
      <hr className="om-hr" style={{ marginTop: 3, marginBottom: 9 }} />
    </div>
  );
}
