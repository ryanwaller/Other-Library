"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SignInCard from "./components/SignInCard";
import { supabase } from "../lib/supabaseClient";

export default function HomeClient() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenFromUrl = (params.get("token") ?? "").trim();

  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [inviteToken, setInviteToken] = useState(tokenFromUrl);
  const [waitEmail, setWaitEmail] = useState("");
  const [waitNote, setWaitNote] = useState("");
  const [waitState, setWaitState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  useEffect(() => {
    if (!supabase) {
      setSessionLoaded(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/app");
      } else {
        setSessionLoaded(true);
      }
    });
  }, [router]);

  if (!sessionLoaded) {
    return (
      <main className="container" aria-hidden="true">
        <div className="card">
          <div style={{ marginBottom: "var(--space-8)" }}>Other Library</div>
          <div className="text-muted" style={{ marginBottom: "var(--space-md)" }}>
            Loading…
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="card">
        <div style={{ marginBottom: "var(--space-8)" }}>Other Library</div>
        <div className="text-muted" style={{ marginBottom: "var(--space-md)" }}>
          Private beta.
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 320px" }}>
            <SignInCard note="Existing users: sign in." redirectTo="/app" />
          </div>

          <div style={{ flex: "1 1 320px" }} className="card">
            <div style={{ marginBottom: "var(--space-8)" }}>I have an invite</div>
            <div className="row" style={{ marginTop: "var(--space-8)", alignItems: "baseline" }}>
              <input value={inviteToken} onChange={(e) => setInviteToken(e.target.value)} placeholder="Invite token" style={{ flex: 1 }} />
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
            <div style={{ marginBottom: "var(--space-8)" }}>Request access</div>
            <div className="row" style={{ marginTop: "var(--space-8)", alignItems: "baseline" }}>
              <input value={waitEmail} onChange={(e) => setWaitEmail(e.target.value)} placeholder="Email" style={{ flex: 1 }} />
            </div>
            <div className="row" style={{ marginTop: "var(--space-8)", alignItems: "baseline" }}>
              <input value={waitNote} onChange={(e) => setWaitNote(e.target.value)} placeholder="Note (optional)" style={{ flex: 1 }} />
              <button
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
            <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
              {waitState.message ? (waitState.error ? `${waitState.message} (${waitState.error})` : waitState.message) : ""}
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: "var(--space-md)" }}>
          <a href="/app">Open the app</a>
          <span className="text-muted">/</span>
          <a href="/admin">Admin</a>
          <span className="text-muted">/</span>
          <a href="mailto:hello@other-library.com">Contact</a>
        </div>
      </div>
    </main>
  );
}
