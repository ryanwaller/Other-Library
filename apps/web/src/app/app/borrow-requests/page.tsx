"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";
import SignInCard from "../../components/SignInCard";

function notifyBorrowRequestsChanged() {
  window.dispatchEvent(new Event("om:borrow-requests-changed"));
}

type BorrowRequest = {
  id: number;
  user_book_id: number;
  requester_id: string;
  owner_id: string;
  kind: "borrow" | "note";
  status: "pending" | "approved" | "rejected" | "cancelled";
  message: string | null;
  created_at: string;
};

type ProfileLite = { id: string; username: string; avatar_path: string | null };

type BookLite = {
  id: number;
  title_override: string | null;
  edition: { title: string | null; isbn13: string | null; isbn10: string | null } | null;
};

export default function BorrowRequestsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<BorrowRequest[]>([]);

  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite>>({});
  const [avatarUrlByUserId, setAvatarUrlByUserId] = useState<Record<string, string>>({});
  const [booksById, setBooksById] = useState<Record<number, BookLite>>({});

  const [actionStateByRequestId, setActionStateByRequestId] = useState<Record<number, { busy: boolean; error: string | null; message: string | null } | undefined>>(
    {}
  );

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function refresh() {
    if (!supabase || !userId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await supabase
        .from("borrow_requests")
        .select("id,user_book_id,requester_id,owner_id,kind,status,message,created_at")
        .eq("owner_id", userId)
        .eq("kind", "borrow")
        .order("created_at", { ascending: false })
        .limit(200);
      if (res.error) throw new Error(res.error.message);
      const nextRows = ((res.data as any) ?? []) as BorrowRequest[];
      setRows(nextRows);

      const requesterIds = Array.from(new Set(nextRows.map((r) => r.requester_id).filter(Boolean)));
      const bookIds = Array.from(new Set(nextRows.map((r) => r.user_book_id).filter((n) => Number.isFinite(n))));

      if (requesterIds.length > 0) {
        const pr = await supabase.from("profiles").select("id,username,avatar_path").in("id", requesterIds);
        if (!pr.error) {
          const map: Record<string, ProfileLite> = {};
          for (const p of (pr.data as any[]) ?? []) {
            if (!p?.id || !p?.username) continue;
            map[p.id as string] = { id: p.id as string, username: p.username as string, avatar_path: (p as any).avatar_path ?? null };
          }
          setProfilesById(map);

          const urls: Record<string, string> = {};
          for (const p of Object.values(map)) {
            if (!p.avatar_path) continue;
            const signed = await supabase.storage.from("avatars").createSignedUrl(p.avatar_path, 60 * 30);
            if (signed.data?.signedUrl) urls[p.id] = signed.data.signedUrl;
          }
          setAvatarUrlByUserId(urls);
        }
      } else {
        setProfilesById({});
        setAvatarUrlByUserId({});
      }

      if (bookIds.length > 0) {
        const br = await supabase.from("user_books").select("id,title_override,edition:editions(title,isbn13,isbn10)").in("id", bookIds);
        if (!br.error) {
          const map: Record<number, BookLite> = {};
          for (const b of (br.data as any[]) ?? []) {
            if (!b?.id) continue;
            map[b.id as number] = {
              id: b.id as number,
              title_override: (b as any).title_override ?? null,
              edition: (b as any).edition ?? null
            };
          }
          setBooksById(map);
        }
      } else {
        setBooksById({});
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load requests");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function setStatus(requestId: number, status: "approved" | "rejected") {
    if (!supabase || !userId) return;
    setActionStateByRequestId((prev) => ({ ...prev, [requestId]: { busy: true, error: null, message: "Saving…" } }));
    const res = await supabase.from("borrow_requests").update({ status }).eq("id", requestId);
    if (res.error) {
      setActionStateByRequestId((prev) => ({ ...prev, [requestId]: { busy: false, error: res.error?.message ?? "Failed", message: "Failed" } }));
      return;
    }
    notifyBorrowRequestsChanged();
    await refresh();
    setActionStateByRequestId((prev) => ({ ...prev, [requestId]: { busy: false, error: null, message: "Saved" } }));
    window.setTimeout(() => setActionStateByRequestId((prev) => ({ ...prev, [requestId]: undefined })), 1200);
  }

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
        <SignInCard note="Sign in to manage borrow requests." />
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>Borrow requests</div>
            <div className="muted">{busy ? "Loading…" : error ? error : ""}</div>
          </div>

          <div className="muted" style={{ marginTop: 8 }}>
            Incoming borrow requests. Open a request to view and reply in chat.
          </div>

          <div style={{ marginTop: 12 }}>
            {rows.length === 0 ? (
              <div className="muted">No requests yet.</div>
            ) : (
              rows.map((r) => {
                const requester = profilesById[r.requester_id];
                const avatarUrl = avatarUrlByUserId[r.requester_id] ?? null;
                const book = booksById[r.user_book_id];
                const title = (book?.title_override ?? "").trim() || book?.edition?.title || "(untitled)";
                const reqState = actionStateByRequestId[r.id] ?? { busy: false, error: null, message: null };
                return (
                  <div key={r.id} className="card" style={{ marginTop: 10 }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <div className="row" style={{ gap: 8 }}>
                        {avatarUrl ? (
                          <a href={avatarUrl} target="_blank" rel="noreferrer" aria-label="Open avatar">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt=""
                              src={avatarUrl}
                              style={{ width: 18, height: 18, borderRadius: 999, objectFit: "cover", border: "1px solid var(--border)" }}
                            />
                          </a>
                        ) : (
                          <div style={{ width: 18, height: 18, borderRadius: 999, border: "1px solid var(--border)" }} />
                        )}
                        <div>
                          <span className="muted">from </span>
                          {requester?.username ? <Link href={`/u/${requester.username}`}>{requester.username}</Link> : <span className="muted">{r.requester_id}</span>}
                        </div>
                      </div>
                    <div className="muted">borrow request • {r.status}</div>
                  </div>

                    <div style={{ marginTop: 8 }}>
                      <span className="muted">Book: </span>
                      {book ? <Link href={`/app/books/${book.id}`}>{title}</Link> : <span>{title}</span>}
                    </div>

                    {r.message ? (
                      <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                        {r.message}
                      </div>
                    ) : null}

                    <div className="row" style={{ marginTop: 10 }}>
                      <Link href={`/app/messages/${r.id}`} className="muted">
                        Open chat
                      </Link>
                      {r.status === "pending" ? (
                        <>
                          <button onClick={() => setStatus(r.id, "approved")} disabled={reqState.busy}>
                            Approve
                          </button>
                          <button onClick={() => setStatus(r.id, "rejected")} disabled={reqState.busy}>
                            Reject
                          </button>
                        </>
                      ) : null}
                      <span className="muted">
                        {reqState.message ? (reqState.error ? `${reqState.message} (${reqState.error})` : reqState.message) : ""}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </main>
  );
}
