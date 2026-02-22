"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";

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

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signUp() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  }

  async function signIn() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await signIn();
  }

  return (
    <div className="card">
      <form onSubmit={onSubmit}>
        <div className="row">
          <div>Email</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div>Password</div>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy || !email || !password}>
            Sign in
          </button>
          <button type="button" onClick={signUp} disabled={busy || !email || !password}>
            Sign up
          </button>
          {error ? <span className="muted">{error}</span> : null}
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          Sign in to manage follow requests.
        </div>
      </form>
    </div>
  );
}

export default function FollowsPage() {
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
      await refresh();
    } catch (e: any) {
      setActionError(e?.message ?? "Request failed");
    } finally {
      setActionBusyKey(null);
    }
  }

  if (!supabase) {
    return (
      <main className="container">
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="muted">
          <Link href="/app">Home</Link>
        </div>
        <div className="row">
          <Link href="/app/settings">Settings</Link>
          {session ? <button onClick={() => supabase?.auth.signOut()}>Sign out</button> : null}
        </div>
      </div>

      {!session ? (
        <SignIn />
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>Follows</div>
            <div className="muted">{busy ? "Loading…" : error ? error : ""}</div>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Followers-only content is visible only to <span>approved</span> followers.
          </div>
          {actionError ? (
            <div className="muted" style={{ marginTop: 8 }}>
              {actionError}
            </div>
          ) : null}

          <div style={{ marginTop: 16 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Incoming requests</div>
              <div className="muted">{incomingPending.length}</div>
            </div>
            {incomingPending.length === 0 ? (
              <div className="muted" style={{ marginTop: 8 }}>
                None.
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {incomingPending.map((r) => {
                  const pid = r.follower_id;
                  const username = profileUsername(pid);
                  const name = profileLabel(pid);
                  const avatarUrl = avatarUrlFor(pid);
                  return (
                    <div key={`${r.follower_id}:${r.followee_id}`} className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                      <div className="row">
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt="" src={avatarUrl} style={{ width: 18, height: 18, borderRadius: 999, border: "1px solid var(--border)" }} />
                        ) : null}
                        {username ? <Link href={`/u/${username}`}>{name}</Link> : <span className="muted">{name}</span>}
                      </div>
                      <div className="row">
                        <button onClick={() => approve(pid)} disabled={actionBusyKey !== null}>
                          {actionBusyKey === `approve:${pid}` ? "Approving…" : "Approve"}
                        </button>
                        <button onClick={() => reject(pid)} disabled={actionBusyKey !== null} style={{ marginLeft: 8 }}>
                          {actionBusyKey === `reject:${pid}` ? "Rejecting…" : "Reject"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Your followers</div>
              <div className="muted">{incomingApproved.length}</div>
            </div>
            {incomingApproved.length === 0 ? (
              <div className="muted" style={{ marginTop: 8 }}>
                None yet.
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {incomingApproved.map((r) => {
                  const pid = r.follower_id;
                  const username = profileUsername(pid);
                  const name = profileLabel(pid);
                  const avatarUrl = avatarUrlFor(pid);
                  return (
                    <div key={`${r.follower_id}:${r.followee_id}`} className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                      <div className="row">
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt="" src={avatarUrl} style={{ width: 18, height: 18, borderRadius: 999, border: "1px solid var(--border)" }} />
                        ) : null}
                        {username ? <Link href={`/u/${username}`}>{name}</Link> : <span className="muted">{name}</span>}
                      </div>
                      <div className="row">
                        <button onClick={() => reject(pid)} disabled={actionBusyKey !== null}>
                          {actionBusyKey === `reject:${pid}` ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>You follow</div>
              <div className="muted">{outgoingApproved.length}</div>
            </div>
            {outgoingApproved.length === 0 ? (
              <div className="muted" style={{ marginTop: 8 }}>
                None.
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {outgoingApproved.map((r) => {
                  const pid = r.followee_id;
                  const username = profileUsername(pid);
                  const name = profileLabel(pid);
                  const avatarUrl = avatarUrlFor(pid);
                  return (
                    <div key={`${r.follower_id}:${r.followee_id}`} className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                      <div className="row">
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt="" src={avatarUrl} style={{ width: 18, height: 18, borderRadius: 999, border: "1px solid var(--border)" }} />
                        ) : null}
                        {username ? <Link href={`/u/${username}`}>{name}</Link> : <span className="muted">{name}</span>}
                      </div>
                      <div className="row">
                        <button onClick={() => removeFollowee(pid)} disabled={actionBusyKey !== null}>
                          {actionBusyKey === `unfollow:${pid}` ? "Unfollowing…" : "Unfollow"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Outgoing requests</div>
              <div className="muted">{outgoingPending.length}</div>
            </div>
            {outgoingPending.length === 0 ? (
              <div className="muted" style={{ marginTop: 8 }}>
                None.
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {outgoingPending.map((r) => {
                  const pid = r.followee_id;
                  const username = profileUsername(pid);
                  const name = profileLabel(pid);
                  const avatarUrl = avatarUrlFor(pid);
                  return (
                    <div key={`${r.follower_id}:${r.followee_id}`} className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                      <div className="row">
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt="" src={avatarUrl} style={{ width: 18, height: 18, borderRadius: 999, border: "1px solid var(--border)" }} />
                        ) : null}
                        {username ? <Link href={`/u/${username}`}>{name}</Link> : <span className="muted">{name}</span>}
                      </div>
                      <div className="row">
                        <button onClick={() => removeFollowee(pid)} disabled={actionBusyKey !== null}>
                          {actionBusyKey === `unfollow:${pid}` ? "Canceling…" : "Cancel request"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Rejected requests</div>
              <div className="muted">{outgoingRejected.length}</div>
            </div>
            {outgoingRejected.length === 0 ? (
              <div className="muted" style={{ marginTop: 8 }}>
                None.
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {outgoingRejected.map((r) => {
                  const pid = r.followee_id;
                  const username = profileUsername(pid);
                  const name = profileLabel(pid);
                  const avatarUrl = avatarUrlFor(pid);
                  return (
                    <div key={`${r.follower_id}:${r.followee_id}`} className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                      <div className="row">
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt="" src={avatarUrl} style={{ width: 18, height: 18, borderRadius: 999, border: "1px solid var(--border)" }} />
                        ) : null}
                        {username ? <Link href={`/u/${username}`}>{name}</Link> : <span className="muted">{name}</span>}
                      </div>
                      <div className="row">
                        <button onClick={() => requestAgain(pid)} disabled={actionBusyKey !== null}>
                          {actionBusyKey === `again:${pid}` ? "Requesting…" : "Request again"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
