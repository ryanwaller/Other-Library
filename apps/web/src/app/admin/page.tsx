"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import SignInCard from "../components/SignInCard";
import { supabase } from "../../lib/supabaseClient";
import { formatDateShort } from "../../lib/formatDate";
import AdminFeedbackBoard, { type FeedbackMetrics } from "./AdminFeedbackBoard";
import usePageTitle from "../../hooks/usePageTitle";

type ProfileRow = {
  id: string;
  email: string | null;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
  role: "user" | "admin";
  status: "active" | "disabled" | "pending";
  created_at: string;
};

type InviteRow = {
  id: string;
  token: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  created_by: string | null;
  expires_at: string | null;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
};

type WaitlistRow = {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
};

type UsersResponse = {
  users: ProfileRow[];
  page: number;
  pageSize: number;
  total: number;
  metrics: { total: number; active: number; disabled: number; pending: number };
};

type WaitlistResponse = {
  waitlist: WaitlistRow[];
  page: number;
  pageSize: number;
  total: number;
  metrics: { total: number; pending: number; approved: number; rejected: number };
};

type InvitesResponse = {
  invites: InviteRow[];
  page: number;
  pageSize: number;
  total: number;
  metrics: { total: number; pending: number; used: number; expired: number };
};

type HomepageRailRole = "author" | "designer" | "publisher" | "performer" | "tag" | "material";

type HomepageRailEntity = {
  id: string;
  name: string;
  slug: string | null;
};

type HomepageRailSlot = {
  slot_index: number;
  mode: "automatic" | "pinned";
  role: HomepageRailRole;
  entity_id: string | null;
  title_override: string;
  entity: HomepageRailEntity | null;
};

type HomepageRailResponse = {
  slots: HomepageRailSlot[];
  migrationRequired?: boolean;
};

type MergeEntity = {
  id: string;
  name: string;
  slug: string | null;
  count: number;
  rawRoles?: string[];
};

type EntityMergeResponse = {
  sections: Array<{
    key: string;
    label: string;
    entities: MergeEntity[];
  }>;
};

type TabKey = "users" | "waitlist" | "invites" | "feedback" | "homepage" | "entities";

type MetaPair = { label: string; value: string | number };

async function api<T>(path: string, opts: RequestInit & { token: string }): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      authorization: `Bearer ${opts.token}`,
      "content-type": "application/json"
    }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "Request failed");
  return json as T;
}

function clampPage(current: number, totalPages: number) {
  return Math.max(1, Math.min(current, Math.max(1, totalPages)));
}

function titleCase(input: string): string {
  if (!input) return "";
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}

function inviteStatus(row: InviteRow): "pending" | "used" | "expired" {
  if (row.used_at) return "used";
  if (row.expires_at) {
    const expiry = new Date(row.expires_at);
    if (Number.isFinite(expiry.getTime()) && expiry.getTime() < Date.now()) return "expired";
  }
  return "pending";
}

function defaultHomepageSlots(): HomepageRailSlot[] {
  return [1, 2, 3].map((slot_index) => ({
    slot_index,
    mode: "automatic",
    role: "designer",
    entity_id: null,
    title_override: "",
    entity: null,
  }));
}

function resequenceHomepageSlots(slots: HomepageRailSlot[]): HomepageRailSlot[] {
  return slots.map((slot, idx) => ({ ...slot, slot_index: idx + 1 }));
}

