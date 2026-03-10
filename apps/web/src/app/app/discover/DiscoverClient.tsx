"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";
import SignInCard from "../../components/SignInCard";
import PagedBookList from "../components/PagedBookList";

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

function normalizeSearchText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ");
}

function significantQueryTerms(query: string): string[] {
  return normalizeSearchText(query)
    .split(" ")
    .map((value) => value.trim())
    .filter((value) => value.length >= 3);
}

function rowMatchesVisibleText(row: ResultRow, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return false;
  const haystack = normalizeSearchText([
    row.title,
    ...(row.authors ?? []),
    row.publisher ?? "",
    row.isbn13 ?? ""
  ]
    .filter(Boolean)
    .join(" "));
  if (!haystack) return false;
  return haystack.includes(q);
}

function CoverThumb({ isbn13 }: { isbn13: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = isbn13 && !failed ? `https://covers.openlibrary.org/b/isbn/${isbn13}-M.jpg` : null;
  return (
    <div style={{ width: 62, flex: "0 0 auto" }}>
      {src ? (
        <div className="om-cover-slot om-cover-slot-has-image" style={{ width: 60, height: "auto" }}>
          <img
            src={src}
            alt=""
            onError={() => setFailed(true)}
            onLoad={(e) => { if ((e.currentTarget as HTMLImageElement).naturalWidth < 10) setFailed(true); }}
            style={{ display: "block", width: "100%", height: "auto", objectFit: "contain" }}
          />
        </div>
      ) : (
        <div className="om-cover-slot" style={{ width: 60, height: "auto" }}>
          <div className="om-cover-placeholder" style={{ width: "100%", aspectRatio: "3/4" }} />
        </div>
      )}
    </div>
  );
}

function ResultItem({ row, isMine }: { row: ResultRow; isMine: boolean }) {
  const href = isMine ? `/app/books/${row.user_book_id}` : `/u/${row.owner_username}/b/${row.user_book_id}`;
  return (
    <div className="row" style={{ gap: "var(--space-md)", alignItems: "flex-start", padding: "var(--space-10) 0" }}>
      <CoverThumb isbn13={row.isbn13} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {!isMine && row.owner_username && (
          <div className="row" style={{ gap: "var(--space-8)", alignItems: "center", marginBottom: "var(--space-8)" }}>
            <div className="om-avatar-img" style={{ background: "var(--placeholder-bg, rgba(128,128,128,0.15))", flexShrink: 0 }} />
            <Link href={`/u/${row.owner_username}`} className="text-muted" style={{ textDecoration: "none" }}>{row.owner_username}</Link>
          </div>
        )}
        <div><Link href={href}>{row.title}</Link></div>
      </div>
    </div>
  );
}

function ResultSection({ label, items, isMine, searchQuery }: { label: string; items: ResultRow[]; isMine: boolean; searchQuery: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-8)" }}>
        <span>{label}</span>
        <span className="text-muted">{items.length} {items.length === 1 ? "item" : "items"}</span>
      </div>
      <hr className="divider" style={{ margin: 0 }} />
      <PagedBookList
        items={items}
        viewMode="list"
        gridCols={1}
        searchQuery={searchQuery}
        renderItem={(r) => <ResultItem key={r.user_book_id} row={r} isMine={isMine} />}
        noItemsMessage=""
      />
    </div>
  );
}

export default function DiscoverClient() {
  const sp = useSearchParams();
  const initialQ = (sp.get("q") ?? "").trim();

  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [q, setQ] = useState(initialQ);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [searched, setSearched] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

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
    const [rpcRes, sessionRes] = await Promise.all([
      supabase.rpc("search_visible_user_books", { query_text: query, max_results: 80 }),
      supabase.auth.getSession()
    ]);
    const token = sessionRes.data.session?.access_token ?? null;
    let entityRows: ResultRow[] = [];
    if (token) {
      const entityRes = await fetch(`/api/discover/entities?q=${encodeURIComponent(query)}&max=80`, {
        headers: { authorization: `Bearer ${token}` }
      });
      const entityJson = await entityRes.json().catch(() => ({}));
      if (entityRes.ok && Array.isArray((entityJson as any)?.rows)) {
        entityRows = ((entityJson as any).rows ?? []) as ResultRow[];
      }
    }
    setBusy(false);
    setSearched(true);
    if (rpcRes.error) {
      setError(rpcRes.error.message);
      setRows(entityRows);
      return;
    }
    const rpcRows = (((rpcRes.data as any) ?? []) as ResultRow[]);
    const phraseRpcRows = rpcRows.filter((row) => rowMatchesVisibleText(row, query));
    const merged = new Map<number, ResultRow>();
    if (entityRows.length > 0) {
      for (const row of phraseRpcRows) merged.set(Number(row.user_book_id), row);
      for (const row of entityRows) if (!merged.has(Number(row.user_book_id))) merged.set(Number(row.user_book_id), row);
    } else {
      const baseRows = significantQueryTerms(query).length > 1 ? phraseRpcRows : rpcRows;
      for (const row of baseRows) merged.set(Number(row.user_book_id), row);
    }
    setRows(Array.from(merged.values()));
  }

  useEffect(() => {
    if (!userId) {
      if (session) setInitialLoadDone(true);
      return;
    }
    (async () => {
      if (initialQ) {
        await runSearch(initialQ);
        setSearched(true);
      }
      setInitialLoadDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session]);

  const grouped = useMemo(() => {
    const mine: ResultRow[] = [];
    const others: ResultRow[] = [];
    for (const r of rows) {
      if (r.relationship === "you") mine.push(r);
      else others.push(r);
    }
    return { mine, others };
  }, [rows]);

  if (!supabase) {
    return (
      <main className="container">
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
        </div>
      </main>
    );
  }

  if (!initialLoadDone) return null;

  return (
    <main className="container">
      {!session ? (
        <SignInCard note="Sign in to search your network." />
      ) : (
        <div className="card">
          <div className="row" style={{ alignItems: "baseline", gap: "var(--space-md)" }}>
            <input
              ref={inputRef}
              className="om-inline-search-input"
              placeholder="Search books…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                runSearch();
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button onClick={() => runSearch()} disabled={busy || !q.trim()} className="text-muted" style={{ whiteSpace: "nowrap", flex: "0 0 auto" }}>
              {busy ? "Searching…" : "Search"}
            </button>
          </div>

          {searched && (
            <div style={{ marginTop: "var(--space-xl)" }}>
              {error ? (
                <div className="text-muted">{error}</div>
              ) : rows.length === 0 ? (
                <div className="text-muted">No results.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xl)" }}>
                  <ResultSection label="Your catalog" items={grouped.mine} isMine searchQuery={q} />
                  <ResultSection label="Others' catalogs" items={grouped.others} isMine={false} searchQuery={q} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
