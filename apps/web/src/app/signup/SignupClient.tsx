"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function SignupClient() {
  const params = useSearchParams();
  const tokenFromUrl = (params.get("token") ?? "").trim();

  const [token, setToken] = useState(tokenFromUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (tokenFromUrl) return;
    try {
      const t = (window.localStorage.getItem("om_invite_token") ?? "").trim();
      if (t) setToken(t);
    } catch {
      // ignore
    }
  }, [tokenFromUrl]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const invite = token.trim();
    if (!invite) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { invite_token: invite } }
      });
      if (err) throw new Error(err.message);
      setMessage("Account created. You can now sign in.");
    } catch (e: any) {
      setError(e?.message ?? "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <div className="card">
        <div style={{ marginBottom: "var(--space-8)" }}>Sign up (invite-only)</div>
        {!supabase ? (
          <div className="muted">
            Supabase is not configured. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="row">
              <div>Invite token</div>
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token" />
            </div>
            <div className="row" style={{ marginTop: "var(--space-8)" }}>
              <div>Email</div>
              <input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="row" style={{ marginTop: "var(--space-8)" }}>
              <div>Password</div>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="row" style={{ marginTop: "var(--space-md)", gap: "var(--space-10)" }}>
              <button type="submit" disabled={busy || !token.trim() || !email.trim() || !password.trim()}>
                {busy ? "Creating…" : "Create account"}
              </button>
              <Link href="/" className="muted">
                Back
              </Link>
              <Link href="/app" className="muted">
                Sign in
              </Link>
            </div>
            {message ? (
              <div className="muted" style={{ marginTop: "var(--space-8)" }}>
                {message}
              </div>
            ) : null}
            {error ? (
              <div className="muted" style={{ marginTop: "var(--space-8)" }}>
                {error}
              </div>
            ) : null}
          </form>
        )}
      </div>
    </main>
  );
}

