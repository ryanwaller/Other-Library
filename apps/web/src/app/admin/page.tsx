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

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistRow[]>([]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDays, setInviteDays] = useState("14");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  const token = session?.access_token ?? "";

  async function refreshAll() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setInviteLink(null);
    try {
      const u = await api<{ users: ProfileRow[] }>("/api/admin/users", { method: "GET", token });
      const i = await api<{ invites: InviteRow[] }>("/api/admin/invites", { method: "GET", token });
      const w = await api<{ waitlist: WaitlistRow[] }>("/api/admin/waitlist", { method: "GET", token });
      setUsers(u.users ?? []);
      setInvites(i.invites ?? []);
      setWaitlist(w.waitlist ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load admin data");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const activeAdmins = useMemo(() => users.filter((u) => u.role === "admin" && u.status === "active").length, [users]);

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
              <button onClick={refreshAll} disabled={busy}>
                Refresh
              </button>
              <Link href="/app" className="muted">
                App
              </Link>
            </div>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Active admins: {activeAdmins}. {error ? `Error: ${error}` : busy ? "Loading…" : ""}
          </div>

          <div style={{ marginTop: 14 }} className="card">
            <div style={{ marginBottom: 8 }}>Create invite</div>
            <div className="row" style={{ gap: 10 }}>
              <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Email (optional)" />
              <input value={inviteDays} onChange={(e) => setInviteDays(e.target.value)} placeholder="Expires (days)" style={{ width: 120 }} />
              <button
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  setInviteLink(null);
                  try {
                    const res = await api<{ link: string }>("/api/admin/invites", {
                      method: "POST",
                      token,
                      body: JSON.stringify({ email: inviteEmail.trim() || null, expiresInDays: Number(inviteDays) || 14 })
                    });
                    setInviteLink(res.link);
                    await refreshAll();
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
              <div className="row" style={{ marginTop: 10, gap: 10 }}>
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

          <div style={{ marginTop: 14 }} className="card">
            <div style={{ marginBottom: 8 }}>Waitlist</div>
            {waitlist.length === 0 ? (
              <div className="muted">No requests yet.</div>
            ) : (
              waitlist.slice(0, 200).map((w) => (
                <div key={w.id} className="card" style={{ marginTop: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      {w.email} <span className="muted">({w.status})</span>
                    </div>
                    {w.status === "pending" ? (
                      <div className="row" style={{ gap: 10 }}>
                        <button
                          onClick={async () => {
                            setBusy(true);
                            setError(null);
                            setInviteLink(null);
                            try {
                              const res = await api<{ link: string }>("/api/admin/waitlist/" + encodeURIComponent(w.id), {
                                method: "PATCH",
                                token,
                                body: JSON.stringify({ action: "approve" })
                              });
                              setInviteLink(res.link);
                              await refreshAll();
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
                              await api("/api/admin/waitlist/" + encodeURIComponent(w.id), {
                                method: "PATCH",
                                token,
                                body: JSON.stringify({ action: "reject" })
                              });
                              await refreshAll();
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
                    <div className="muted" style={{ marginTop: 8 }}>
                      {w.note}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div style={{ marginTop: 14 }} className="card">
            <div style={{ marginBottom: 8 }}>Users</div>
            {users.slice(0, 200).map((u) => (
              <div key={u.id} className="card" style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span>{u.username}</span> <span className="muted">{u.email ? `· ${u.email}` : ""}</span>
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="muted">
                      {u.role}/{u.status}
                    </span>
                    <button
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          await api("/api/admin/users/" + encodeURIComponent(u.id), {
                            method: "PATCH",
                            token,
                            body: JSON.stringify({ status: u.status === "disabled" ? "active" : "disabled" })
                          });
                          await refreshAll();
                        } catch (e: any) {
                          setError(e?.message ?? "Update failed");
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy || u.id === session.user.id}
                      title={u.id === session.user.id ? "Can't change yourself" : ""}
                    >
                      {u.status === "disabled" ? "Enable" : "Disable"}
                    </button>
                    <button
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          await api("/api/admin/users/" + encodeURIComponent(u.id), {
                            method: "PATCH",
                            token,
                            body: JSON.stringify({ role: u.role === "admin" ? "user" : "admin" })
                          });
                          await refreshAll();
                        } catch (e: any) {
                          setError(e?.message ?? "Update failed");
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy || u.id === session.user.id}
                      title={u.id === session.user.id ? "Can't change yourself" : ""}
                    >
                      {u.role === "admin" ? "Demote" : "Promote"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14 }} className="card">
            <div style={{ marginBottom: 8 }}>Invites</div>
            {invites.length === 0 ? (
              <div className="muted">No invites yet.</div>
            ) : (
              invites.slice(0, 200).map((inv) => (
                <div key={inv.id} className="card" style={{ marginTop: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div className="muted" style={{ wordBreak: "break-all" }}>
                      {inv.email ? `${inv.email} · ` : ""}
                      {inv.used_at ? "used" : inv.expires_at ? `expires ${inv.expires_at}` : "no expiry"}
                    </div>
                    <button
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        setInviteLink(null);
                        try {
                          const res = await api<{ link: string }>(`/api/admin/invites/${encodeURIComponent(inv.id)}/resend`, {
                            method: "POST",
                            token
                          });
                          setInviteLink(res.link);
                        } catch (e: any) {
                          setError(e?.message ?? "Failed");
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                    >
                      Copy link
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </main>
  );
}
