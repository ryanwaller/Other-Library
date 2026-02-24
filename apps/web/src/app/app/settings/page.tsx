"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";
import SignInCard from "../../components/SignInCard";

const RESERVED_USERNAMES = [
  "app",
  "api",
  "u",
  "b",
  "books",
  "setup",
  "settings",
  "auth",
  "login",
  "logout",
  "signup",
  "signin",
  "www",
  "admin",
  "root",
  "support",
  "help"
] as const;

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

function isReservedUsername(input: string): boolean {
  const s = normalizeUsername(input);
  return (RESERVED_USERNAMES as readonly string[]).includes(s);
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

function safeFileName(name: string): string {
  return name.trim().replace(/[^\w.\-]+/g, "_").slice(0, 120) || "image";
}

export default function SettingsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [profile, setProfile] = useState<{
    username: string;
    display_name: string | null;
    bio: string | null;
    visibility: string;
    avatar_path: string | null;
    borrowable_default: boolean;
    borrow_request_scope: "anyone" | "followers" | "following";
  } | null>(null);
  const [aliases, setAliases] = useState<Array<{ old_username: string; created_at: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [usernameAvailability, setUsernameAvailability] = useState<{ state: "idle" | "checking" | "available" | "taken" | "error"; message: string | null }>(
    { state: "idle", message: null }
  );

  const [profileForm, setProfileForm] = useState<{
    username: string;
    display_name: string;
    bio: string;
    visibility: "followers_only" | "public";
    borrowable_default: boolean;
    borrow_request_scope: "anyone" | "followers" | "following";
  }>({
    username: "",
    display_name: "",
    bio: "",
    visibility: "followers_only",
    borrowable_default: false,
    borrow_request_scope: "followers"
  });
  const [profileSaveState, setProfileSaveState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [avatarState, setAvatarState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
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
      const res = await supabase
        .from("profiles")
        .select("username,display_name,bio,visibility,avatar_path,borrowable_default,borrow_request_scope")
        .eq("id", userId)
        .maybeSingle();
      if (!alive) return;
      if (res.error) setError(res.error.message);
      const nextProfile = ((res.data as any) ?? null) as typeof profile;
      setProfile(nextProfile);
      if (nextProfile) {
        const rawScope = String((nextProfile as any).borrow_request_scope ?? "").trim();
        const normalizedScope =
          rawScope === "anyone" ? "anyone" : rawScope === "following" ? "following" : rawScope === "followers" ? "followers" : "followers";
        setProfileForm({
          username: (nextProfile.username ?? "") as string,
          display_name: (nextProfile.display_name ?? "") as string,
          bio: (nextProfile.bio ?? "") as string,
          visibility: (nextProfile.visibility === "public" ? "public" : "followers_only") as any,
          borrowable_default: Boolean((nextProfile as any).borrowable_default),
          borrow_request_scope: normalizedScope as any
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
      if (!supabase || !profile?.avatar_path) {
        setAvatarUrl(null);
        return;
      }
      const signed = await supabase.storage.from("avatars").createSignedUrl(profile.avatar_path, 60 * 60);
      if (!alive) return;
      setAvatarUrl(signed.data?.signedUrl ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [profile?.avatar_path]);

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

  const normalized = useMemo(() => normalizeUsername(profileForm.username), [profileForm.username]);
  const localUsernameIssue = useMemo(() => {
    if (!normalized) {
      if (profile && (profileForm.username ?? "").trim() === "") return "invalid";
      return null;
    }
    if (profile && normalized === profile.username) return null;
    if (!isValidUsername(normalized)) return "invalid";
    if (isReservedUsername(normalized)) return "reserved";
    return null;
  }, [normalized, profile?.username, profileForm.username]);

  const usernameSaveBlocked = useMemo(() => {
    if (!profile) return false;
    if (normalized === profile.username) return false;
    if (!normalized) return true;
    if (localUsernameIssue) return true;
    if (usernameAvailability.state === "checking") return true;
    if (usernameAvailability.state === "taken") return true;
    return false;
  }, [profile?.username, normalized, localUsernameIssue, usernameAvailability.state]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    if (localUsernameIssue === "invalid") {
      setUsernameAvailability({ state: "idle", message: normalized ? "Invalid format." : "Required." });
      return;
    }
    if (localUsernameIssue === "reserved") {
      setUsernameAvailability({ state: "idle", message: "Reserved word." });
      return;
    }
    if (!normalized || (profile && normalized === profile.username)) {
      setUsernameAvailability({ state: "idle", message: null });
      return;
    }

    setUsernameAvailability({ state: "checking", message: "Checking…" });
    const t = window.setTimeout(async () => {
      const res = await client.rpc("is_username_available", { input_username: normalized });
      if (res.error) {
        setUsernameAvailability({ state: "error", message: res.error.message });
        return;
      }
      const available = Boolean(res.data);
      setUsernameAvailability({ state: available ? "available" : "taken", message: available ? "Available." : "Taken." });
    }, 350);
    return () => window.clearTimeout(t);
  }, [normalized, localUsernameIssue, profile?.username]);

  async function saveProfile() {
    if (!supabase || !userId) return;
    setProfileSaveState({ busy: true, error: null, message: "Saving…" });
    try {
      // Username change (optional), but saved via the same Profile save button.
      const nextUsername = normalizeUsername(profileForm.username);
      if (profile && nextUsername && nextUsername !== profile.username) {
        if (!isValidUsername(nextUsername)) throw new Error("Username is invalid.");
        if (isReservedUsername(nextUsername)) throw new Error("That username is reserved.");
        if (usernameAvailability.state === "checking") throw new Error("Still checking username availability…");
        if (usernameAvailability.state === "taken") throw new Error("That username is already taken (or previously used).");

        const changed = await supabase.rpc("change_username", { new_username: nextUsername });
        if (changed.error) throw new Error(humanizeUsernameError(changed.error.message));
        const payload = (changed.data as any) ?? null;
        const actualNext = typeof payload?.new === "string" ? payload.new : nextUsername;
        setProfile((p) => (p ? { ...p, username: actualNext } : p));
        setProfileForm((p) => ({ ...p, username: actualNext }));
      }

      const payload = {
        display_name: profileForm.display_name.trim() ? profileForm.display_name.trim() : null,
        bio: profileForm.bio.trim() ? profileForm.bio.trim() : null,
        visibility: profileForm.visibility,
        borrowable_default: Boolean(profileForm.borrowable_default),
        borrow_request_scope: profileForm.borrow_request_scope
      };
      const res = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", userId)
        .select("username,display_name,bio,visibility,avatar_path,borrowable_default,borrow_request_scope")
        .maybeSingle();
      if (res.error) throw new Error(res.error.message);
      const nextProfile = ((res.data as any) ?? null) as typeof profile;
      if (nextProfile) setProfile(nextProfile);
      setProfileSaveState({ busy: false, error: null, message: "Saved" });
    } catch (e: any) {
      setProfileSaveState({ busy: false, error: e?.message ?? "Failed", message: "Failed" });
    }
  }

  async function uploadAvatar() {
    if (!supabase || !userId || !pendingAvatar) return;
    setAvatarState({ busy: true, error: null, message: "Uploading…" });
    const safe = safeFileName(pendingAvatar.name);
    const fileName = `avatar_${Date.now()}_${safe}`;
    const path = `${userId}/${fileName}`;

    const up = await supabase.storage.from("avatars").upload(path, pendingAvatar, {
      upsert: true,
      contentType: pendingAvatar.type || "application/octet-stream"
    });
    if (up.error) {
      setAvatarState({ busy: false, error: up.error.message, message: "Failed" });
      return;
    }

    const prevPath = profile?.avatar_path ?? null;
    const res = await supabase.from("profiles").update({ avatar_path: path }).eq("id", userId).select("avatar_path").maybeSingle();
    if (res.error) {
      setAvatarState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }

    if (prevPath && prevPath !== path) {
      await supabase.storage.from("avatars").remove([prevPath]);
    }

    setProfile((p) => (p ? { ...p, avatar_path: path } : p));
    setPendingAvatar(null);
    setAvatarState({ busy: false, error: null, message: "Uploaded" });
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
      {!session ? (
        <SignInCard note="Sign in to edit your settings." />
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>Settings</div>
            <div className="muted">{busy ? "Loading…" : error ? error : ""}</div>
          </div>

          <div style={{ marginTop: 16 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Avatar</div>
              <div className="muted">{avatarState.message ? (avatarState.error ? `${avatarState.message} (${avatarState.error})` : avatarState.message) : ""}</div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              {avatarUrl ? (
                <a href={avatarUrl} target="_blank" rel="noreferrer" aria-label="Open avatar">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    src={avatarUrl}
                    style={{ width: 28, height: 28, borderRadius: 999, objectFit: "cover", border: "1px solid var(--border)" }}
                  />
                </a>
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: 999, border: "1px solid var(--border)" }} />
              )}
              <input type="file" accept="image/*" onChange={(e) => setPendingAvatar((e.target.files ?? [])[0] ?? null)} />
              <button onClick={uploadAvatar} disabled={!pendingAvatar || avatarState.busy}>
                {avatarState.busy ? "Uploading…" : "Submit avatar"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 16 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Follows</div>
              <div className="muted">requests + approvals</div>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              Manage who can see followers-only content.
            </div>
            <div style={{ marginTop: 10 }}>
              <Link href="/app/follows">Open follow settings</Link>
            </div>
          </div>

          <div style={{ marginTop: 16 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Borrowing</div>
              <div className="muted">defaults</div>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              Set defaults for borrowability. You can override borrowable/not-borrowable per book; request rules apply to all borrowable books.
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <div style={{ width: 170 }} className="muted">
                Borrowable by default
              </div>
              <select
                value={profileForm.borrowable_default ? "yes" : "no"}
                onChange={(e) => setProfileForm((p) => ({ ...p, borrowable_default: e.target.value === "yes" }))}
              >
                <option value="no">no</option>
                <option value="yes">yes</option>
              </select>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <div style={{ width: 170 }} className="muted">
                Who can request
              </div>
              <select
                value={profileForm.borrow_request_scope}
                onChange={(e) =>
                  setProfileForm((p) => ({
                    ...p,
                    borrow_request_scope: (e.target.value === "anyone"
                      ? "anyone"
                      : e.target.value === "following"
                        ? "following"
                        : "followers") as any
                  }))
                }
              >
                <option value="followers">followers</option>
                <option value="following">following</option>
                <option value="anyone">anyone</option>
              </select>
              <div className="muted">
                {profileForm.borrow_request_scope === "anyone"
                  ? "Any signed-in user."
                  : profileForm.borrow_request_scope === "following"
                    ? "Only people you follow."
                    : "Only approved followers."}
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <Link href="/app/borrow-requests">View borrow requests</Link>
            </div>
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
                Username
              </div>
              <input
                value={profileForm.username}
                onChange={(e) => setProfileForm((p) => ({ ...p, username: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  saveProfile();
                }}
                placeholder="username"
                style={{ width: 220 }}
              />
              <div className="muted">
                {profile && normalized && normalized !== profile.username ? usernameAvailability.message ?? "" : ""}
              </div>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              Rules: 3–24 chars, lowercase letters/numbers/underscore. No leading/trailing underscore.
            </div>
            <details style={{ marginTop: 8 }}>
              <summary className="muted">Reserved words</summary>
              <div className="muted" style={{ marginTop: 6 }}>
                {RESERVED_USERNAMES.join(", ")}
              </div>
            </details>
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

            <div className="row" style={{ marginTop: 10 }}>
              <div style={{ width: 120 }} className="muted">
                Display name
              </div>
              <input
                value={profileForm.display_name}
                onChange={(e) => setProfileForm((p) => ({ ...p, display_name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  saveProfile();
                }}
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
              <button onClick={saveProfile} disabled={profileSaveState.busy || usernameSaveBlocked}>
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
