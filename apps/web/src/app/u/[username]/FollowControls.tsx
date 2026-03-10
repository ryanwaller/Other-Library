"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type FollowStatus = "pending" | "approved" | "rejected";

export default function FollowControls({
  profileId,
  profileUsername,
  compact,
  inline
}: {
  profileId: string;
  profileUsername: string;
  compact?: boolean;
  inline?: boolean;
}) {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [row, setRow] = useState<{ status: FollowStatus } | null>(null);
  const [followsYou, setFollowsYou] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSessionUserId(data.session?.user?.id ?? null);
      setAuthLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSessionUserId(newSession?.user?.id ?? null);
      setAuthLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const isSelf = useMemo(() => {
    if (!sessionUserId) return false;
    return sessionUserId === profileId;
  }, [sessionUserId, profileId]);

  async function refresh() {
    if (!supabase || !sessionUserId) return;
    if (sessionUserId === profileId) return;
    const [res, reverse] = await Promise.all([
      supabase.from("follows").select("status").eq("follower_id", sessionUserId).eq("followee_id", profileId).maybeSingle(),
      supabase.from("follows").select("status").eq("follower_id", profileId).eq("followee_id", sessionUserId).eq("status", "approved").maybeSingle(),
    ]);

    if (res.error) {
      setRow(null);
      setFollowsYou(false);
      setError(res.error.message);
      return;
    }
    setError(null);
    setRow((res.data as any) ?? null);
    setFollowsYou(Boolean(reverse.data));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId, profileId]);

  async function requestFollow() {
    if (!supabase || !sessionUserId) return;
    setBusy(true);
    setError(null);
    try {
      const ins = await supabase.from("follows").insert({ follower_id: sessionUserId, followee_id: profileId, status: "pending" });
      if (ins.error) throw new Error(ins.error.message);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrUnfollow() {
    if (!supabase || !sessionUserId) return;
    setBusy(true);
    setError(null);
    try {
      const del = await supabase.from("follows").delete().eq("follower_id", sessionUserId).eq("followee_id", profileId);
      if (del.error) throw new Error(del.error.message);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!supabase) return null;
  if (isSelf) return null;

  if (!sessionUserId) {
    if (authLoading || compact) return null;
    return (
      <div style={{ marginTop: compact || inline ? 0 : 10 }} className="text-muted">
        <Link href="/app">Sign in</Link> to follow.
      </div>
    );
  }

  const status = row?.status ?? null;
  const containerStyle = {
    marginTop: compact || inline ? 0 : 10,
    display: "inline-flex",
    gap: "var(--space-10)",
    alignItems: "baseline" as const,
    flexWrap: "wrap" as const
  };
  const actionStyle = compact ? undefined : ({ marginLeft: 2 } as const);

  return (
    <div style={containerStyle}>
      {status === "approved" ? (
        <>
          {!compact ? <span className="text-muted">You follow</span> : null}
          <button onClick={cancelOrUnfollow} disabled={busy} style={actionStyle}>
            {busy ? "Working…" : "Unfollow"}
          </button>
        </>
      ) : status === "pending" ? (
        <>
          {!compact ? <span className="text-muted">Requested</span> : null}
          <button onClick={cancelOrUnfollow} disabled={busy} style={actionStyle}>
            {busy ? "Working…" : "Cancel request"}
          </button>
        </>
      ) : status === "rejected" ? (
        <>
          {!compact ? <span className="text-muted">Request was rejected</span> : null}
          <button onClick={requestFollow} disabled={busy} style={actionStyle}>
            {busy ? "Working…" : "Request again"}
          </button>
        </>
      ) : (
        <button onClick={requestFollow} disabled={busy}>
          {busy ? "Requesting…" : followsYou ? "Follow back" : "Request follow"}
        </button>
      )}
      {error ? (
        <span className="text-muted" style={{ marginLeft: "var(--space-10)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
