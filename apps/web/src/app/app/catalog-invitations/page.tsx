"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import SignInCard from "../../components/SignInCard";

type PendingInvite = {
  id: string;
  catalog_id: number;
  role: "owner" | "editor" | "viewer";
  invited_at: string;
  catalog: { id: number; name: string } | null;
  inviter: { id: string; username: string | null } | null;
};

export default function CatalogInvitationsPage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PendingInvite[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setToken(next?.access_token ?? null);
      setSessionReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function refresh() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/catalog/invitations/pending", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "request_failed"));
      setRows(((json?.invitations ?? []) as any[]).map((r) => ({ ...r })));
    } catch (e: any) {
      setRows([]);
      setError(e?.message ?? "Failed to load invitations");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function act(catalogId: number, action: "accept" | "decline") {
    if (!token) return;
    const res = await fetch(`/api/catalog/${catalogId}/${action}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(String(json?.error ?? `${action}_failed`));
      return;
    }
    window.dispatchEvent(new Event("om:catalog-members-changed"));
    await refresh();
  }

  if (!supabase) {
    return (
      <main className="container">
        <div className="card">
          <div>Supabase is not configured.</div>
        </div>
      </main>
    );
  }

  if (!sessionReady) return null;
  if (!token) {
    return (
      <main className="container">
        <SignInCard note="Sign in to manage catalog invitations." />
      </main>
    );
  }

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <div>Catalog invitations</div>
          <div className="text-muted">{busy ? "Loading…" : rows.length}</div>
        </div>
        {error ? <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>{error}</div> : null}

        <div className="om-list" style={{ marginTop: "var(--space-md)" }}>
          {rows.length === 0 ? (
            <div className="text-muted">No pending invitations.</div>
          ) : (
            rows.map((r, idx) => (
              <div key={r.id} className="om-list-row" style={idx === rows.length - 1 ? { borderBottom: "none" } : undefined}>
                <div style={{ minWidth: 0 }}>
                  <div>{r.catalog?.name ?? `Catalog ${r.catalog_id}`}</div>
                  <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                    {r.inviter?.username ? (
                      <>
                        Invited by <Link href={`/u/${r.inviter.username}`}>{r.inviter.username}</Link>
                      </>
                    ) : (
                      "Invited"
                    )}{" "}
                    · role {r.role}
                  </div>
                </div>
                <div className="row" style={{ marginTop: "var(--space-sm)", gap: "var(--space-md)" }}>
                  <button onClick={() => void act(r.catalog_id, "accept")}>Accept</button>
                  <button className="text-muted" onClick={() => void act(r.catalog_id, "decline")}>Decline</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
