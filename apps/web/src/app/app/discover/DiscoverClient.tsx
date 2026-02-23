"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";
import SignInCard from "../../components/SignInCard";

type ResultRow = {
  user_book_id: number;
  owner_id: string;
  owner_username: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  publisher: string | null;
  relationship: "you" | "following" | "2nd_degree" | "public";
};

export default function DiscoverClient() {
  const sp = useSearchParams();
  const initialQ = (sp.get("q") ?? "").trim();

  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [q, setQ] = useState(initialQ);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function runSearch(nextQ?: string) {
    if (!supabase || !userId) return;
    const query = (nextQ ?? q).trim();
    if (!query) {
      setRows([]);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await supabase.rpc("search_visible_user_books", { query_text: query, max_results: 80 });
    setBusy(false);
    if (res.error) {
      setError(res.error.message);
      setRows([]);
      return;
    }
    setRows(((res.data as any) ?? []) as ResultRow[]);
  }

  useEffect(() => {
    if (!userId) return;
    if (initialQ) runSearch(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const grouped = useMemo(() => {
    const mine: ResultRow[] = [];
    const following: ResultRow[] = [];
    const second: ResultRow[] = [];
    const pub: ResultRow[] = [];
    for (const r of rows) {
      if (r.relationship === "you") mine.push(r);
      else if (r.relationship === "following") following.push(r);
      else if (r.relationship === "2nd_degree") second.push(r);
      else pub.push(r);
    }
    return { mine, following, second, pub };
  }, [rows]);

  if (!supabase) {
    return (
      <main className="container">
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      {!session ? (
        <SignInCard note="Sign in to search your network." />
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
            <div>Discovery</div>
            <div className="muted">{busy ? "Searching…" : error ? error : ""}</div>
          </div>

          <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <input
              placeholder="Search title, author, ISBN, tag, subject, publisher…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                runSearch();
              }}
              style={{ minWidth: 360 }}
            />
            <button onClick={() => runSearch()} disabled={busy || !q.trim()}>
              Search
            </button>
          </div>

          <div className="muted" style={{ marginTop: 10 }}>
            Results show books that are visible to you (your own, people you follow, and public).
          </div>

          <div style={{ marginTop: 12 }}>
            {rows.length === 0 && q.trim() ? <div className="muted">No results.</div> : null}

            {grouped.mine.length > 0 ? (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="muted">Your catalog</div>
                {grouped.mine.map((r) => (
                  <div key={`mine-${r.user_book_id}`} style={{ marginTop: 8 }}>
                    <Link href={`/app/books/${r.user_book_id}`}>{r.title}</Link>
                    <div className="muted">
                      {r.authors?.length ? r.authors.join(", ") : ""} {r.isbn13 ? `· ${r.isbn13}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {grouped.following.length > 0 ? (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="muted">People you follow</div>
                {grouped.following.map((r) => (
                  <div key={`f-${r.owner_username}-${r.user_book_id}`} style={{ marginTop: 8 }}>
                    <Link href={`/u/${r.owner_username}/b/${r.user_book_id}`}>{r.title}</Link>
                    <div className="muted">
                      <Link href={`/u/${r.owner_username}`}>{r.owner_username}</Link>
                      {r.authors?.length ? ` · ${r.authors.join(", ")}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {grouped.second.length > 0 ? (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="muted">2nd-degree (public)</div>
                {grouped.second.map((r) => (
                  <div key={`s-${r.owner_username}-${r.user_book_id}`} style={{ marginTop: 8 }}>
                    <Link href={`/u/${r.owner_username}/b/${r.user_book_id}`}>{r.title}</Link>
                    <div className="muted">
                      <Link href={`/u/${r.owner_username}`}>{r.owner_username}</Link>
                      {r.authors?.length ? ` · ${r.authors.join(", ")}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {grouped.pub.length > 0 ? (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="muted">Public</div>
                {grouped.pub.map((r) => (
                  <div key={`p-${r.owner_username}-${r.user_book_id}`} style={{ marginTop: 8 }}>
                    <Link href={`/u/${r.owner_username}/b/${r.user_book_id}`}>{r.title}</Link>
                    <div className="muted">
                      <Link href={`/u/${r.owner_username}`}>{r.owner_username}</Link>
                      {r.authors?.length ? ` · ${r.authors.join(", ")}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
