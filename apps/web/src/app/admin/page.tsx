"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import SignInCard from "../components/SignInCard";
import { supabase } from "../../lib/supabaseClient";

type ProfileRow = {
  id: string;
  email: string | null;
  username: string;
  display_name: string | null;
  role: "user" | "admin";
  status: "active" | "disabled" | "pending";
  created_at: string;
};

type InviteRow = {
  id: string;
  token: string;
  email: string | null;
  created_by: string | null;
  expires_at: string | null;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
};

type WaitlistRow = {
  id: string;
  email: string;
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

type InvitesResponse = { invites: InviteRow[]; page: number; pageSize: number; total: number };

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

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const token = session?.access_token ?? "";

  const [view, setView] = useState<"users" | "waitlist">("users");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const friendlyError = useMemo(() => {
    if (!error) return null;
    if (error === "admin_not_configured") return "Admin API is not configured on the server (missing SUPABASE_SERVICE_ROLE_KEY).";
    return error;
  }, [error]);

  // Users controls
  const [userTab, setUserTab] = useState<"all" | "active" | "disabled" | "admins">("all");
  const [userSearchDraft, setUserSearchDraft] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userSort, setUserSort] = useState<"email" | "role" | "status" | "created_at">("created_at");
  const [userDir, setUserDir] = useState<"asc" | "desc">("desc");
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(20);

  const [usersData, setUsersData] = useState<UsersResponse | null>(null);

  // Waitlist controls
  const [waitTab, setWaitTab] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [waitSearchDraft, setWaitSearchDraft] = useState("");
  const [waitSearch, setWaitSearch] = useState("");
  const [waitSort, setWaitSort] = useState<"email" | "status" | "created_at">("created_at");
  const [waitDir, setWaitDir] = useState<"asc" | "desc">("desc");
  const [waitPage, setWaitPage] = useState(1);
  const [waitPageSize, setWaitPageSize] = useState(20);

  const [waitlistData, setWaitlistData] = useState<WaitlistResponse | null>(null);

  // Invites
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [invitesData, setInvitesData] = useState<InvitesResponse | null>(null);
  const [invitesPage, setInvitesPage] = useState(1);
  const invitesPageSize = 20;

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function refreshUsers() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("q", userSearch);
      params.set("sort", userSort);
      params.set("dir", userDir);
      params.set("page", String(userPage));
      params.set("pageSize", String(userPageSize));
      if (userTab === "active") params.set("status", "active");
      if (userTab === "disabled") params.set("status", "disabled");
      if (userTab === "admins") params.set("role", "admin");
      if (userTab === "all") {
        params.set("status", "all");
        params.set("role", "all");
      }
      const res = await api<UsersResponse>(`/api/admin/users?${params.toString()}`, { method: "GET", token });
      setUsersData(res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load users");
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
      const params = new URLSearchParams();
      params.set("q", waitSearch);
      params.set("sort", waitSort);
      params.set("dir", waitDir);
      params.set("page", String(waitPage));
      params.set("pageSize", String(waitPageSize));
      params.set("status", waitTab);
      const res = await api<WaitlistResponse>(`/api/admin/waitlist?${params.toString()}`, { method: "GET", token });
      setWaitlistData(res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load waitlist");
      setWaitlistData(null);
    } finally {
      setBusy(false);
    }
  }

  async function refreshInvites() {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      params.set("page", String(invitesPage));
      params.set("pageSize", String(invitesPageSize));
      const res = await api<InvitesResponse>(`/api/admin/invites?${params.toString()}`, { method: "GET", token });
      setInvitesData(res);
    } catch {
      setInvitesData(null);
    }
  }

  useEffect(() => {
    setInviteLink(null);
  }, [view]);

  useEffect(() => {
    if (!token || view !== "users") return;
    refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, view, userTab, userSearch, userSort, userDir, userPage, userPageSize]);

  useEffect(() => {
    if (!token || view !== "waitlist") return;
    refreshWaitlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, view, waitTab, waitSearch, waitSort, waitDir, waitPage, waitPageSize]);

  useEffect(() => {
    if (!token || view !== "users") return;
    refreshInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, view, invitesPage]);

  const usersMetrics = usersData?.metrics ?? { total: 0, active: 0, disabled: 0, pending: 0 };
  const userTotalPages = usersData ? Math.max(1, Math.ceil(usersData.total / usersData.pageSize)) : 1;
  const waitTotalPages = waitlistData ? Math.max(1, Math.ceil(waitlistData.total / waitlistData.pageSize)) : 1;
  const invitesTotalPages = invitesData ? Math.max(1, Math.ceil(invitesData.total / invitesData.pageSize)) : 1;

  function setSort(next: "email" | "role" | "status" | "created_at") {
    if (userSort === next) setUserDir(userDir === "asc" ? "desc" : "asc");
    else {
      setUserSort(next);
      setUserDir(next === "created_at" ? "desc" : "asc");
    }
    setUserPage(1);
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
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>Admin</div>
            <div className="row" style={{ gap: 10 }}>
              <button
                onClick={() => {
                  setInviteLink(null);
                  if (view === "users") {
                    refreshUsers();
                    refreshInvites();
                  } else {
                    refreshWaitlist();
                  }
                }}
                disabled={busy}
              >
                Refresh
              </button>
              <Link href="/app" className="muted">
                App
              </Link>
            </div>
          </div>

          <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                setView("users");
              }}
              disabled={view === "users"}
            >
              Users
            </button>
            <button
              onClick={() => {
                setView("waitlist");
              }}
              disabled={view === "waitlist"}
            >
              Waitlist
            </button>
            <div className="muted">{friendlyError ? `Error: ${friendlyError}` : busy ? "Loading…" : ""}</div>
          </div>

          {view === "users" ? (
            <>
              <hr className="om-hr" />
              <div className="card" style={{ marginTop: 14 }}>
                <div style={{ marginBottom: 8 }}>Summary</div>
                <div className="muted">
                  total: {usersMetrics.total} · active: {usersMetrics.active} · disabled: {usersMetrics.disabled} · pending: {usersMetrics.pending}
                </div>
              </div>

              <hr className="om-hr" />
              <div style={{ marginTop: 14 }} className="card">
                <div style={{ marginBottom: 8 }}>Create invite</div>
                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                  <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Email (optional)" />
                  <button
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
                      } catch (e: any) {
                        setError(e?.message ?? "Failed to create invite");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy}
                  >
                    Create
                  </button>
                </div>
                {inviteLink ? (
                  <div className="row" style={{ marginTop: 10, gap: 10, alignItems: "center" }}>
                    <div className="muted" style={{ wordBreak: "break-all" }}>
                      {inviteLink}
                    </div>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(inviteLink);
                      }}
                    >
                      Copy
                    </button>
                  </div>
                ) : null}
              </div>

              <hr className="om-hr" />
              <div className="card" style={{ marginTop: 14 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div>Users</div>
                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
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
                    <select
                      value={userPageSize}
                      onChange={(e) => {
                        setUserPage(1);
                        setUserPageSize(Number(e.target.value));
                      }}
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                </div>

                <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      setUserPage(1);
                      setUserTab("all");
                    }}
                    disabled={userTab === "all"}
                  >
                    All
                  </button>
                  <button
                    onClick={() => {
                      setUserPage(1);
                      setUserTab("active");
                    }}
                    disabled={userTab === "active"}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => {
                      setUserPage(1);
                      setUserTab("disabled");
                    }}
                    disabled={userTab === "disabled"}
                  >
                    Disabled
                  </button>
                  <button
                    onClick={() => {
                      setUserPage(1);
                      setUserTab("admins");
                    }}
                    disabled={userTab === "admins"}
                  >
                    Admins
                  </button>
                  <div className="muted">
                    page {usersData?.page ?? userPage} / {userTotalPages} · {usersData?.total ?? 0} results
                  </div>
                </div>

                <div className="card" style={{ marginTop: 12, overflowX: "auto" }}>
                  <div className="row" style={{ gap: 10, alignItems: "center" }}>
                    <button onClick={() => setSort("email")} disabled={busy}>
                      Email
                    </button>
                    <button onClick={() => setSort("role")} disabled={busy}>
                      Role
                    </button>
                    <button onClick={() => setSort("status")} disabled={busy}>
                      Status
                    </button>
                    <button onClick={() => setSort("created_at")} disabled={busy}>
                      Created
                    </button>
                    <div className="muted">
                      sort: {userSort} {userDir}
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    {(usersData?.users ?? []).map((u) => (
                      <div key={u.id} className="row" style={{ justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ wordBreak: "break-all" }}>
                            {u.email ?? <span className="muted">(no email)</span>}{" "}
                            <span className="muted">
                              · {u.role}/{u.status} · {fmtDate(u.created_at)}
                            </span>
                          </div>
                          <div className="muted">{u.username}</div>
                        </div>
                        <div className="row" style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <button
                            onClick={async () => {
                              setBusy(true);
                              setError(null);
                              try {
                                const next = u.status === "disabled" ? "active" : "disabled";
                                await api(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: "PATCH", token, body: JSON.stringify({ status: next }) });
                                await refreshUsers();
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
                        </div>
                      </div>
                    ))}
                    {(usersData?.users ?? []).length === 0 ? <div className="muted" style={{ paddingTop: 8 }}>No users.</div> : null}
                  </div>

                  <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                    <button
                      onClick={() => setUserPage(Math.max(1, userPage - 1))}
                      disabled={busy || userPage <= 1}
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setUserPage(Math.min(userTotalPages, userPage + 1))}
                      disabled={busy || userPage >= userTotalPages}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>

              <hr className="om-hr" />
              <div className="card" style={{ marginTop: 14 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div>Invites</div>
                  <div className="muted">
                    page {invitesData?.page ?? invitesPage} / {invitesTotalPages} · {invitesData?.total ?? 0} total
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  {(invitesData?.invites ?? []).map((i) => (
                    <div key={i.id} className="row" style={{ justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ wordBreak: "break-all" }}>
                          <span className="muted">{fmtDate(i.created_at)}</span> · {i.email ?? <span className="muted">(any email)</span>}{" "}
                          <span className="muted">{i.used_at ? "· used" : ""}</span>
                        </div>
                        <div className="muted" style={{ wordBreak: "break-all" }}>
                          token: {i.token}
                        </div>
                      </div>
                      <div className="row" style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button
                          onClick={async () => {
                            const link = `${window.location.origin}/accept-invite?token=${encodeURIComponent(i.token)}`;
                            await navigator.clipboard.writeText(link);
                            setInviteLink(link);
                          }}
                        >
                          Copy link
                        </button>
                      </div>
                    </div>
                  ))}
                  {(invitesData?.invites ?? []).length === 0 ? <div className="muted" style={{ paddingTop: 8 }}>No invites.</div> : null}
                </div>

                <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setInvitesPage(Math.max(1, invitesPage - 1))} disabled={busy || invitesPage <= 1}>
                    Prev
                  </button>
                  <button onClick={() => setInvitesPage(Math.min(invitesTotalPages, invitesPage + 1))} disabled={busy || invitesPage >= invitesTotalPages}>
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="card" style={{ marginTop: 14 }}>
                <div style={{ marginBottom: 8 }}>Waitlist</div>

                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <button
                      onClick={() => {
                        setWaitPage(1);
                        setWaitTab("all");
                      }}
                      disabled={waitTab === "all"}
                    >
                      All
                    </button>
                    <button
                      onClick={() => {
                        setWaitPage(1);
                        setWaitTab("pending");
                      }}
                      disabled={waitTab === "pending"}
                    >
                      Pending
                    </button>
                    <button
                      onClick={() => {
                        setWaitPage(1);
                        setWaitTab("approved");
                      }}
                      disabled={waitTab === "approved"}
                    >
                      Approved
                    </button>
                    <button
                      onClick={() => {
                        setWaitPage(1);
                        setWaitTab("rejected");
                      }}
                      disabled={waitTab === "rejected"}
                    >
                      Rejected
                    </button>
                  </div>

                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
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
                    <select
                      value={waitPageSize}
                      onChange={(e) => {
                        setWaitPage(1);
                        setWaitPageSize(Number(e.target.value));
                      }}
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                </div>

                <div className="muted" style={{ marginTop: 10 }}>
                  total: {waitlistData?.metrics.total ?? 0} · pending: {waitlistData?.metrics.pending ?? 0} · approved: {waitlistData?.metrics.approved ?? 0} · rejected:{" "}
                  {waitlistData?.metrics.rejected ?? 0}
                </div>

                <div style={{ marginTop: 10 }}>
                  {(waitlistData?.waitlist ?? []).map((w) => (
                    <div key={w.id} className="card" style={{ marginTop: 10 }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <span style={{ wordBreak: "break-all" }}>{w.email}</span> <span className="muted">({w.status} · {fmtDate(w.created_at)})</span>
                        </div>
                        {w.status === "pending" ? (
                          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
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
                          </div>
                        ) : null}
                      </div>
                      {w.note ? (
                        <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                          {w.note}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {(waitlistData?.waitlist ?? []).length === 0 ? <div className="muted" style={{ marginTop: 10 }}>No requests.</div> : null}
                </div>

                <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  <div className="muted">
                    page {waitlistData?.page ?? waitPage} / {waitTotalPages} · {waitlistData?.total ?? 0} results
                  </div>
                  <button onClick={() => setWaitPage(Math.max(1, waitPage - 1))} disabled={busy || waitPage <= 1}>
                    Prev
                  </button>
                  <button onClick={() => setWaitPage(Math.min(waitTotalPages, waitPage + 1))} disabled={busy || waitPage >= waitTotalPages}>
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
