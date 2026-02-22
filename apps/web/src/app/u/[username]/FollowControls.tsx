"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type FollowStatus = "pending" | "approved" | "rejected";

export default function FollowControls({ profileId, profileUsername }: { profileId: string; profileUsername: string }) {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [row, setRow] = useState<{ status: FollowStatus } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSessionUserId(newSession?.user?.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const isSelf = useMemo(() => {
    if (!sessionUserId) return false;
    return sessionUserId === profileId;
  }, [sessionUserId, profileId]);

  async function refresh() {
    if (!supabase || !sessionUserId) return;
    if (sessionUserId === profileId) return;
    const res = await supabase.from("follows").select("status").eq("follower_id", sessionUserId).eq("followee_id", profileId).maybeSingle();
    if (res.error) {
      setRow(null);
      setError(res.error.message);
      return;
    }
    setError(null);
    setRow((res.data as any) ?? null);
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
    return (
      <div style={{ marginTop: 10 }} className="muted">
        <Link href="/app">Sign in</Link> to follow.
      </div>
    );
  }

  const status = row?.status ?? null;

  return (
    <div style={{ marginTop: 10 }} className="row">
      {status === "approved" ? (
        <>
          <span className="muted">Following {profileUsername}</span>
          <button onClick={cancelOrUnfollow} disabled={busy} style={{ marginLeft: 10 }}>
            {busy ? "Working…" : "Unfollow"}
          </button>
        </>
      ) : status === "pending" ? (
        <>
          <span className="muted">Requested</span>
          <button onClick={cancelOrUnfollow} disabled={busy} style={{ marginLeft: 10 }}>
            {busy ? "Working…" : "Cancel request"}
          </button>
        </>
      ) : status === "rejected" ? (
        <>
          <span className="muted">Request was rejected</span>
          <button onClick={requestFollow} disabled={busy} style={{ marginLeft: 10 }}>
            {busy ? "Working…" : "Request again"}
          </button>
        </>
      ) : (
        <button onClick={requestFollow} disabled={busy}>
          {busy ? "Requesting…" : "Request follow"}
        </button>
      )}
      {error ? <span className="muted" style={{ marginLeft: 10 }}>{error}</span> : null}
    </div>
  );
}

