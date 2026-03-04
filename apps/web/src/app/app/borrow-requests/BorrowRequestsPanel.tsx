"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";
import SignInCard from "../../components/SignInCard";

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

function statusLabel(status: BorrowRequest["status"]): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Declined";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

function oneLinePreview(input: string | null, maxLen = 140): string {
  const s = String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

export default function BorrowRequestsPanel({ embedded = false }: { embedded?: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomingRows, setIncomingRows] = useState<BorrowRequest[]>([]);
  const [outgoingRows, setOutgoingRows] = useState<BorrowRequest[]>([]);

  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite>>({});
  const [avatarUrlByUserId, setAvatarUrlByUserId] = useState<Record<string, string>>({});
  const [booksById, setBooksById] = useState<Record<number, BookLite>>({});

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
      const [incomingRes, outgoingRes] = await Promise.all([
        supabase
          .from("borrow_requests")
          .select("id,user_book_id,requester_id,owner_id,kind,status,message,created_at")
          .eq("owner_id", userId)
          .eq("kind", "borrow")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("borrow_requests")
          .select("id,user_book_id,requester_id,owner_id,kind,status,message,created_at")
          .eq("requester_id", userId)
          .eq("kind", "borrow")
          .order("created_at", { ascending: false })
          .limit(200)
      ]);
      if (incomingRes.error) throw new Error(incomingRes.error.message);
      if (outgoingRes.error) throw new Error(outgoingRes.error.message);
      const nextIncomingRows = ((incomingRes.data as any) ?? []) as BorrowRequest[];
      const nextOutgoingRows = ((outgoingRes.data as any) ?? []) as BorrowRequest[];
      setIncomingRows(nextIncomingRows);
      setOutgoingRows(nextOutgoingRows);

      const counterpartyIds = Array.from(
        new Set([
          ...nextIncomingRows.map((r) => r.requester_id),
          ...nextOutgoingRows.map((r) => r.owner_id)
        ].filter(Boolean))
      );
      const profileIds = Array.from(new Set([...counterpartyIds, userId].filter(Boolean)));
      const bookIds = Array.from(
        new Set([...nextIncomingRows, ...nextOutgoingRows].map((r) => r.user_book_id).filter((n) => Number.isFinite(n)))
      );

      if (profileIds.length > 0) {
        const pr = await supabase.from("profiles").select("id,username,avatar_path").in("id", profileIds);
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

  if (!supabase) {
    if (embedded) {
      return (
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
        </div>
      );
    }
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

  const content = !session ? (
    <SignInCard note="Sign in to manage borrow requests." />
  ) : (
    <>
          <div
            className="row"
            style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: embedded ? "var(--space-xl)" : undefined }}
          >
            <div>Requests from other readers</div>
            <div className="text-muted">{busy ? "Loading…" : error ? error : ""}</div>
          </div>

          <div style={{ marginTop: "var(--space-md)" }} className="om-list">
            {incomingRows.length === 0 ? (
              <div className="text-muted">No requests yet.</div>
            ) : (
              incomingRows.map((r, idx) => {
                const requester = profilesById[r.requester_id];
                const avatarUrl = avatarUrlByUserId[r.requester_id] ?? null;
                const book = booksById[r.user_book_id];
                const title = (book?.title_override ?? "").trim() || book?.edition?.title || "(untitled)";
                const preview = oneLinePreview(r.message);
                return (
                  <div key={r.id} className="om-list-row" style={idx === incomingRows.length - 1 ? { borderBottom: "none" } : undefined}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
                      <div className="om-avatar-lockup" style={{ minWidth: 0, flex: 1 }}>
                        <Link href={`/u/${requester?.username || r.requester_id}`} className="om-avatar-link">
                          {avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt="" src={avatarUrl} className="om-avatar-img" />
                          ) : (
                            <div className="om-avatar-img" style={{ background: "var(--bg-muted)" }} />
                          )}
                        </Link>
                        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <Link href={`/u/${requester?.username || r.requester_id}`}>{requester?.username || r.requester_id}</Link>
                          {" wants "}
                          {book ? <Link href={`/app/books/${book.id}`}>{title}</Link> : <span>{title}</span>}
                        </div>
                      </div>
                      <div className="text-muted" style={{ whiteSpace: "nowrap", alignSelf: "flex-start" }}>{statusLabel(r.status)}</div>
                    </div>

                    {preview ? (
                      <div className="text-muted" style={{ marginTop: "var(--space-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {preview}
                      </div>
                    ) : null}

                    <div style={{ marginTop: "var(--space-8)" }}>
                      <Link href={embedded ? `/app/messages/${r.id}?back=${encodeURIComponent("/app/settings?tab=borrows")}` : `/app/messages/${r.id}`}>
                        View conversation
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: "var(--space-xl)" }}>
            <div>Requests you made</div>
            <div className="text-muted">{outgoingRows.length}</div>
          </div>
          <div style={{ marginTop: "var(--space-md)" }} className="om-list">
            {outgoingRows.length === 0 ? (
              <div className="text-muted">None.</div>
            ) : (
              outgoingRows.map((r, idx) => {
                const owner = profilesById[r.owner_id];
                const me = userId ? profilesById[userId] : null;
                const avatarUrl = (userId ? avatarUrlByUserId[userId] : null) ?? null;
                const book = booksById[r.user_book_id];
                const title = (book?.title_override ?? "").trim() || book?.edition?.title || "(untitled)";
                const preview = oneLinePreview(r.message);
                return (
                  <div key={r.id} className="om-list-row" style={idx === outgoingRows.length - 1 ? { borderBottom: "none" } : undefined}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
                      <div className="om-avatar-lockup" style={{ minWidth: 0, flex: 1 }}>
                        <Link href={me?.username ? `/u/${me.username}` : "/app/settings?tab=profile"} className="om-avatar-link">
                          {avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt="" src={avatarUrl} className="om-avatar-img" />
                          ) : (
                            <div className="om-avatar-img" style={{ background: "var(--bg-muted)" }} />
                          )}
                        </Link>
                        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          You asked <Link href={`/u/${owner?.username || r.owner_id}`}>{owner?.username || r.owner_id}</Link> for{" "}
                          {book ? <Link href={`/app/books/${book.id}`}>{title}</Link> : <span>{title}</span>}
                        </div>
                      </div>
                      <div className="text-muted" style={{ whiteSpace: "nowrap", alignSelf: "flex-start" }}>{statusLabel(r.status)}</div>
                    </div>

                    {preview ? (
                      <div className="text-muted" style={{ marginTop: "var(--space-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {preview}
                      </div>
                    ) : null}

                    <div style={{ marginTop: "var(--space-8)" }}>
                      <Link href={embedded ? `/app/messages/${r.id}?back=${encodeURIComponent("/app/settings?tab=borrows")}` : `/app/messages/${r.id}`}>
                        View conversation
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      );
  if (embedded) return content;
  return <main className="container">{content}</main>;
}
