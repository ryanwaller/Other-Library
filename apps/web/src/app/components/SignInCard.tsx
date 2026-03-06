"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function SignInCard({
  note,
  showSignUp,
  redirectTo
}: {
  note?: string;
  showSignUp?: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const canUseDevBypass = process.env.NODE_ENV === "development";

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="card" />;
  }

  async function signUp() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  }

  async function signIn() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push(redirectTo ?? "/app");
    router.refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await signIn();
  }

  async function devBypassSignIn() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/bypass-login", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as any)?.error ?? "dev_login_failed"));
      const nextEmail = String((json as any)?.email ?? "");
      const nextPassword = String((json as any)?.password ?? "");
      if (!nextEmail || !nextPassword) throw new Error("dev_login_credentials_missing");
      setEmail(nextEmail);
      setPassword(nextPassword);
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: nextEmail, password: nextPassword });
      if (signInErr) throw signInErr;
      router.push(redirectTo ?? "/app");
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Dev login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <form onSubmit={onSubmit}>
        <div className="row">
          <div>Email</div>
          <input
            name="email"
            autoComplete="email"
            data-lpignore="true"
            data-1p-ignore="true"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="row" style={{ marginTop: "var(--space-8)" }}>
          <div>Password</div>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            data-lpignore="true"
            data-1p-ignore="true"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="row" style={{ marginTop: "var(--space-md)" }}>
          <button type="submit" disabled={busy || !email || !password}>
            Sign in
          </button>
          {showSignUp ? (
            <button type="button" onClick={signUp} disabled={busy || !email || !password}>
              Sign up
            </button>
          ) : null}
          {canUseDevBypass ? (
            <button type="button" onClick={devBypassSignIn} disabled={busy}>
              Dev login
            </button>
          ) : null}
          {error ? <span className="text-muted">{error}</span> : null}
        </div>
        {note ? (
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            {note}
          </div>
        ) : null}
      </form>
    </div>
  );
}
