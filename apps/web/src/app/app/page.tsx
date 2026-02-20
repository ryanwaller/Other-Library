"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabaseClient";

function SignIn() {
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
    if (err) setError(err.message);
  }

  return (
    <div className="card">
      <div className="row">
        <div>Email</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div>Password</div>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={signIn} disabled={busy || !email || !password}>
          Sign in
        </button>
        <button onClick={signUp} disabled={busy || !email || !password}>
          Sign up
        </button>
        {error ? <span className="muted">{error}</span> : null}
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        Followers-only by default; public is optional later.
      </div>
    </div>
  );
}

function AppShell({ session }: { session: Session }) {
  const userId = session.user.id;
  const [profile, setProfile] = useState<{ username: string; visibility: string } | null>(null);
  const [userBooksCount, setUserBooksCount] = useState<number | null>(null);

  const header = useMemo(() => {
    return (
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>Other Library</div>
        <div className="row">
          <span className="muted">{profile ? `@${profile.username}` : userId}</span>
          <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }, [profile, userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) return;
      const { data: profileData } = await supabase
        .from("profiles")
        .select("username,visibility")
        .eq("id", userId)
        .maybeSingle();
      if (!alive) return;
      if (profileData) setProfile(profileData);

      const { count } = await supabase.from("user_books").select("id", { count: "exact", head: true });
      if (!alive) return;
      setUserBooksCount(count ?? 0);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <div className="card">
      {header}
      <div style={{ marginTop: 12 }} className="muted">
        Status: signed in. Profile visibility: {profile?.visibility ?? "…"}.
      </div>
      <div style={{ marginTop: 8 }}>
        Catalog items: {userBooksCount ?? "…"} (placeholder UI; next step is add-by-ISBN + list).
      </div>
    </div>
  );
}

export default function AppPage() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <main className="container">
      <div style={{ marginBottom: 12 }} className="muted">
        App (followers-only by default). Marketing and crawlable public pages live on the main domain.
      </div>
      {!supabase ? (
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
        </div>
      ) : session ? (
        <AppShell session={session} />
      ) : (
        <SignIn />
      )}
    </main>
  );
}
