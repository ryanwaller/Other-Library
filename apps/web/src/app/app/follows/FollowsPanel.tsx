"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";
import SignInCard from "../../components/SignInCard";
import IdentityRow from "../../components/IdentityRow";

type FollowRow = {
  follower_id: string;
  followee_id: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
};

type MiniProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
  visibility: "followers_only" | "public";
};

function notifyFollowsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("om:follows-changed"));
}

export default function FollowsPanel({ embedded = false }: { embedded?: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [incoming, setIncoming] = useState<FollowRow[]>([]);
  const [outgoing, setOutgoing] = useState<FollowRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, MiniProfile>>({});
  const [avatarUrlsByPath, setAvatarUrlsByPath] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  const incomingPending = useMemo(() => incoming.filter((r) => r.status === "pending"), [incoming]);
  const incomingApproved = useMemo(() => incoming.filter((r) => r.status === "approved"), [incoming]);
  const outgoingPending = useMemo(() => outgoing.filter((r) => r.status === "pending"), [outgoing]);
  const outgoingApproved = useMemo(() => outgoing.filter((r) => r.status === "approved"), [outgoing]);
  const outgoingRejected = useMemo(() => outgoing.filter((r) => r.status === "rejected"), [outgoing]);

  function myOutgoingStatusFor(followeeId: string): FollowRow["status"] | null {
    const row = outgoing.find((r) => r.followee_id === followeeId) ?? null;
    return row?.status ?? null;
  }

  function profileUsername(id: string): string | null {
    const u = (profilesById[id]?.username ?? "").trim();
    return u || null;
  }

  function profileLabel(id: string): string {
    const u = profileUsername(id);
    return u ?? id;
  }

  function avatarUrlFor(id: string): string | null {
    const path = profilesById[id]?.avatar_path ?? null;
    if (!path) return null;
    return avatarUrlsByPath[path] ?? null;
  }

  async function refresh() {
    if (!supabase || !userId) return;
    setBusy(true);
    setError(null);
    setActionError(null);
    try {
      const [incomingRes, outgoingRes] = await Promise.all([
        supabase.from("follows").select("follower_id,followee_id,status,created_at,updated_at").eq("followee_id", userId),
        supabase.from("follows").select("follower_id,followee_id,status,created_at,updated_at").eq("follower_id", userId)
      ]);
      if (incomingRes.error) throw new Error(incomingRes.error.message);
      if (outgoingRes.error) throw new Error(outgoingRes.error.message);

      const incomingRows = (incomingRes.data ?? []) as any as FollowRow[];
      const outgoingRows = (outgoingRes.data ?? []) as any as FollowRow[];
      setIncoming(incomingRows);
      setOutgoing(outgoingRows);

      const otherIds = Array.from(
        new Set([
          ...incomingRows.map((r) => r.follower_id),
          ...outgoingRows.map((r) => r.followee_id)
        ])
      ).filter(Boolean);

      if (otherIds.length === 0) {
        setProfilesById({});
        setAvatarUrlsByPath({});
        return;
      }

      const profilesRes = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_path,visibility")
        .in("id", otherIds);
      if (profilesRes.error) throw new Error(profilesRes.error.message);

      const pmap: Record<string, MiniProfile> = {};
      for (const p of (profilesRes.data ?? []) as any[]) {
        if (p?.id && p?.username) pmap[p.id] = p as MiniProfile;
      }
      setProfilesById(pmap);

      const avatarPaths = Array.from(new Set(Object.values(pmap).map((p) => p.avatar_path).filter(Boolean))) as string[];
      if (avatarPaths.length === 0) {
        setAvatarUrlsByPath({});
        return;
      }

      const signed = await supabase.storage.from("avatars").createSignedUrls(avatarPaths, 60 * 30);
      const amap: Record<string, string> = {};
      for (const s of signed.data ?? []) {
        if (s.path && s.signedUrl) amap[s.path] = s.signedUrl;
      }
      setAvatarUrlsByPath(amap);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load follows");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function approve(followerId: string) {
    if (!supabase || !userId) return;
    const key = `approve:${followerId}`;
    setActionBusyKey(key);
    setActionError(null);
    try {
      const res = await supabase
        .from("follows")
        .update({ status: "approved" })
        .eq("follower_id", followerId)
        .eq("followee_id", userId);
      if (res.error) throw new Error(res.error.message);
      notifyFollowsChanged();
      await refresh();
    } catch (e: any) {
      setActionError(e?.message ?? "Approve failed");
    } finally {
      setActionBusyKey(null);
    }
  }

  async function reject(followerId: string) {
    if (!supabase || !userId) return;
    const key = `reject:${followerId}`;
    setActionBusyKey(key);
    setActionError(null);
    try {
      const res = await supabase
        .from("follows")
        .update({ status: "rejected" })
        .eq("follower_id", followerId)
        .eq("followee_id", userId);
      if (res.error) throw new Error(res.error.message);
      notifyFollowsChanged();
      await refresh();
    } catch (e: any) {
      setActionError(e?.message ?? "Reject failed");
    } finally {
      setActionBusyKey(null);
    }
  }

  async function removeFollowee(followeeId: string) {
    if (!supabase || !userId) return;
    const key = `unfollow:${followeeId}`;
    setActionBusyKey(key);
    setActionError(null);
    try {
      const res = await supabase.from("follows").delete().eq("follower_id", userId).eq("followee_id", followeeId);
      if (res.error) throw new Error(res.error.message);
      notifyFollowsChanged();
      await refresh();
    } catch (e: any) {
      setActionError(e?.message ?? "Unfollow failed");
    } finally {
      setActionBusyKey(null);
    }
  }

  async function requestAgain(followeeId: string) {
    if (!supabase || !userId) return;
    const key = `again:${followeeId}`;
    setActionBusyKey(key);
    setActionError(null);
    try {
      const del = await supabase.from("follows").delete().eq("follower_id", userId).eq("followee_id", followeeId);
      if (del.error) throw new Error(del.error.message);
      const ins = await supabase.from("follows").insert({ follower_id: userId, followee_id: followeeId, status: "pending" });
      if (ins.error) throw new Error(ins.error.message);
      notifyFollowsChanged();
      await refresh();
    } catch (e: any) {
      setActionError(e?.message ?? "Request failed");
    } finally {
      setActionBusyKey(null);
    }
  }

  async function requestFollow(followeeId: string) {
    if (!supabase || !userId) return;
    const key = `follow:${followeeId}`;
    setActionBusyKey(key);
    setActionError(null);
    try {
      const ins = await supabase.from("follows").insert({ follower_id: userId, followee_id: followeeId, status: "pending" });
      if (ins.error) throw new Error(ins.error.message);
      notifyFollowsChanged();
      await refresh();
    } catch (e: any) {
      setActionError(e?.message ?? "Request failed");
    } finally {
      setActionBusyKey(null);
    }
  }

  if (!supabase) {
    if (embedded) {
      return (
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
        </div>
      );
    }
    return (
      <main className="container">
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
        </div>
      </main>
    );
  }

  const content = !session ? (
    <SignInCard note="Sign in to manage follow requests." />
  ) : (
    <div className="card">
          <div className="text-muted">{busy ? "Loading…" : error ? error : ""}</div>
          {actionError ? (
            <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
              {actionError}
            </div>
          ) : null}

          <div className="om-list-row">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Incoming requests</div>
              <div className="text-muted">{incomingPending.length}</div>
            </div>
            {incomingPending.length === 0 ? (
              <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                None.
              </div>
            ) : (
              <div style={{ marginTop: "var(--space-8)" }}>
                {incomingPending.map((r) => {
                  const pid = r.follower_id;
                  const username = profileUsername(pid);
                  const name = profileLabel(pid);
                  const avatarUrl = avatarUrlFor(pid);
                  if (!username) return null;
                  return (
                    <div key={`${r.follower_id}:${r.followee_id}`} style={{ marginTop: "var(--space-8)" }}>
                      <IdentityRow
                        avatarUrl={avatarUrl}
                        displayName={profilesById[pid]?.display_name ?? null}
                        username={username}
                        rightSlot={
                          <div className="row" style={{ minWidth: 220, width: 220, justifyContent: "space-between", gap: "var(--space-lg)" }}>
                            <button onClick={() => approve(pid)} disabled={actionBusyKey !== null}>
                              {actionBusyKey === `approve:${pid}` ? "Approving…" : "Approve"}
                            </button>
                            <button onClick={() => reject(pid)} disabled={actionBusyKey !== null}>
                              {actionBusyKey === `reject:${pid}` ? "Rejecting…" : "Reject"}
                            </button>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="om-list-row">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Your followers</div>
              <div className="text-muted">{incomingApproved.length}</div>
            </div>
            {incomingApproved.length === 0 ? (
              <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                None yet.
              </div>
            ) : (
              <div style={{ marginTop: "var(--space-8)" }}>
                {incomingApproved.map((r) => {
                  const pid = r.follower_id;
                  const username = profileUsername(pid);
                  const name = profileLabel(pid);
                  const avatarUrl = avatarUrlFor(pid);
                  const outgoingStatus = myOutgoingStatusFor(pid);
                  if (!username) return null;
                  return (
                    <div key={`${r.follower_id}:${r.followee_id}`} style={{ marginTop: "var(--space-8)" }}>
                      <IdentityRow
                        avatarUrl={avatarUrl}
                        displayName={profilesById[pid]?.display_name ?? null}
                        username={username}
                        rightSlot={
                          <div className="row">
                            {outgoingStatus === null ? (
                              <button onClick={() => requestFollow(pid)} disabled={actionBusyKey !== null} style={{ marginRight: 8 }}>
                                {actionBusyKey === `follow:${pid}` ? "Requesting…" : "Follow back"}
                              </button>
                            ) : outgoingStatus === "approved" ? (
                              <span className="text-muted" style={{ marginRight: 8 }}>
                                Following
                              </span>
                            ) : outgoingStatus === "pending" ? (
                              <span className="text-muted" style={{ marginRight: 8 }}>
                                Requested
                              </span>
                            ) : (
                              <button onClick={() => requestAgain(pid)} disabled={actionBusyKey !== null} style={{ marginRight: 8 }}>
                                {actionBusyKey === `again:${pid}` ? "Requesting…" : "Request again"}
                              </button>
                            )}
                            <button onClick={() => reject(pid)} disabled={actionBusyKey !== null}>
                              {actionBusyKey === `reject:${pid}` ? "Removing…" : "Remove"}
                            </button>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="om-list-row">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>You follow</div>
              <div className="text-muted">{outgoingApproved.length}</div>
            </div>
            {outgoingApproved.length === 0 ? (
              <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                None.
              </div>
            ) : (
              <div style={{ marginTop: "var(--space-8)" }}>
                {outgoingApproved.map((r) => {
                  const pid = r.followee_id;
                  const username = profileUsername(pid);
                  const name = profileLabel(pid);
                  const avatarUrl = avatarUrlFor(pid);
                  if (!username) return null;
                  return (
                    <div key={`${r.follower_id}:${r.followee_id}`} style={{ marginTop: "var(--space-8)" }}>
                      <IdentityRow
                        avatarUrl={avatarUrl}
                        displayName={profilesById[pid]?.display_name ?? null}
                        username={username}
                        rightSlot={
                          <div className="row">
                            <button onClick={() => removeFollowee(pid)} disabled={actionBusyKey !== null}>
                              {actionBusyKey === `unfollow:${pid}` ? "Unfollowing…" : "Unfollow"}
                            </button>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="om-list-row">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Outgoing requests</div>
              <div className="text-muted">{outgoingPending.length}</div>
            </div>
            {outgoingPending.length === 0 ? (
              <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                None.
              </div>
            ) : (
              <div style={{ marginTop: "var(--space-8)" }}>
                {outgoingPending.map((r) => {
                  const pid = r.followee_id;
                  const username = profileUsername(pid);
                  const name = profileLabel(pid);
                  const avatarUrl = avatarUrlFor(pid);
                  if (!username) return null;
                  return (
                    <div key={`${r.follower_id}:${r.followee_id}`} style={{ marginTop: "var(--space-8)" }}>
                      <IdentityRow
                        avatarUrl={avatarUrl}
                        displayName={profilesById[pid]?.display_name ?? null}
                        username={username}
                        rightSlot={
                          <div className="row">
                            <button onClick={() => removeFollowee(pid)} disabled={actionBusyKey !== null}>
                              {actionBusyKey === `unfollow:${pid}` ? "Canceling…" : "Cancel request"}
                            </button>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="om-list-row">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Rejected requests</div>
              <div className="text-muted">{outgoingRejected.length}</div>
            </div>
            {outgoingRejected.length === 0 ? (
              <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                None.
              </div>
            ) : (
              <div style={{ marginTop: "var(--space-8)" }}>
                {outgoingRejected.map((r) => {
                  const pid = r.followee_id;
                  const username = profileUsername(pid);
                  const name = profileLabel(pid);
                  const avatarUrl = avatarUrlFor(pid);
                  if (!username) return null;
                  return (
                    <div key={`${r.follower_id}:${r.followee_id}`} style={{ marginTop: "var(--space-8)" }}>
                      <IdentityRow
                        avatarUrl={avatarUrl}
                        displayName={profilesById[pid]?.display_name ?? null}
                        username={username}
                        rightSlot={
                          <div className="row">
                            <button onClick={() => requestAgain(pid)} disabled={actionBusyKey !== null}>
                              {actionBusyKey === `again:${pid}` ? "Requesting…" : "Request again"}
                            </button>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );

  if (embedded) return content;
  return <main className="container">{content}</main>;
}
