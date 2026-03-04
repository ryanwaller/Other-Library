"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type InviteStatus =
  | { ok: true; id: string; email: string | null; expires_at: string | null }
  | { ok: false; reason: string; email?: string | null; expires_at?: string | null; used_at?: string | null };

export default function AcceptInviteClient() {
  const router = useRouter();
  const params = useSearchParams();
  const token = (params.get("token") ?? "").trim();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<InviteStatus | null>(null);

  const tokenShort = useMemo(() => (token ? `${token.slice(0, 6)}…${token.slice(-6)}` : ""), [token]);

  useEffect(() => {
    if (!token) return;
    setBusy(true);
    setError(null);
    fetch(`/api/invite/validate?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? "Failed to validate invite");
        setStatus((j?.result ?? null) as any);
      })
      .catch((e) => setError(e?.message ?? "Failed to validate invite"))
      .finally(() => setBusy(false));
  }, [token]);

  return (
    <main className="container">
      <div className="card">
        <div style={{ marginBottom: "var(--space-8)" }}>Accept invite</div>
        {!token ? (
          <div className="muted">Missing token.</div>
        ) : (
          <>
            <div className="muted">Token: {tokenShort}</div>
            <div className="muted" style={{ marginTop: "var(--space-8)" }}>
              {busy ? "Checking…" : error ? error : status ? (status.ok ? "Invite valid." : `Invite invalid: ${status.reason}`) : ""}
            </div>
            {status?.ok ? (
              <div className="row" style={{ marginTop: "var(--space-md)", gap: "var(--space-10)" }}>
                <button
                  onClick={() => {
                    try {
                      window.localStorage.setItem("om_invite_token", token);
                    } catch {
                      // ignore
                    }
                    router.push(`/signup?token=${encodeURIComponent(token)}`);
                  }}
                >
                  Continue
                </button>
                <span className="muted">{status.email ? `Invite is for: ${status.email}` : ""}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

