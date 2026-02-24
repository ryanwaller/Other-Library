"use client";

import { useState, type FormEvent } from "react";
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

  return (
    <div className="card">
      <form onSubmit={onSubmit}>
        <div className="row">
          <div>Email</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div>Password</div>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy || !email || !password}>
            Sign in
          </button>
          {showSignUp ? (
            <button type="button" onClick={signUp} disabled={busy || !email || !password}>
              Sign up
            </button>
          ) : null}
          {error ? <span className="muted">{error}</span> : null}
        </div>
        {note ? (
          <div className="muted" style={{ marginTop: 8 }}>
            {note}
          </div>
        ) : null}
      </form>
    </div>
  );
}
