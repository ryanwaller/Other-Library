"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";

function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

function isValidUsername(input: string): boolean {
  const s = normalizeUsername(input);
  if (s.length < 3 || s.length > 24) return false;
  if (!/^[a-z0-9_]+$/.test(s)) return false;
  if (s.startsWith("_") || s.endsWith("_")) return false;
  return true;
}

function humanizeUsernameError(message: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("not_authenticated")) return "Please sign in again.";
  if (m.includes("profile_not_found")) return "Profile not found.";
  if (m.includes("invalid_username")) return "Username is invalid.";
  if (m.includes("reserved_username")) return "That username is reserved.";
  if (m.includes("username_taken")) return "That username is already taken (or previously used).";
  return message;
}

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

  return (
    <div className="card">
      <div className="row">
        <div>Email</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div>Password</div>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={signIn} disabled={busy || !email || !password}>
          Sign in
        </button>
        <button onClick={signUp} disabled={busy || !email || !password}>
          Sign up
        </button>
        {error ? <span className="muted">{error}</span> : null}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [profile, setProfile] = useState<{ username: string; display_name: string | null; bio: string | null; visibility: string } | null>(null);
  const [aliases, setAliases] = useState<Array<{ old_username: string; created_at: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newUsername, setNewUsername] = useState("");
  const [changeState, setChangeState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [profileForm, setProfileForm] = useState<{ display_name: string; bio: string; visibility: "followers_only" | "public" }>({
    display_name: "",
    bio: "",
    visibility: "followers_only"
  });
  const [profileSaveState, setProfileSaveState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !userId) return;
      setBusy(true);
      setError(null);
      const res = await supabase.from("profiles").select("username,display_name,bio,visibility").eq("id", userId).maybeSingle();
      if (!alive) return;
      if (res.error) setError(res.error.message);
      const nextProfile = ((res.data as any) ?? null) as typeof profile;
      setProfile(nextProfile);
      if (nextProfile) {
        setProfileForm({
          display_name: (nextProfile.display_name ?? "") as string,
          bio: (nextProfile.bio ?? "") as string,
          visibility: (nextProfile.visibility === "public" ? "public" : "followers_only") as any
        });
      }
      setBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !userId) return;
      const res = await supabase
        .from("username_aliases")
        .select("old_username,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (!alive) return;
      if (res.error) return;
      setAliases((res.data as any) ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [userId, profile?.username]);

  const normalized = useMemo(() => normalizeUsername(newUsername), [newUsername]);
  const canSubmit = useMemo(() => {
    if (!profile) return false;
    if (!normalized) return false;
    if (normalized === profile.username) return false;
    return isValidUsername(normalized);
  }, [profile, normalized]);

  async function changeUsername() {
    if (!supabase || !userId || !profile) return;
    setChangeState({ busy: true, error: null, message: "Saving…" });
    const next = normalized;
    const res = await supabase.rpc("change_username", { new_username: next });
    if (res.error) {
      setChangeState({ busy: false, error: humanizeUsernameError(res.error.message), message: "Failed" });
      return;
    }
    const payload = (res.data as any) ?? null;
    const actualNext = typeof payload?.new === "string" ? payload.new : next;
    const actualPrev = typeof payload?.old === "string" ? payload.old : profile.username;
    setProfile((p) => (p ? { ...p, username: actualNext } : p));
    setNewUsername("");
    setChangeState({ busy: false, error: null, message: actualPrev !== actualNext ? `Saved (@${actualPrev} → @${actualNext})` : "Saved" });
  }

  async function saveProfile() {
    if (!supabase || !userId) return;
    setProfileSaveState({ busy: true, error: null, message: "Saving…" });
    const payload = {
      display_name: profileForm.display_name.trim() ? profileForm.display_name.trim() : null,
      bio: profileForm.bio.trim() ? profileForm.bio.trim() : null,
      visibility: profileForm.visibility
    };
    const res = await supabase.from("profiles").update(payload).eq("id", userId).select("username,display_name,bio,visibility").maybeSingle();
    if (res.error) {
      setProfileSaveState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }
    const nextProfile = ((res.data as any) ?? null) as typeof profile;
    if (nextProfile) setProfile(nextProfile);
    setProfileSaveState({ busy: false, error: null, message: "Saved" });
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
          <Link href="/app">← Back</Link>
        </div>
        <div className="row">{session ? <button onClick={() => supabase?.auth.signOut()}>Sign out</button> : null}</div>
      </div>

      {!session ? (
        <SignIn />
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>Settings</div>
            <div className="muted">{busy ? "Loading…" : error ? error : ""}</div>
          </div>

          <div style={{ marginTop: 16 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Username</div>
              <div className="muted">{profile ? `@${profile.username}` : ""}</div>
            </div>

            <div className="muted" style={{ marginTop: 8 }}>
              This affects your public/crawlable URLs. Old usernames permanently redirect to the new one.
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <input
                placeholder="new_username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                style={{ width: 220 }}
              />
              <button onClick={changeUsername} disabled={!canSubmit || changeState.busy}>
                {changeState.busy ? "Saving…" : "Change username"}
              </button>
              <div className="muted">
                {changeState.message ? (changeState.error ? `${changeState.message} (${changeState.error})` : changeState.message) : ""}
              </div>
            </div>

            <div className="muted" style={{ marginTop: 8 }}>
              Rules: 3–24 chars, lowercase letters/numbers/underscore. No leading/trailing underscore.
            </div>

            {profile ? (
              <div className="muted" style={{ marginTop: 10 }}>
                Public profile:{" "}
                <a href={`/u/${profile.username}`} target="_blank" rel="noreferrer">
                  /u/{profile.username}
                </a>
              </div>
            ) : null}

            {aliases.length > 0 ? (
              <div className="muted" style={{ marginTop: 10 }}>
                Redirects from old usernames:{" "}
                {aliases.map((a, idx) => (
                  <span key={a.old_username}>
                    <a href={`/u/${a.old_username}`} target="_blank" rel="noreferrer">
                      /u/{a.old_username}
                    </a>
                    {idx < aliases.length - 1 ? ", " : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 16 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Profile</div>
              <div className="muted">
                {profileSaveState.message
                  ? profileSaveState.error
                    ? `${profileSaveState.message} (${profileSaveState.error})`
                    : profileSaveState.message
                  : ""}
              </div>
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <div style={{ width: 120 }} className="muted">
                Display name
              </div>
              <input
                value={profileForm.display_name}
                onChange={(e) => setProfileForm((p) => ({ ...p, display_name: e.target.value }))}
                placeholder="(optional)"
                style={{ width: 360 }}
              />
            </div>

            <div className="row" style={{ marginTop: 10, alignItems: "flex-start" }}>
              <div style={{ width: 120 }} className="muted">
                Bio
              </div>
              <textarea
                value={profileForm.bio}
                onChange={(e) => setProfileForm((p) => ({ ...p, bio: e.target.value }))}
                placeholder="(optional)"
                style={{ width: 360, height: 110 }}
              />
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <div style={{ width: 120 }} className="muted">
                Library visibility
              </div>
              <select
                value={profileForm.visibility}
                onChange={(e) => setProfileForm((p) => ({ ...p, visibility: (e.target.value === "public" ? "public" : "followers_only") as any }))}
              >
                <option value="followers_only">followers_only</option>
                <option value="public">public</option>
              </select>
              <div className="muted">
                {profileForm.visibility === "public" ? "Anyone can view /u/username" : "Only approved followers (and public book overrides)."}
              </div>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={saveProfile} disabled={profileSaveState.busy}>
                {profileSaveState.busy ? "Saving…" : "Save profile"}
              </button>
              {profile ? (
                <a href={`/u/${profile.username}`} target="_blank" rel="noreferrer" className="muted">
                  View public profile
                </a>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