function AdminListItem({
  primary,
  primaryHref,
  actions,
  meta,
  secondary,
  showAvatar = false,
  avatarUrl = null
}: {
  primary: string;
  primaryHref?: string | null;
  actions?: ReactNode;
  meta: MetaPair[];
  secondary?: ReactNode;
  showAvatar?: boolean;
  avatarUrl?: string | null;
}) {
  return (
    <div className="om-list-row">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
        <div className={showAvatar ? "om-avatar-lockup" : undefined} style={{ minWidth: 0, wordBreak: "break-word", flex: 1 }}>
          {showAvatar ? (
            avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={avatarUrl} className="om-avatar-img" />
            ) : (
              <span className="om-avatar-img" style={{ display: "inline-block", background: "var(--placeholder-bg)" }} />
            )
          ) : null}
          <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {primaryHref ? <Link href={primaryHref}>{primary}</Link> : primary}
          </div>
        </div>
        {actions ? <div className="row" style={{ gap: "var(--space-10)", justifyContent: "flex-end", alignItems: "flex-start" }}>{actions}</div> : null}
      </div>
      <div className="admin-meta-line" style={{ marginTop: 4 }}>
        {meta.map((pair, idx) => (
          <span className="admin-meta-pair" key={`${pair.label}-${idx}`}>
            <span className="text-muted">{pair.label}</span>
            <span>{pair.value}</span>
          </span>
        ))}
      </div>
      {secondary ? (
        <div className="text-muted" style={{ marginTop: 4, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

function AdminPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const token = session?.access_token ?? "";

  const [tab, setTab] = useState<TabKey>("users");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const friendlyError = useMemo(() => {
    if (!error) return null;
    if (error === "admin_not_configured") return "Admin API is not configured on the server (missing SUPABASE_SERVICE_ROLE_KEY).";
    return error;
  }, [error]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailFocused, setInviteEmailFocused] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [copiedLinkForId, setCopiedLinkForId] = useState<number | string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [avatarUrlsByPath, setAvatarUrlsByPath] = useState<Record<string, string>>({});
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const sync = () => setIsMobileViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const [userTab, setUserTab] = useState<"all" | "active" | "disabled" | "admins">("all");
  const [userSearchDraft, setUserSearchDraft] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userSort, setUserSort] = useState<"email" | "role" | "status" | "created_at">("created_at");
  const [userDir, setUserDir] = useState<"asc" | "desc">("desc");
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(20);
  const [usersData, setUsersData] = useState<UsersResponse | null>(null);
  const [usersMetrics, setUsersMetrics] = useState<UsersResponse["metrics"]>({ total: 0, active: 0, disabled: 0, pending: 0 });

  const [waitTab, setWaitTab] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [waitSearchDraft, setWaitSearchDraft] = useState("");
  const [waitSearch, setWaitSearch] = useState("");
  const [waitSort, setWaitSort] = useState<"email" | "status" | "created_at">("created_at");
  const [waitDir, setWaitDir] = useState<"asc" | "desc">("desc");
  const [waitPage, setWaitPage] = useState(1);
  const [waitPageSize, setWaitPageSize] = useState(20);
  const [waitlistData, setWaitlistData] = useState<WaitlistResponse | null>(null);

  const [invitesSearchDraft, setInvitesSearchDraft] = useState("");
  const [invitesSearch, setInvitesSearch] = useState("");
  const [invitesStatus, setInvitesStatus] = useState<"pending" | "used">("pending");
  const [invitesDir, setInvitesDir] = useState<"asc" | "desc">("desc");
  const [invitesPage, setInvitesPage] = useState(1);
  const [invitesPageSize, setInvitesPageSize] = useState(20);
  const [invitesData, setInvitesData] = useState<InvitesResponse | null>(null);
  const [feedbackMetrics, setFeedbackMetrics] = useState<FeedbackMetrics>({ new: 0, reviewing: 0, resolved: 0, wont_fix: 0 });
  const [feedbackRefreshToken, setFeedbackRefreshToken] = useState(0);
  const [homepageSlots, setHomepageSlots] = useState<HomepageRailSlot[]>(defaultHomepageSlots());
  const [homepageSearchDrafts, setHomepageSearchDrafts] = useState<Record<number, string>>({});
  const [homepageSearchResults, setHomepageSearchResults] = useState<Record<number, HomepageRailEntity[]>>({});
  const [homepageSaving, setHomepageSaving] = useState(false);
  const [homepageNotice, setHomepageNotice] = useState<string | null>(null);
  const [entityMergeQueryDraft, setEntityMergeQueryDraft] = useState("");
  const [entityMergeQuery, setEntityMergeQuery] = useState("");
  const [entityMergeSections, setEntityMergeSections] = useState<EntityMergeResponse["sections"]>([]);
  const [entityMergeSelected, setEntityMergeSelected] = useState<Record<string, MergeEntity>>({});
  const [entityMergeKeepId, setEntityMergeKeepId] = useState<string | null>(null);
  const [entityMergeBusy, setEntityMergeBusy] = useState(false);
  const [entityMergeNotice, setEntityMergeNotice] = useState<string | null>(null);

  usePageTitle(
    tab === "waitlist"
      ? "Waitlist"
      : tab === "invites"
        ? "Invites"
        : tab === "feedback"
          ? "Feedback"
          : tab === "homepage"
            ? "Homepage"
            : tab === "entities"
              ? "Entities"
            : "Admin"
  );

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const raw = String(searchParams.get("tab") ?? "").trim().toLowerCase();
    if (raw === "users" || raw === "waitlist" || raw === "invites" || raw === "feedback" || raw === "homepage" || raw === "entities") {
      setTab(raw as TabKey);
    }
  }, [searchParams]);

  function setTabAndRoute(next: TabKey) {
    setTab(next);
    const url = next === "users" ? "/admin" : `/admin?tab=${encodeURIComponent(next)}`;
    router.replace(url);
  }

  function handleAuthError(msg: string): boolean {
    if (msg !== "not_authenticated") return false;
    // Access token was stale (getSession() returns cached token without refreshing).
    // Silently trigger a refresh; onAuthStateChange → setSession → token change → retry.
    supabase?.auth.refreshSession().catch(() => supabase?.auth.signOut());
    return true;
  }

  async function refreshSummary() {
    if (!token) return;
    try {
      const params = new URLSearchParams({ q: "", sort: "created_at", dir: "desc", page: "1", pageSize: "1", status: "all", role: "all" });
      const res = await api<UsersResponse>(`/api/admin/users?${params.toString()}`, { method: "GET", token });
      setUsersMetrics(res.metrics);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load summary";
      if (handleAuthError(msg)) return;
      setError(msg);
      setUsersMetrics({ total: 0, active: 0, disabled: 0, pending: 0 });
    }
  }

  async function refreshUsers() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: userSearch,
        sort: userSort,
        dir: userDir,
        page: String(userPage),
        pageSize: String(userPageSize)
      });
      if (userTab === "active") params.set("status", "active");
      if (userTab === "disabled") params.set("status", "disabled");
      if (userTab === "admins") params.set("role", "admin");
      if (userTab === "all") {
        params.set("status", "all");
        params.set("role", "all");
      }
      const res = await api<UsersResponse>(`/api/admin/users?${params.toString()}`, { method: "GET", token });
      setUsersData(res);
      setUsersMetrics(res.metrics);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load users";
      if (handleAuthError(msg)) return;
      setError(msg);
      setUsersData(null);
    } finally {
      setBusy(false);
    }
  }

  async function refreshWaitlist() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: waitSearch,
        sort: waitSort,
        dir: waitDir,
        page: String(waitPage),
        pageSize: String(waitPageSize),
        status: waitTab
      });
      const res = await api<WaitlistResponse>(`/api/admin/waitlist?${params.toString()}`, { method: "GET", token });
      setWaitlistData(res);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load waitlist";
      if (handleAuthError(msg)) return;
      setError(msg);
      setWaitlistData(null);
    } finally {
      setBusy(false);
    }
  }

  async function refreshInvites() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: invitesSearch,
        status: invitesStatus,
        sort: "created_at",
        dir: invitesDir,
        page: String(invitesPage),
        pageSize: String(invitesPageSize)
      });
      const res = await api<InvitesResponse>(`/api/admin/invites?${params.toString()}`, { method: "GET", token });
      setInvitesData(res);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load invites";
      if (handleAuthError(msg)) return;
      setError(msg);
      setInvitesData(null);
    } finally {
      setBusy(false);
    }
  }

  async function refreshHomepageRail() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<HomepageRailResponse>("/api/admin/homepage-rail", { method: "GET", token });
      setHomepageSlots(Array.isArray(res.slots) && res.slots.length ? res.slots : defaultHomepageSlots());
      if (res.migrationRequired) setHomepageNotice("Apply migration 0044_homepage_feature_slots.sql to enable saved homepage overrides.");
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load homepage rail";
      if (handleAuthError(msg)) return;
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function refreshEntitySections() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<EntityMergeResponse>(`/api/admin/entities/merge?q=${encodeURIComponent(entityMergeQuery)}`, { method: "GET", token });
      setEntityMergeSections(res.sections ?? []);
    } catch (e: any) {
      const msg = e?.message ?? "Entity search failed";
      if (handleAuthError(msg)) return;
      setError(msg);
      setEntityMergeSections([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setInviteLink(null);
  }, [tab]);

  useEffect(() => {
    if (!token) return;
    refreshSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || tab !== "users") return;
    refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab, userTab, userSearch, userSort, userDir, userPage, userPageSize]);

  useEffect(() => {
    if (!token || tab !== "waitlist") return;
    refreshWaitlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab, waitTab, waitSearch, waitSort, waitDir, waitPage, waitPageSize]);

  useEffect(() => {
    if (!token || tab !== "invites") return;
    refreshInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab, invitesSearch, invitesStatus, invitesDir, invitesPage, invitesPageSize]);

  useEffect(() => {
    if (!token || tab !== "homepage") return;
    refreshHomepageRail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab]);

  useEffect(() => {
    if (!token || tab !== "entities") return;
    refreshEntitySections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab, entityMergeQuery]);

  const userTotalPages = usersData ? Math.max(1, Math.ceil(usersData.total / usersData.pageSize)) : 1;
  const waitTotalPages = waitlistData ? Math.max(1, Math.ceil(waitlistData.total / waitlistData.pageSize)) : 1;
  const invitesTotalPages = invitesData ? Math.max(1, Math.ceil(invitesData.total / invitesData.pageSize)) : 1;
  const selectedMergeEntities = useMemo(
    () => Object.values(entityMergeSelected).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })),
    [entityMergeSelected]
  );

  useEffect(() => setUserPage((prev) => clampPage(prev, userTotalPages)), [userTotalPages]);
  useEffect(() => setWaitPage((prev) => clampPage(prev, waitTotalPages)), [waitTotalPages]);
  useEffect(() => setInvitesPage((prev) => clampPage(prev, invitesTotalPages)), [invitesTotalPages]);
  useEffect(() => setSearchOpen(false), [tab]);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) {
        setAvatarUrlsByPath({});
        return;
      }
      if (tab !== "users") {
        setAvatarUrlsByPath({});
        return;
      }
      const paths = Array.from(new Set((usersData?.users ?? []).map((u) => (u.avatar_path ?? "").trim()).filter(Boolean)));
      if (paths.length === 0) {
        setAvatarUrlsByPath({});
        return;
      }
      const map: Record<string, string> = {};
      const direct = paths.filter((p) => /^https?:\/\//i.test(p));
      for (const p of direct) map[p] = p;
      const storagePaths = paths.filter((p) => !/^https?:\/\//i.test(p));
      if (storagePaths.length > 0) {
        const signed = await supabase.storage.from("avatars").createSignedUrls(storagePaths, 60 * 30);
        if (!alive) return;
        for (const row of signed.data ?? []) {
          if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
        }
        for (const p of storagePaths) {
          if (map[p]) continue;
          const pub = supabase.storage.from("avatars").getPublicUrl(p);
          const fallback = String(pub.data?.publicUrl ?? "").trim();
          if (fallback) map[p] = fallback;
        }
      }
      setAvatarUrlsByPath(map);
    })();
    return () => {
      alive = false;
    };
  }, [tab, usersData?.users]);

  const tabStats = useMemo(() => {
    if (tab === "users") {
      return [
        { label: "Total", value: usersMetrics.total },
        { label: "Active", value: usersMetrics.active },
        { label: "Disabled", value: usersMetrics.disabled },
        { label: "Pending", value: usersMetrics.pending }
      ];
    }
    if (tab === "waitlist") {
      return [
        { label: "Total", value: waitlistData?.metrics.total ?? 0 },
        { label: "Pending", value: waitlistData?.metrics.pending ?? 0 },
        { label: "Approved", value: waitlistData?.metrics.approved ?? 0 }
      ];
    }
    if (tab === "feedback") {
      return [
        { label: "New", value: feedbackMetrics.new },
        { label: "Reviewing", value: feedbackMetrics.reviewing },
        { label: "Resolved", value: feedbackMetrics.resolved },
        { label: "Won't fix", value: feedbackMetrics.wont_fix }
      ];
    }
    if (tab === "homepage") {
      return [
        { label: "Slots", value: homepageSlots.length },
        { label: "Pinned", value: homepageSlots.filter((slot) => slot.mode === "pinned" && slot.entity_id).length },
        { label: "Automatic", value: homepageSlots.filter((slot) => slot.mode === "automatic").length }
      ];
    }
    if (tab === "entities") {
      return [
        { label: "Selected", value: selectedMergeEntities.length },
        { label: "Keep", value: entityMergeKeepId ? (entityMergeSelected[entityMergeKeepId]?.name ?? "None") : "None" }
      ];
    }
    return [
      { label: "Total", value: invitesData?.metrics.total ?? 0 },
      { label: "Pending", value: invitesData?.metrics.pending ?? 0 },
      { label: "Used", value: invitesData?.metrics.used ?? 0 },
      { label: "Expired", value: invitesData?.metrics.expired ?? 0 }
    ];
  }, [tab, usersMetrics, waitlistData?.metrics, invitesData?.metrics, feedbackMetrics, homepageSlots, selectedMergeEntities.length, entityMergeKeepId, entityMergeSelected]);

  function resultLabel(page: number, totalPages: number, total: number): string {
    if (totalPages > 1) return `Results ${total} Page ${page} / ${totalPages}`;
    return `Results ${total}`;
  }

  if (!supabase) {
    return (
      <main className="container">
        <div className="card">Supabase is not configured.</div>
      </main>
    );
  }

  return (
    <main className="container">
      {!session ? (
        <SignInCard note="Sign in as an admin to access /admin." />
      ) : (
        <div className="card">
          <div className="row admin-summary-row" style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--space-10)" }}>
            <div className="admin-meta-line">
              {tabStats.map((item) => (
                <span className="admin-meta-pair" key={item.label}>
                  <span className="text-muted">{item.label}</span>
                  <span>{item.value}</span>
                </span>
              ))}
            </div>
            <button
              onClick={() => {
                setInviteLink(null);
                refreshSummary();
                if (tab === "users") refreshUsers();
                if (tab === "waitlist") refreshWaitlist();
                if (tab === "invites") refreshInvites();
                if (tab === "feedback") setFeedbackRefreshToken((prev) => prev + 1);
                if (tab === "homepage") refreshHomepageRail();
                if (tab === "entities") {
                  setEntityMergeSourceResults([]);
                  setEntityMergeTargetResults([]);
                  setEntityMergeNotice(null);
                }
              }}
              disabled={busy}
            >
              Refresh
            </button>
          </div>

          <hr className="om-hr" />

          <div className="row admin-tabbar-row" style={{ justifyContent: "flex-start", gap: "var(--space-10)", width: "100%", flexWrap: isMobileViewport ? "wrap" : "nowrap" }}>
            <div className="admin-tabbar" style={{ flexWrap: "nowrap", flex: isMobileViewport ? "1 1 100%" : "0 0 auto", width: isMobileViewport ? "100%" : "auto" }}>
              <button type="button" onClick={() => setTabAndRoute("users")} aria-current={tab === "users" ? "page" : undefined}>
                Users
              </button>
              <button type="button" onClick={() => setTabAndRoute("waitlist")} aria-current={tab === "waitlist" ? "page" : undefined}>
                Waitlist
              </button>
              <button type="button" onClick={() => setTabAndRoute("invites")} aria-current={tab === "invites" ? "page" : undefined}>
                Invites
              </button>
              <button 
                type="button" 
                onClick={() => setTabAndRoute("feedback")} 
                aria-current={tab === "feedback" ? "page" : undefined}
              >
                Feedback
              </button>
              <button
                type="button"
                onClick={() => setTabAndRoute("homepage")}
                aria-current={tab === "homepage" ? "page" : undefined}
                style={{ marginLeft: isMobileViewport ? "auto" : 0 }}
              >
                Homepage
              </button>
              <button
                type="button"
                onClick={() => setTabAndRoute("entities")}
                aria-current={tab === "entities" ? "page" : undefined}
              >
                Entities
              </button>
            </div>
            {tab !== "feedback" && tab !== "homepage" && tab !== "entities" ? (
            <div className="row admin-invite-row" style={{ gap: "var(--space-8)", minWidth: 0, flex: "1 1 auto", marginLeft: isMobileViewport ? 0 : "var(--space-16)", marginTop: isMobileViewport ? "var(--space-sm)" : 0, flexWrap: "nowrap", alignItems: "baseline" }}>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onFocus={() => setInviteEmailFocused(true)}
                onBlur={() => setInviteEmailFocused(false)}
                placeholder="Add via email"
                style={{ width: "100%", flex: "1 1 auto", minWidth: 0 }}
              />
              {(inviteEmailFocused || inviteEmail.trim()) ? (
                <button
                  className="om-inline-link-muted"
                  style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    setInviteLink(null);
                    try {
                      const res = await api<{ link: string }>("/api/admin/invites", {
                        method: "POST",
                        token,
                        body: JSON.stringify({ email: inviteEmail.trim() || null, expiresInDays: 14 })
                      });
                      setInviteLink(res.link);
                      await refreshInvites();
                      await refreshSummary();
                    } catch (e: any) {
                      setError(e?.message ?? "Failed to create invite");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  Invite
                </button>
              ) : null}
              {inviteLink ? (
                copiedInvite ? (
                  <span style={{ marginLeft: "var(--space-8)" }}>Copied</span>
                ) : (
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(inviteLink);
                      setCopiedInvite(true);
                      window.setTimeout(() => setCopiedInvite(false), 1500);
                    }}
                  >
                    Copy link
                  </button>
                )
              ) : null}
            </div>
            ) : null}
          </div>

          {friendlyError ? (
            <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
              {friendlyError}
            </div>
          ) : null}

          {tab !== "feedback" && tab !== "homepage" && tab !== "entities" ? (
          <div className="row admin-filter-row" style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--space-10)", marginTop: "var(--space-lg)" }}>
            <div className="row admin-filter-left" style={{ gap: "var(--space-8)", alignItems: "center", flex: "1 1 auto", minWidth: 0 }}>
              {tab === "users" ? (
                <>
                  <select
                    value={userTab}
                    onChange={(e) => {
                      setUserPage(1);
                      setUserTab(e.target.value as any);
                    }}
                    className="om-filter-control"
                  >
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                    <option value="admins">Admins</option>
                  </select>
                  <select
                    value={`${userSort}:${userDir}`}
                    onChange={(e) => {
                      const [sort, dir] = String(e.target.value).split(":");
                      setUserPage(1);
                      setUserSort(sort as any);
                      setUserDir(dir as any);
                    }}
                    className="om-filter-control"
                  >
                    <option value="created_at:desc">Newest</option>
                    <option value="created_at:asc">Oldest</option>
                  </select>
                </>
              ) : null}

              {tab === "waitlist" ? (
                <>
                  <select
                    value={waitTab}
                    onChange={(e) => {
                      setWaitPage(1);
                      setWaitTab(e.target.value as any);
                    }}
                    className="om-filter-control"
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <select
                    value={`${waitSort}:${waitDir}`}
                    onChange={(e) => {
                      const [sort, dir] = String(e.target.value).split(":");
                      setWaitPage(1);
                      setWaitSort(sort as any);
                      setWaitDir(dir as any);
                    }}
                    className="om-filter-control"
                  >
                    <option value="created_at:desc">Newest</option>
                    <option value="created_at:asc">Oldest</option>
                  </select>
                </>
              ) : null}

              {tab === "invites" ? (
                <>
                  <select
                    value={invitesStatus}
                    onChange={(e) => {
                      setInvitesPage(1);
                      setInvitesStatus(e.target.value as "pending" | "used");
                    }}
                    className="om-filter-control"
                  >
                    <option value="pending">Pending</option>
                    <option value="used">Used</option>
                  </select>
                  <select
                    value={invitesDir}
                    onChange={(e) => {
                      setInvitesPage(1);
                      setInvitesDir(e.target.value as "asc" | "desc");
                    }}
                    className="om-filter-control"
                  >
                    <option value="desc">Newest</option>
                    <option value="asc">Oldest</option>
                  </select>
                </>
              ) : null}
            </div>
            <button type="button" onClick={() => setSearchOpen((v) => !v)} style={{ marginLeft: "auto" }}>
              {searchOpen ? "Done search" : "Search"}
            </button>
          </div>
          ) : null}

          {searchOpen && tab !== "feedback" && tab !== "homepage" && tab !== "entities" ? (
            <div className="row admin-search-row" style={{ marginTop: "var(--space-10)", marginBottom: "var(--space-lg)", gap: "var(--space-8)", alignItems: "center", justifyContent: "flex-end" }}>
              {tab === "users" ? (
                <>
                  <input
                    value={userSearchDraft}
                    onChange={(e) => setUserSearchDraft(e.target.value)}
                    placeholder="Search email…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setUserPage(1);
                        setUserSearch(userSearchDraft.trim());
                      }
                    }}
                    style={{ minWidth: 180 }}
                  />
                  <button
                    onClick={() => {
                      setUserPage(1);
                      setUserSearch(userSearchDraft.trim());
                    }}
                    disabled={busy}
                  >
                    Search
                  </button>
                </>
              ) : null}
              {tab === "waitlist" ? (
                <>
                  <input
                    value={waitSearchDraft}
                    onChange={(e) => setWaitSearchDraft(e.target.value)}
                    placeholder="Search email…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setWaitPage(1);
                        setWaitSearch(waitSearchDraft.trim());
                      }
                    }}
                    style={{ minWidth: 180 }}
                  />
                  <button
                    onClick={() => {
                      setWaitPage(1);
                      setWaitSearch(waitSearchDraft.trim());
                    }}
                    disabled={busy}
                  >
                    Search
                  </button>
                </>
              ) : null}
              {tab === "invites" ? (
                <>
                  <input
                    value={invitesSearchDraft}
                    onChange={(e) => setInvitesSearchDraft(e.target.value)}
                    placeholder="Search email…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setInvitesPage(1);
                        setInvitesSearch(invitesSearchDraft.trim());
                      }
                    }}
                    style={{ minWidth: 180 }}
                  />
                  <button
                    onClick={() => {
                      setInvitesPage(1);
                      setInvitesSearch(invitesSearchDraft.trim());
                    }}
                    disabled={busy}
                  >
                    Search
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "feedback" ? (
            <AdminFeedbackBoard
              token={token}
              refreshToken={feedbackRefreshToken}
              onMetricsChange={setFeedbackMetrics}
            />
          ) : null}

          {tab === "homepage" ? (
            <div className="om-list" style={{ marginTop: "var(--space-lg)" }}>
              {homepageSlots.map((slot) => {
                const searchResults = homepageSearchResults[slot.slot_index] ?? [];
                const searchDraft = homepageSearchDrafts[slot.slot_index] ?? "";
                return (
                  <div key={slot.slot_index} className="om-list-row">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-md)" }}>
                      <div>Right rail slot {slot.slot_index}</div>
                      <div className="row" style={{ gap: "var(--space-10)", alignItems: "baseline" }}>
                        {slot.mode === "pinned" && slot.entity ? (
                          <Link href={slot.entity.slug ? `/entity/${encodeURIComponent(slot.entity.slug)}` : "#"} className="text-muted">
                            View entity
                          </Link>
                        ) : null}
                        {homepageSlots.length > 1 ? (
                          <button
                            type="button"
                            className="text-muted"
                            onClick={() => {
                              setHomepageNotice(null);
                              setHomepageSlots((prev) => resequenceHomepageSlots(prev.filter((row) => row.slot_index !== slot.slot_index)));
                              setHomepageSearchDrafts({});
                              setHomepageSearchResults({});
                            }}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: "var(--space-10)", gap: "var(--space-8)", flexWrap: "wrap" }}>
                      <select
                        value={slot.mode}
                        onChange={(e) => {
                          const mode = e.target.value as HomepageRailSlot["mode"];
                          setHomepageNotice(null);
                          setHomepageSlots((prev) =>
                            prev.map((row) =>
                              row.slot_index === slot.slot_index
                                ? {
                                    ...row,
                                    mode,
                                    entity_id: mode === "automatic" ? null : row.entity_id,
                                    entity: mode === "automatic" ? null : row.entity,
                                  }
                                : row
                            )
                          );
                        }}
                        className="om-filter-control"
                      >
                        <option value="automatic">Automatic</option>
                        <option value="pinned">Pinned</option>
                      </select>
                      <select
                        value={slot.role}
                        onChange={(e) => {
                          const role = e.target.value as HomepageRailRole;
                          setHomepageNotice(null);
                          setHomepageSlots((prev) => prev.map((row) => (row.slot_index === slot.slot_index ? { ...row, role } : row)));
                        }}
                        className="om-filter-control"
                        disabled={slot.mode !== "pinned"}
                      >
                        <option value="designer">Designer</option>
                        <option value="author">Author</option>
                        <option value="publisher">Publisher</option>
                        <option value="performer">Performer</option>
                        <option value="tag">Tag</option>
                        <option value="material">Material</option>
                      </select>
                      <input
                        value={searchDraft}
                        onChange={(e) => {
                          const value = e.target.value;
                          setHomepageSearchDrafts((prev) => ({ ...prev, [slot.slot_index]: value }));
                        }}
                        placeholder="Search entity"
                        style={{ minWidth: 200, flex: "1 1 220px" }}
                        disabled={slot.mode !== "pinned"}
                        onKeyDown={async (e) => {
                          if (e.key !== "Enter" || slot.mode !== "pinned" || !searchDraft.trim()) return;
                          const res = await api<{ entities: HomepageRailEntity[] }>(`/api/admin/homepage-rail?q=${encodeURIComponent(searchDraft.trim())}`, {
                            method: "GET",
                            token
                          });
                          setHomepageSearchResults((prev) => ({ ...prev, [slot.slot_index]: res.entities ?? [] }));
                        }}
                      />
                      <button
                        type="button"
                        disabled={slot.mode !== "pinned" || !searchDraft.trim() || homepageSaving}
                        onClick={async () => {
                          setError(null);
                          try {
                            const res = await api<{ entities: HomepageRailEntity[] }>(`/api/admin/homepage-rail?q=${encodeURIComponent(searchDraft.trim())}`, {
                              method: "GET",
                              token
                            });
                            setHomepageSearchResults((prev) => ({ ...prev, [slot.slot_index]: res.entities ?? [] }));
                          } catch (e: any) {
                            setError(e?.message ?? "Entity search failed");
                          }
                        }}
                      >
                        Search
                      </button>
                    </div>
                    {slot.mode === "pinned" ? (
                      <>
                        <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                          Selected: {slot.entity ? slot.entity.name : "None"}
                        </div>
                        <input
                          value={slot.title_override}
                          onChange={(e) => {
                            const title_override = e.target.value;
                            setHomepageNotice(null);
                            setHomepageSlots((prev) => prev.map((row) => (row.slot_index === slot.slot_index ? { ...row, title_override } : row)));
                          }}
                          placeholder="Optional custom title"
                          style={{ marginTop: "var(--space-8)", width: "100%" }}
                        />
                        {searchResults.length > 0 ? (
                          <div className="om-list" style={{ marginTop: "var(--space-8)" }}>
                            {searchResults.map((entity) => (
                              <div key={entity.id} className="om-list-row">
                                <div className="row" style={{ justifyContent: "space-between", gap: "var(--space-md)", alignItems: "baseline" }}>
                                  <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>{entity.name}</div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setHomepageNotice(null);
                                      setHomepageSlots((prev) =>
                                        prev.map((row) =>
                                          row.slot_index === slot.slot_index
                                            ? { ...row, entity_id: entity.id, entity }
                                            : row
                                        )
                                      );
                                      setHomepageSearchResults((prev) => ({ ...prev, [slot.slot_index]: [] }));
                                      setHomepageSearchDrafts((prev) => ({ ...prev, [slot.slot_index]: entity.name }));
                                    }}
                                  >
                                    Select
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                );
              })}

              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-lg)" }}>
                <div className="text-muted">{homepageNotice ?? "Automatic slots will fall back to the live recent-feed rail logic."}</div>
                <div className="row" style={{ gap: "var(--space-10)", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setHomepageNotice(null);
                      setHomepageSlots((prev) =>
                        resequenceHomepageSlots([
                          ...prev,
                          {
                            slot_index: prev.length + 1,
                            mode: "automatic",
                            role: "designer",
                            entity_id: null,
                            title_override: "",
                            entity: null,
                          },
                        ])
                      );
                    }}
                  >
                    Add slot
                  </button>
                  <button
                    type="button"
                    disabled={homepageSaving}
                    onClick={async () => {
                      setHomepageSaving(true);
                      setError(null);
                      setHomepageNotice(null);
                      try {
                        await api("/api/admin/homepage-rail", {
                          method: "POST",
                          token,
                          body: JSON.stringify({
                            slots: homepageSlots.map((slot) => ({
                              slot_index: slot.slot_index,
                              mode: slot.mode,
                              role: slot.role,
                              entity_id: slot.entity_id,
                              title_override: slot.title_override,
                            })),
                          }),
                        });
                        await refreshHomepageRail();
                        setHomepageNotice("Saved");
                      } catch (e: any) {
                        setError(e?.message === "migration_required" ? "Apply migration 0048_homepage_rail_tag_material_slots.sql before saving homepage slot changes." : (e?.message ?? "Failed to save homepage rail"));
                      } finally {
                        setHomepageSaving(false);
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "entities" ? (
            <div className="om-list" style={{ marginTop: "var(--space-lg)" }}>
              <div className="om-list-row">
                <div>Merge entities</div>
                <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                  Browse the full entity list by role, select duplicates, then choose which one to keep.
                </div>
              </div>

              <div className="row" style={{ gap: "var(--space-8)", flexWrap: "wrap", marginTop: "var(--space-lg)" }}>
                <input
                  value={entityMergeQueryDraft}
                  onChange={(e) => setEntityMergeQueryDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setEntityMergeQuery(entityMergeQueryDraft.trim());
                    }
                  }}
                  placeholder="Filter entities"
                  style={{ minWidth: 260, flex: "1 1 320px" }}
                />
                <button
                  type="button"
                  onClick={() => setEntityMergeQuery(entityMergeQueryDraft.trim())}
                  disabled={entityMergeBusy}
                >
                  Filter
                </button>
                {(entityMergeQuery || entityMergeQueryDraft) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEntityMergeQueryDraft("");
                      setEntityMergeQuery("");
                    }}
                    disabled={entityMergeBusy}
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              <div className="om-list" style={{ marginTop: "var(--space-lg)" }}>
                <div className="om-list-row">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)", flexWrap: "wrap" }}>
                    <div>
                      <div>Selected entities</div>
                      <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                        Select at least two, then mark the canonical one to keep.
                      </div>
                    </div>
                    <div className="text-muted">
                      {selectedMergeEntities.length} selected
                    </div>
                  </div>
                  {selectedMergeEntities.length > 0 ? (
                    <div className="om-list" style={{ marginTop: "var(--space-md)" }}>
                      {selectedMergeEntities.map((entity) => {
                        const isKeep = entityMergeKeepId === entity.id;
                        return (
                          <div key={`selected-${entity.id}`} className="om-list-row">
                            <div className="row" style={{ justifyContent: "space-between", gap: "var(--space-md)", alignItems: "center", flexWrap: "wrap" }}>
                              <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                                {entity.name}
                                <span className="text-muted"> · {entity.count}</span>
                                {entity.rawRoles && entity.rawRoles.length > 0 ? (
                                  <span className="text-muted"> · {entity.rawRoles.join(", ")}</span>
                                ) : null}
                              </div>
                              <div className="row" style={{ gap: "var(--space-8)", alignItems: "center", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => setEntityMergeKeepId(entity.id)}
                                  disabled={entityMergeBusy}
                                >
                                  {isKeep ? "Keeping" : "Keep this"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEntityMergeSelected((prev) => {
                                      const next = { ...prev };
                                      delete next[entity.id];
                                      return next;
                                    });
                                    setEntityMergeKeepId((prev) => (prev === entity.id ? null : prev));
                                  }}
                                  disabled={entityMergeBusy}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", marginTop: "var(--space-lg)" }}>
                <div className="text-muted">
                  {entityMergeNotice ?? "Old entity slugs will redirect to the kept entity after merge."}
                </div>
                <button
                  type="button"
                  disabled={entityMergeBusy || selectedMergeEntities.length < 2 || !entityMergeKeepId}
                  onClick={async () => {
                    const keepEntity = entityMergeKeepId ? entityMergeSelected[entityMergeKeepId] : null;
                    const sourceIds = selectedMergeEntities
                      .map((entity) => entity.id)
                      .filter((id) => id !== entityMergeKeepId);
                    if (!keepEntity || sourceIds.length === 0) return;
                    if (!window.confirm(`Merge ${sourceIds.length} selected entities into “${keepEntity.name}”?`)) return;
                    setEntityMergeBusy(true);
                    setError(null);
                    setEntityMergeNotice(null);
                    try {
                      const result = await api<{ merged_count?: number; target: { name: string } }>("/api/admin/entities/merge", {
                        method: "POST",
                        token,
                        body: JSON.stringify({
                          source_entity_ids: sourceIds,
                          target_entity_id: keepEntity.id,
                        }),
                      });
                      setEntityMergeNotice(`Merged ${result.merged_count ?? sourceIds.length} entities into ${result.target.name}.`);
                      setEntityMergeSelected({});
                      setEntityMergeKeepId(null);
                      await refreshHomepageRail();
                      await refreshEntitySections();
                    } catch (e: any) {
                      setError(e?.message === "migration_required" ? "Apply migration 0045_entity_aliases.sql before merging entities." : (e?.message ?? "Entity merge failed"));
                    } finally {
                      setEntityMergeBusy(false);
                    }
                  }}
                >
                  Merge
                </button>
              </div>

              <div className="om-list" style={{ marginTop: "var(--space-lg)" }}>
                {entityMergeSections.length === 0 ? (
                  <div className="om-list-row text-muted">
                    {entityMergeQuery ? "No entities matched that filter." : "No entities found."}
                  </div>
                ) : null}
                {entityMergeSections.map((section) => (
                  <div key={section.key} className="om-list-row">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
                      <div>{section.label}</div>
                      <div className="text-muted">{section.entities.length}</div>
                    </div>
                    <div className="om-list" style={{ marginTop: "var(--space-md)" }}>
                      {section.entities.map((entity) => {
                        const selected = Boolean(entityMergeSelected[entity.id]);
                        const keep = entityMergeKeepId === entity.id;
                        return (
                          <label key={`${section.key}-${entity.id}`} className="om-list-row" style={{ cursor: "pointer" }}>
                            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
                              <div className="row" style={{ gap: "var(--space-10)", alignItems: "center", minWidth: 0, flex: 1 }}>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setEntityMergeSelected((prev) => {
                                      if (checked) return { ...prev, [entity.id]: entity };
                                      const next = { ...prev };
                                      delete next[entity.id];
                                      return next;
                                    });
                                    setEntityMergeKeepId((prev) => {
                                      if (!checked && prev === entity.id) return null;
                                      if (checked && !prev) return entity.id;
                                      return prev;
                                    });
                                    setEntityMergeNotice(null);
                                  }}
                                />
                                <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                                  {entity.name}
                                  <span className="text-muted"> · {entity.count}</span>
                                  {entity.slug ? <span className="text-muted"> · /entity/{entity.slug}</span> : null}
                                </div>
                              </div>
                              <div className="row" style={{ gap: "var(--space-8)", alignItems: "center", flexWrap: "wrap" }}>
                                {entity.rawRoles && entity.rawRoles.length > 0 ? (
                                  <span className="text-muted">{entity.rawRoles.join(", ")}</span>
                                ) : null}
                                {selected ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setEntityMergeKeepId(entity.id);
                                    }}
                                    disabled={entityMergeBusy}
                                  >
                                    {keep ? "Keeping" : "Keep"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab !== "feedback" && tab !== "homepage" && tab !== "entities" ? (
          <div className="om-list" style={{ marginTop: searchOpen ? 0 : "var(--space-lg)" }}>
            {tab === "users"
              ? (usersData?.users ?? []).map((u) => {
                  const primary = u.username?.trim() ? u.username : (u.email ?? "(no email)");
                  const secondary = u.username?.trim() ? (u.email ?? null) : null;
                  return (
                    <AdminListItem
                      key={u.id}
                      primary={primary}
                      primaryHref={u.username?.trim() ? `/u/${encodeURIComponent(u.username)}` : null}
                      showAvatar
                      avatarUrl={u.avatar_path ? (avatarUrlsByPath[u.avatar_path] ?? null) : null}
                      actions={
                        <>
                          <button
                            onClick={async () => {
                              setBusy(true);
                              setError(null);
                              try {
                                const next = u.status === "disabled" ? "active" : "disabled";
                                await api(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: "PATCH", token, body: JSON.stringify({ status: next }) });
                                await refreshUsers();
                                await refreshSummary();
                              } catch (e: any) {
                                setError(e?.message ?? "Update failed");
                              } finally {
                                setBusy(false);
                              }
                            }}
                            disabled={busy}
                          >
                            {u.status === "disabled" ? "Enable" : "Disable"}
                          </button>
                          <button
                            onClick={async () => {
                              setBusy(true);
                              setError(null);
                              try {
                                const next = u.role === "admin" ? "user" : "admin";
                                await api(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: "PATCH", token, body: JSON.stringify({ role: next }) });
                                await refreshUsers();
                                await refreshSummary();
                              } catch (e: any) {
                                setError(e?.message ?? "Update failed");
                              } finally {
                                setBusy(false);
                              }
                            }}
                            disabled={busy}
                          >
                            {u.role === "admin" ? "Demote" : "Promote"}
                          </button>
                        </>
                      }
                      meta={[
                        { label: "Status", value: titleCase(u.status) },
                        { label: "Date", value: formatDateShort(u.created_at) },
                        { label: "Role", value: titleCase(u.role) }
                      ]}
                      secondary={secondary}
                    />
                  );
                })
              : null}

            {tab === "waitlist"
              ? (waitlistData?.waitlist ?? []).map((w) => {
                  const hasUsername = Boolean(w.username?.trim());
                  const primary = hasUsername ? String(w.username).trim() : w.email;
                  const secondary = hasUsername ? (
                    <>
                      <div>{w.email}</div>
                      {w.note ? <div>{w.note}</div> : null}
                    </>
                  ) : (
                    w.note
                  );
                  return (
                    <AdminListItem
                      key={w.id}
                      primary={primary}
                      primaryHref={hasUsername ? `/u/${encodeURIComponent(String(w.username).trim())}` : null}
                      actions={
                        w.status === "pending" ? (
                          <>
                            <button
                              onClick={async () => {
                                setBusy(true);
                                setError(null);
                                setInviteLink(null);
                                try {
                                  const res = await api<{ link: string }>(`/api/admin/waitlist/${encodeURIComponent(w.id)}`, {
                                    method: "PATCH",
                                    token,
                                    body: JSON.stringify({ action: "approve" })
                                  });
                                  setInviteLink(res.link);
                                  await refreshWaitlist();
                                  await refreshInvites();
                                  await refreshSummary();
                                } catch (e: any) {
                                  setError(e?.message ?? "Approve failed");
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              disabled={busy}
                            >
                              Approve
                            </button>
                            <button
                              onClick={async () => {
                                setBusy(true);
                                setError(null);
                                try {
                                  await api(`/api/admin/waitlist/${encodeURIComponent(w.id)}`, { method: "PATCH", token, body: JSON.stringify({ action: "reject" }) });
                                  await refreshWaitlist();
                                  await refreshSummary();
                                } catch (e: any) {
                                  setError(e?.message ?? "Reject failed");
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              disabled={busy}
                            >
                              Reject
                            </button>
                          </>
                        ) : undefined
                      }
                      meta={[
                        { label: "Status", value: titleCase(w.status) },
                        { label: "Date", value: formatDateShort(w.created_at) }
                      ]}
                      secondary={secondary}
                    />
                  );
                })
              : null}

            {tab === "invites"
              ? (invitesData?.invites ?? []).map((invite) => {
                  const status = inviteStatus(invite);
                  const hasUsername = Boolean(invite.username?.trim());
                  const primary = hasUsername ? String(invite.username).trim() : invite.email?.trim() ? invite.email : "Any email";
                  const secondary = hasUsername ? (
                    <>
                      <div>{invite.email}</div>
                      <div>Token {invite.token}</div>
                    </>
                  ) : (
                    `Token ${invite.token}`
                  );
                  return (
                    <AdminListItem
                      key={invite.id}
                      primary={primary}
                      primaryHref={hasUsername ? `/u/${encodeURIComponent(String(invite.username).trim())}` : null}
                      actions={
                        <>
                          {copiedLinkForId === invite.id ? (
                            <span>Copied</span>
                          ) : (
                            <button
                              onClick={async () => {
                                const link = `${window.location.origin}/accept-invite?token=${encodeURIComponent(invite.token)}`;
                                await navigator.clipboard.writeText(link);
                                setInviteLink(link);
                                setCopiedLinkForId(invite.id);
                                window.setTimeout(() => setCopiedLinkForId(null), 1500);
                              }}
                            >
                              Copy link
                            </button>
                          )}
                          {status === "pending" ? (
                            <button
                              className="text-muted"
                              onClick={async () => {
                                if (!window.confirm("Rescind this pending invite?")) return;
                                setBusy(true);
                                setError(null);
                                const previousInvitesData = invitesData;
                                setInvitesData((prev) => {
                                  if (!prev) return prev;
                                  return {
                                    ...prev,
                                    invites: prev.invites.filter((row) => row.id !== invite.id),
                                    total: Math.max(0, prev.total - 1),
                                    metrics: {
                                      ...prev.metrics,
                                      total: Math.max(0, prev.metrics.total - 1),
                                      pending: Math.max(0, prev.metrics.pending - 1)
                                    }
                                  };
                                });
                                try {
                                  await api(`/api/admin/invites/${encodeURIComponent(invite.id)}`, { method: "DELETE", token });
                                  await refreshInvites();
                                  await refreshSummary();
                                } catch (e: any) {
                                  setInvitesData(previousInvitesData);
                                  setError(e?.message ?? "Rescind failed");
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              disabled={busy}
                            >
                              Rescind
                            </button>
                          ) : null}
                        </>
                      }
                      meta={[
                        { label: "Status", value: titleCase(status) },
                        { label: "Date", value: formatDateShort(invite.created_at) }
                      ]}
                      secondary={secondary}
                    />
                  );
                })
              : null}
          </div>
          ) : null}

          {tab !== "feedback" && tab !== "homepage" && tab !== "entities" ? (
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--space-10)", marginTop: "var(--space-lg)" }}>
            <div className="text-muted">
              {tab === "users" ? resultLabel(usersData?.page ?? userPage, userTotalPages, usersData?.total ?? 0) : null}
              {tab === "waitlist" ? resultLabel(waitlistData?.page ?? waitPage, waitTotalPages, waitlistData?.total ?? 0) : null}
              {tab === "invites" ? resultLabel(invitesData?.page ?? invitesPage, invitesTotalPages, invitesData?.total ?? 0) : null}
            </div>
            <div className="admin-page-size" style={{ flex: "0 0 auto" }}>
              {tab === "users" ? (
                <select
                  value={userPageSize}
                  onChange={(e) => {
                    setUserPage(1);
                    setUserPageSize(Number(e.target.value));
                  }}
                  className="om-filter-control"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              ) : null}
              {tab === "waitlist" ? (
                <select
                  value={waitPageSize}
                  onChange={(e) => {
                    setWaitPage(1);
                    setWaitPageSize(Number(e.target.value));
                  }}
                  className="om-filter-control"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              ) : null}
              {tab === "invites" ? (
                <select
                  value={invitesPageSize}
                  onChange={(e) => {
                    setInvitesPage(1);
                    setInvitesPageSize(Number(e.target.value));
                  }}
                  className="om-filter-control"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              ) : null}
            </div>
          </div>
          ) : null}

          {inviteLink && tab !== "feedback" && tab !== "homepage" && tab !== "entities" ? (
            <div className="text-muted" style={{ marginTop: "var(--space-8)", wordBreak: "break-all" }}>
              {inviteLink}
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<main className="container" />}>
      <AdminPageInner />
    </Suspense>
  );
}
