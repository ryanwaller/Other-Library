"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import SignInCard from "./components/SignInCard";

export default function ExploreAuthPanel({ open, standalone = false }: { open: boolean; standalone?: boolean }) {
  const router = useRouter();
  const [inviteToken, setInviteToken] = useState("");
  const [waitEmail, setWaitEmail] = useState("");
  const [waitNote, setWaitNote] = useState("");
  const [waitState, setWaitState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  if (!open) return null;

  return (
    <section id="signin" style={{ marginTop: standalone ? "var(--space-lg)" : "var(--space-xl)" }}>
      {!standalone ? <hr className="divider" /> : null}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: "var(--space-lg)" }}>
        <div>Sign in</div>
        <button type="button" className="text-muted" onClick={() => router.replace("/")}>
          {standalone ? "Explore" : "Close"}
        </button>
      </div>

      <div className="row" style={{ alignItems: "flex-start", gap: "var(--space-lg)", marginTop: "var(--space-md)", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 360px", minWidth: 300 }}>
          <SignInCard note="Existing users can sign in and head straight to the library." redirectTo="/app" />
        </div>

        <div style={{ flex: "1 1 320px", minWidth: 300, display: "grid", gap: "var(--space-md)" }}>
          <div className="card">
            <div>I have an invite</div>
            <div className="row" style={{ marginTop: "var(--space-8)", alignItems: "baseline" }}>
              <input
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
                placeholder="Invite token"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => {
                  const token = inviteToken.trim();
                  if (!token) return;
                  try {
                    window.localStorage.setItem("om_invite_token", token);
                  } catch {
                    // ignore
                  }
                  router.push(`/accept-invite?token=${encodeURIComponent(token)}`);
                }}
                disabled={!inviteToken.trim()}
              >
                Continue
              </button>
            </div>
          </div>

          <div className="card">
            <div>Request access</div>
            <div className="row" style={{ marginTop: "var(--space-8)", alignItems: "baseline" }}>
              <input
                value={waitEmail}
                onChange={(e) => setWaitEmail(e.target.value)}
                placeholder="Email"
                style={{ flex: 1 }}
              />
            </div>
            <div className="row" style={{ marginTop: "var(--space-8)", alignItems: "baseline" }}>
              <input
                value={waitNote}
                onChange={(e) => setWaitNote(e.target.value)}
                placeholder="Note (optional)"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={async () => {
                  const email = waitEmail.trim();
                  if (!email) return;
                  setWaitState({ busy: true, error: null, message: null });
                  try {
                    const res = await fetch("/api/waitlist", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ email, note: waitNote })
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(String((json as any)?.error ?? "Request failed"));
                    setWaitEmail("");
                    setWaitNote("");
                    setWaitState({
                      busy: false,
                      error: null,
                      message: (json as any)?.already ? "Already on the list" : "Requested"
                    });
                    window.setTimeout(() => setWaitState({ busy: false, error: null, message: null }), 2000);
                  } catch (e: any) {
                    setWaitState({
                      busy: false,
                      error: e?.message ?? "Request failed",
                      message: "Request failed"
                    });
                  }
                }}
                disabled={waitState.busy || !waitEmail.trim()}
              >
                {waitState.busy ? "Submitting..." : "Submit"}
              </button>
            </div>
            {waitState.message ? (
              <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                {waitState.error ? `${waitState.message} (${waitState.error})` : waitState.message}
              </div>
            ) : null}
          </div>

          <div className="text-muted" style={{ paddingLeft: "2px" }}>
            Private beta. If you already have access, sign in. If not, request access or continue with an invite.
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: "var(--space-md)" }}>
        <Link href="/">Back to Explore</Link>
      </div>
    </section>
  );
}
