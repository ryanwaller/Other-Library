"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import Cropper, { type Area } from "react-easy-crop";
import { supabase } from "../../../lib/supabaseClient";
import CustomSlider from "../../../components/CustomSlider";
import SignInCard from "../../components/SignInCard";
import FollowsPanel from "../follows/FollowsPanel";
import BorrowRequestsPanel from "../borrow-requests/BorrowRequestsPanel";

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

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}

async function cropToBlob(imageSrc: string, crop: Area, outputSize = 512): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, outputSize, outputSize);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))), "image/jpeg", 0.9);
  });
  return blob;
}

function SettingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const userId = session?.user?.id ?? null;
  const sessionEmail = session?.user?.email ?? null;
  const accessToken = session?.access_token ?? null;

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
  const [pendingAvatarPreviewUrl, setPendingAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarCrop, setAvatarCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [avatarZoom, setAvatarZoom] = useState<number>(1);
  const [avatarCroppedAreaPixels, setAvatarCroppedAreaPixels] = useState<Area | null>(null);
  const [avatarState, setAvatarState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [emailDraft, setEmailDraft] = useState<string>("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [emailState, setEmailState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [passwordState, setPasswordState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [deleteConfirm, setDeleteConfirm] = useState<string>("");
  const [deleteState, setDeleteState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [displayNameEdited, setDisplayNameEdited] = useState(false);
  const [tab, setTab] = useState<"profile" | "follows" | "borrows" | "catalog" | "shared" | "account">("profile");
  const [sharedCatalogsBusy, setSharedCatalogsBusy] = useState(false);
  const [sharedCatalogsError, setSharedCatalogsError] = useState<string | null>(null);
  const [pendingSharedCatalogs, setPendingSharedCatalogs] = useState<
    Array<{
      id: string;
      catalog_id: number;
      role: "owner" | "editor";
      invited_at: string;
      catalog: { id: number; name: string } | null;
      inviter: { id: string; username: string | null } | null;
    }>
  >([]);
  const [acceptedSharedCatalogs, setAcceptedSharedCatalogs] = useState<
    Array<{
      id: string;
      catalog_id: number;
      role: "owner" | "editor";
      accepted_at: string | null;
      catalog: { id: number; name: string } | null;
      inviter: { id: string; username: string | null } | null;
    }>
  >([]);

  useEffect(() => {
    const raw = String(searchParams.get("tab") ?? "").trim().toLowerCase();
    if (raw === "profile" || raw === "follows" || raw === "borrows" || raw === "catalog" || raw === "shared" || raw === "account") {
      setTab(raw as any);
    }
  }, [searchParams]);

  async function refreshSharedCatalogs() {
    if (!accessToken) {
      setPendingSharedCatalogs([]);
      setAcceptedSharedCatalogs([]);
      return;
    }
    setSharedCatalogsBusy(true);
    setSharedCatalogsError(null);
    try {
      const res = await fetch("/api/catalog/shared", {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "request_failed"));
      setPendingSharedCatalogs(Array.isArray(json?.pending) ? (json.pending as any[]) : []);
      setAcceptedSharedCatalogs(Array.isArray(json?.shared) ? (json.shared as any[]) : []);
    } catch (e: any) {
      setPendingSharedCatalogs([]);
      setAcceptedSharedCatalogs([]);
      setSharedCatalogsError(e?.message ?? "Failed to load shared catalogs");
    } finally {
      setSharedCatalogsBusy(false);
    }
  }

  async function actOnSharedInvitation(catalogId: number, action: "accept" | "decline") {
    if (!accessToken) return;
    setSharedCatalogsError(null);
    try {
      const res = await fetch(`/api/catalog/${catalogId}/${action}`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? `${action}_failed`));
      window.dispatchEvent(new Event("om:catalog-members-changed"));
      await refreshSharedCatalogs();
    } catch (e: any) {
      setSharedCatalogsError(e?.message ?? `Failed to ${action} invitation`);
    }
  }

  async function leaveSharedCatalog(catalogId: number) {
    if (!accessToken) return;
    setSharedCatalogsError(null);
    try {
      const res = await fetch(`/api/catalog/${catalogId}/leave`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "leave_failed"));
      window.dispatchEvent(new Event("om:catalog-members-changed"));
      await refreshSharedCatalogs();
    } catch (e: any) {
      setSharedCatalogsError(e?.message ?? "Failed to leave catalog");
    }
  }

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (tab !== "shared") return;
    void refreshSharedCatalogs();
    const onChanged = () => {
      void refreshSharedCatalogs();
    };
    window.addEventListener("om:catalog-members-changed", onChanged);
    return () => {
      window.removeEventListener("om:catalog-members-changed", onChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, accessToken]);

  useEffect(() => {
    setEmailDraft(sessionEmail ?? "");
  }, [sessionEmail]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !userId) {
        setProfileReady(false);
        return;
      }
      setProfileReady(false);
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
      setProfileReady(true);
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
    if (!pendingAvatar) {
      setPendingAvatarPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setAvatarCrop({ x: 0, y: 0 });
      setAvatarZoom(1);
      setAvatarCroppedAreaPixels(null);
      return;
    }

    const url = URL.createObjectURL(pendingAvatar);
    setPendingAvatarPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setAvatarCrop({ x: 0, y: 0 });
    setAvatarZoom(1);
    setAvatarCroppedAreaPixels(null);
    return () => URL.revokeObjectURL(url);
  }, [pendingAvatar]);

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
  const usernameDirty = useMemo(() => {
    if (!profile) return false;
    return normalizeUsername(profileForm.username) !== profile.username;
  }, [profile, profileForm.username]);
  const displayNameDirty = useMemo(() => {
    if (!profile) return false;
    return (profileForm.display_name ?? "") !== (profile.display_name ?? "");
  }, [profile, profileForm.display_name]);

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
    try {
      const safe = safeFileName(pendingAvatar.name);
      let fileName = `avatar_${Date.now()}_${safe}`;
      let body: Blob | File = pendingAvatar;
      let contentType = pendingAvatar.type || "application/octet-stream";

      if (pendingAvatarPreviewUrl && avatarCroppedAreaPixels) {
        body = await cropToBlob(pendingAvatarPreviewUrl, avatarCroppedAreaPixels, 512);
        contentType = "image/jpeg";
        fileName = `avatar_${Date.now()}.jpg`;
      }

      const path = `${userId}/${fileName}`;
      const up = await supabase.storage.from("avatars").upload(path, body, {
        upsert: true,
        contentType
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
      setPendingAvatarPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setAvatarCroppedAreaPixels(null);
      setAvatarCrop({ x: 0, y: 0 });
      setAvatarZoom(1);
      setAvatarState({ busy: false, error: null, message: "Uploaded" });
    } catch (e: any) {
      setAvatarState({ busy: false, error: e?.message ?? "Failed", message: "Failed" });
    }
  }

  async function saveEmail() {
    if (!supabase) return;
    const next = emailDraft.trim();
    if (!next) {
      setEmailState({ busy: false, error: "Email is required.", message: "Failed" });
      return;
    }
    setEmailState({ busy: true, error: null, message: "Saving…" });
    const res = await supabase.auth.updateUser({ email: next });
    if (res.error) {
      setEmailState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }
    setEmailState({ busy: false, error: null, message: "Saved" });
    window.setTimeout(() => setEmailState({ busy: false, error: null, message: null }), 900);
  }

  async function savePassword() {
    if (!supabase) return;
    const email = (sessionEmail ?? "").trim();
    if (!email) {
      setPasswordState({ busy: false, error: "No email on this session.", message: "Failed" });
      return;
    }
    const cur = currentPassword;
    const next = newPassword;
    const confirm = confirmPassword;
    if (!cur.trim()) {
      setPasswordState({ busy: false, error: "Enter your current password.", message: "Failed" });
      return;
    }
    if (next.length < 8) {
      setPasswordState({ busy: false, error: "New password must be at least 8 characters.", message: "Failed" });
      return;
    }
    if (next !== confirm) {
      setPasswordState({ busy: false, error: "Passwords do not match.", message: "Failed" });
      return;
    }

    setPasswordState({ busy: true, error: null, message: "Saving…" });
    // Re-auth via password to confirm identity. (If you signed up via Google and never set a password, this will fail.)
    const reauth = await supabase.auth.signInWithPassword({ email, password: cur });
    if (reauth.error) {
      setPasswordState({
        busy: false,
        error: `${reauth.error.message} (If you use Google sign-in and never set a password, use a reset-password flow later.)`,
        message: "Failed"
      });
      return;
    }

    const res = await supabase.auth.updateUser({ password: next });
    if (res.error) {
      setPasswordState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordState({ busy: false, error: null, message: "Saved" });
    window.setTimeout(() => setPasswordState({ busy: false, error: null, message: null }), 900);
  }

  async function deleteAccount() {
    if (!supabase) return;
    if (deleteConfirm.trim() !== "DELETE") {
      setDeleteState({ busy: false, error: "Type DELETE to confirm.", message: "Failed" });
      return;
    }
    setDeleteState({ busy: true, error: null, message: "Deleting…" });
    const res = await supabase.rpc("delete_my_account");
    if (res.error) {
      setDeleteState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (!supabase) {
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

  if (!authReady) {
    return null;
  }

  return (
    <main className="container om-settings-page">
      {!session ? (
        <SignInCard note="Sign in to edit your settings." />
      ) : !profileReady ? (
        <div className="card" style={{ minHeight: 240 }} />
      ) : (
        <div className="card">
          <div className="row admin-tabbar-row" style={{ justifyContent: "flex-start", width: "100%", flexWrap: "nowrap" }}>
            <div className="admin-tabbar" style={{ flexWrap: "nowrap", overflowX: "auto", whiteSpace: "nowrap" }}>
              <button type="button" onClick={() => setTab("profile")} aria-current={tab === "profile" ? "page" : undefined}>Profile</button>
              <button type="button" onClick={() => setTab("follows")} aria-current={tab === "follows" ? "page" : undefined}>Follows</button>
              <button type="button" onClick={() => setTab("borrows")} aria-current={tab === "borrows" ? "page" : undefined}>Borrows</button>
              <button type="button" onClick={() => setTab("catalog")} aria-current={tab === "catalog" ? "page" : undefined}>Catalog Import</button>
              <button type="button" onClick={() => setTab("shared")} aria-current={tab === "shared" ? "page" : undefined}>Shared catalogs</button>
              <button type="button" onClick={() => setTab("account")} aria-current={tab === "account" ? "page" : undefined}>Account</button>
            </div>
          </div>
          {(busy || error) ? <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>{busy ? "Loading…" : error}</div> : null}
          <hr className="om-hr" />

          {tab === "profile" ? (
            <div className="card">
              <div className="text-muted">
                {profileSaveState.message
                  ? profileSaveState.error
                    ? `${profileSaveState.message} (${profileSaveState.error})`
                    : profileSaveState.message
                  : ""}
              </div>

              <div className="row om-settings-row" style={{ alignItems: "center" }}>
                <div style={{ width: 120 }} className="text-muted">Avatar</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div className="row" style={{ gap: "var(--space-10)", alignItems: "center", flexWrap: "wrap" }}>
                    {avatarUrl ? (
                      <a href={avatarUrl} target="_blank" rel="noreferrer" aria-label="Open avatar">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt=""
                          src={avatarUrl}
                          style={{
                            width: "var(--avatar-size)",
                            height: "var(--avatar-size)",
                            borderRadius: 999,
                            objectFit: "cover",
                            border: "1px solid var(--border-avatar)"
                          }}
                        />
                      </a>
                    ) : (
                      <div
                        style={{
                          width: "var(--avatar-size)",
                          height: "var(--avatar-size)",
                          borderRadius: 999,
                          border: "1px solid var(--border-avatar)"
                        }}
                      />
                    )}
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => setPendingAvatar((e.target.files ?? [])[0] ?? null)}
                    />
                    <button
                      type="button"
                      className="text-muted"
                      style={{ textDecoration: "underline" }}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      Upload
                    </button>
                    {pendingAvatar ? (
                      <button
                        type="button"
                        className="text-muted"
                        style={{ textDecoration: "underline" }}
                        onClick={() => void uploadAvatar()}
                        disabled={avatarState.busy}
                      >
                        {avatarState.busy ? "Saving…" : "Save"}
                      </button>
                    ) : null}
                  </div>
                  <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                    {avatarState.message ? (avatarState.error ? `${avatarState.message} (${avatarState.error})` : avatarState.message) : ""}
                  </div>
                </div>
              </div>

              {pendingAvatarPreviewUrl ? (
                <div style={{ marginTop: "var(--space-10)" }}>
                  <div
                    style={{
                      position: "relative",
                      width: 280,
                      height: 280,
                      border: "1px solid var(--border-avatar)",
                      background: "black",
                      touchAction: "none"
                    }}
                  >
                    <Cropper
                      image={pendingAvatarPreviewUrl}
                      crop={avatarCrop}
                      zoom={avatarZoom}
                      aspect={1}
                      cropShape="rect"
                      showGrid={false}
                      style={{
                        containerStyle: { touchAction: "none", cursor: "grab" }
                      }}
                      onCropChange={setAvatarCrop}
                      onZoomChange={(z: number) => setAvatarZoom(clamp(Number(z), 1, 3))}
                      onCropComplete={(_area: Area, areaPixels: Area) => setAvatarCroppedAreaPixels(areaPixels)}
                    />
                  </div>
                  <div className="row no-wrap" style={{ marginTop: "var(--space-10)", alignItems: "center" }}>
                    <div className="text-muted" style={{ minWidth: 110 }}>Zoom</div>
                    <CustomSlider
                      min={1}
                      max={3}
                      step={0.01}
                      value={avatarZoom}
                      onChange={(z) => setAvatarZoom(clamp(Number(z), 1, 3))}
                      style={{ flex: "1 1 auto" }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">Username</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div className="om-settings-inline-action">
                    <input
                      value={profileForm.username}
                      onChange={(e) => {
                        setProfileForm((p) => ({ ...p, username: e.target.value }));
                        setUsernameEdited(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        saveProfile();
                      }}
                      placeholder="username"
                    />
                    {usernameEdited && usernameDirty ? (
                      <button
                        className="text-muted"
                        style={{ textDecoration: "underline" }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={saveProfile}
                        disabled={profileSaveState.busy || usernameSaveBlocked}
                      >
                        {profileSaveState.busy ? "Saving…" : "Save"}
                      </button>
                    ) : null}
                  </div>
                  <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                    {profile && normalized && normalized !== profile.username ? usernameAvailability.message ?? "" : ""}
                  </div>
                </div>
              </div>

              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">Display name</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div className="om-settings-inline-action">
                    <input
                      value={profileForm.display_name}
                      onChange={(e) => {
                        setProfileForm((p) => ({ ...p, display_name: e.target.value }));
                        setDisplayNameEdited(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        saveProfile();
                      }}
                      placeholder="(optional)"
                    />
                    {displayNameEdited && displayNameDirty ? (
                      <button
                        className="text-muted"
                        style={{ textDecoration: "underline" }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={saveProfile}
                        disabled={profileSaveState.busy}
                      >
                        {profileSaveState.busy ? "Saving…" : "Save"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="row om-settings-row" style={{ alignItems: "flex-start" }}>
                <div style={{ width: 120 }} className="text-muted">Bio</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <textarea
                    value={profileForm.bio}
                    onChange={(e) => setProfileForm((p) => ({ ...p, bio: e.target.value }))}
                    placeholder="(optional)"
                    style={{ height: 110 }}
                  />
                </div>
              </div>

              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">Library visibility</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <select
                    value={profileForm.visibility}
                    onChange={(e) => setProfileForm((p) => ({ ...p, visibility: (e.target.value === "public" ? "public" : "followers_only") as any }))}
                  >
                    <option value="followers_only">followers_only</option>
                    <option value="public">public</option>
                  </select>
                  <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                    {profileForm.visibility === "public" ? "Anyone can view /u/username" : "Only approved followers (and public book overrides)."}
                  </div>
                </div>
              </div>

              <div className="row om-settings-row" style={{ gap: "var(--space-md)", justifyContent: "space-between", alignItems: "baseline" }}>
                <button onClick={saveProfile} disabled={profileSaveState.busy || usernameSaveBlocked}>
                  {profileSaveState.busy ? "Saving…" : "Save profile"}
                </button>
                {profile ? (
                  <a href={`/u/${profile.username}`} target="_blank" rel="noreferrer" className="text-muted">
                    View public profile
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === "follows" ? (
            <div className="card">
              <FollowsPanel embedded />
            </div>
          ) : null}

          {tab === "borrows" ? (
            <div className="card">
              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">Borrowable</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <select
                    value={profileForm.borrowable_default ? "yes" : "no"}
                    onChange={(e) => setProfileForm((p) => ({ ...p, borrowable_default: e.target.value === "yes" }))}
                  >
                    <option value="no">no</option>
                    <option value="yes">yes</option>
                  </select>
                </div>
              </div>
              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">Who</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
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
                </div>
              </div>
              <div style={{ marginTop: "var(--space-2xl)" }}>
                <BorrowRequestsPanel embedded />
              </div>
            </div>
          ) : null}

          {tab === "catalog" ? (
            <div className="card">
              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">Import</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const f = (e.target.files ?? [])[0];
                      if (!f) return;
                      try {
                        const text = await f.text();
                        window.sessionStorage.setItem("om_staged_csv_data", text);
                        window.sessionStorage.setItem("om_staged_csv_filename", f.name);
                        router.push("/app?add=1");
                      } catch (err) {
                        console.error("Failed to read CSV", err);
                        window.alert("Failed to read CSV file.");
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="text-muted"
                    style={{ padding: 0, border: 0, background: "none", font: "inherit", cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => csvInputRef.current?.click()}
                  >
                    Upload CSV file
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "shared" ? (
            <div className="card">
              <div className="row om-settings-row" style={{ alignItems: "baseline", justifyContent: "space-between" }}>
                <div className="text-muted">Pending invitations</div>
                <div className="text-muted">{pendingSharedCatalogs.length}</div>
              </div>
              {pendingSharedCatalogs.length === 0 ? (
                <div className="text-muted">None.</div>
              ) : (
                <div className="om-list">
                  {pendingSharedCatalogs.map((row, idx) => (
                    <div key={row.id} className="om-list-row" style={idx === pendingSharedCatalogs.length - 1 ? { borderBottom: "none" } : undefined}>
                      <div style={{ minWidth: 0 }}>
                        <div>{row.catalog?.name ?? `Catalog ${row.catalog_id}`}</div>
                        <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                          {row.inviter?.username ? `Invited by ${row.inviter.username}` : "Invited"}
                        </div>
                      </div>
                      <div className="row" style={{ gap: "var(--space-md)", alignItems: "baseline" }}>
                        <button
                          className="text-muted"
                          style={{ textDecoration: "underline" }}
                          onClick={() => void actOnSharedInvitation(row.catalog_id, "accept")}
                        >
                          Accept
                        </button>
                        <button
                          className="text-muted"
                          style={{ textDecoration: "underline" }}
                          onClick={() => void actOnSharedInvitation(row.catalog_id, "decline")}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <hr className="om-hr" />

              <div className="row om-settings-row" style={{ alignItems: "baseline", justifyContent: "space-between" }}>
                <div className="text-muted">Shared with you</div>
                <div className="text-muted">{acceptedSharedCatalogs.length}</div>
              </div>
              {acceptedSharedCatalogs.length === 0 ? (
                <div className="text-muted">None.</div>
              ) : (
                <div className="om-list">
                  {acceptedSharedCatalogs.map((row, idx) => (
                    <div key={row.id} className="om-list-row" style={idx === acceptedSharedCatalogs.length - 1 ? { borderBottom: "none" } : undefined}>
                      <div style={{ minWidth: 0 }}>{row.catalog?.name ?? `Catalog ${row.catalog_id}`}</div>
                      <button
                        className="text-muted"
                        style={{ textDecoration: "underline", marginLeft: "auto" }}
                        onClick={() => void leaveSharedCatalog(row.catalog_id)}
                      >
                        Leave
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {(sharedCatalogsBusy || sharedCatalogsError) ? (
                <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                  {sharedCatalogsBusy ? "Loading…" : sharedCatalogsError}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "account" ? (
            <div className="card">
              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">Email</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div className="om-settings-inline-action">
                    <input
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      onFocus={() => setEmailFocused(true)}
                      onBlur={() => setEmailFocused(false)}
                      placeholder="you@example.com"
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        saveEmail();
                      }}
                    />
                    {emailFocused ? (
                      <button
                        className="text-muted"
                        style={{ textDecoration: "underline" }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={saveEmail}
                        disabled={emailState.busy || !emailDraft.trim()}
                      >
                        {emailState.busy ? "Saving…" : "Save email"}
                      </button>
                    ) : null}
                  </div>
                  <div className="row" style={{ marginTop: "var(--space-sm)", alignItems: "baseline" }}>
                    <div className="text-muted">{emailState.message ? (emailState.error ? `${emailState.message} (${emailState.error})` : emailState.message) : ""}</div>
                  </div>
                </div>
              </div>

              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">Password</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <input
                    type="password"
                    value={currentPassword}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                  />
                </div>
              </div>
              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">New password</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <input
                    type="password"
                    value={newPassword}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                  />
                </div>
              </div>
              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">Confirm</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div className="om-settings-inline-action">
                    <input
                      type="password"
                      value={confirmPassword}
                      onFocus={() => setPasswordFocused(true)}
                      onBlur={() => setPasswordFocused(false)}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm"
                    />
                    {(passwordFocused || currentPassword.trim() || newPassword.trim() || confirmPassword.trim()) ? (
                      <button
                        className="text-muted"
                        style={{ textDecoration: "underline" }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={savePassword}
                        disabled={passwordState.busy}
                      >
                        {passwordState.busy ? "Saving…" : "Save password"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="row om-settings-row" style={{ alignItems: "baseline", marginBottom: "var(--space-lg)" }}>
                <div className="text-muted">
                  {passwordState.message ? (passwordState.error ? `${passwordState.message} (${passwordState.error})` : passwordState.message) : ""}
                </div>
              </div>

              <div className="row om-settings-row" style={{ alignItems: "baseline" }}>
                <div style={{ width: 120 }} className="text-muted">Delete Account</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div className="row" style={{ alignItems: "baseline", flexWrap: "nowrap" }}>
                    <input
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder="This is permanent. Type DELETE to confirm."
                      style={{ flex: "1 1 auto", minWidth: 0 }}
                    />
                    {deleteConfirm.trim() ? (
                      <button
                        onClick={deleteAccount}
                        disabled={deleteState.busy}
                        className="text-muted"
                        style={{ whiteSpace: "nowrap", flexShrink: 0, textDecoration: "underline" }}
                      >
                        {deleteState.busy ? "Deleting…" : "Delete Account"}
                      </button>
                    ) : null}
                  </div>
                  <div className="row" style={{ marginTop: "var(--space-sm)", alignItems: "baseline" }}>
                    <div className="text-muted">{deleteState.message ? (deleteState.error ? `${deleteState.message} (${deleteState.error})` : deleteState.message) : ""}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageContent />
    </Suspense>
  );
}
