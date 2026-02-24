"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SignInCard from "./components/SignInCard";

export default function HomeClient() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenFromUrl = (params.get("token") ?? "").trim();

  const [inviteToken, setInviteToken] = useState(tokenFromUrl);
  const [waitEmail, setWaitEmail] = useState("");
  const [waitNote, setWaitNote] = useState("");
  const [waitState, setWaitState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  return (
    <main className="container">
      <div className="card">
        <div style={{ marginBottom: 8 }}>Other Library</div>
        <div className="muted" style={{ marginBottom: 12 }}>
          Private beta.
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 320px" }}>
            <SignInCard note="Existing users: sign in." redirectTo="/app" />
          </div>

          <div style={{ flex: "1 1 320px" }} className="card">
            <div style={{ marginBottom: 8 }}>I have an invite</div>
            <div className="row" style={{ marginTop: 8 }}>
              <input value={inviteToken} onChange={(e) => setInviteToken(e.target.value)} placeholder="Invite token" />
              <button
                onClick={() => {
                  const t = inviteToken.trim();
                  if (!t) return;
                  try {
                    window.localStorage.setItem("om_invite_token", t);
                  } catch {
                    // ignore
                  }
                  router.push(`/accept-invite?token=${encodeURIComponent(t)}`);
                }}
                disabled={!inviteToken.trim()}
              >
                Continue
              </button>
            </div>
          </div>

          <div style={{ flex: "1 1 320px" }} className="card">
            <div style={{ marginBottom: 8 }}>Request access</div>
            <div className="row" style={{ marginTop: 8 }}>
              <input value={waitEmail} onChange={(e) => setWaitEmail(e.target.value)} placeholder="Email" />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input value={waitNote} onChange={(e) => setWaitNote(e.target.value)} placeholder="Note (optional)" />
              <button
                onClick={async () => {
                  const email = waitEmail.trim();
                  if (!email) return;
                  setWaitState({ busy: true, error: null, message: "Submitting…" });
                  try {
                    const res = await fetch("/api/waitlist", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ email, note: waitNote })
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(json?.error ?? "Request failed");
                    setWaitEmail("");
                    setWaitNote("");
                    setWaitState({ busy: false, error: null, message: json?.already ? "Already on the list" : "Requested" });
                    window.setTimeout(() => setWaitState({ busy: false, error: null, message: null }), 1500);
                  } catch (e: any) {
                    setWaitState({ busy: false, error: e?.message ?? "Request failed", message: "Request failed" });
                  }
                }}
                disabled={waitState.busy || !waitEmail.trim()}
              >
                {waitState.busy ? "Submitting…" : "Submit"}
              </button>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {waitState.message ? (waitState.error ? `${waitState.message} (${waitState.error})` : waitState.message) : ""}
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <a href="/app">Open the app</a>
          <span className="muted">/</span>
          <a href="/admin">Admin</a>
          <span className="muted">/</span>
          <a href="mailto:hello@other-library.com">Contact</a>
        </div>
      </div>
    </main>
  );
}
