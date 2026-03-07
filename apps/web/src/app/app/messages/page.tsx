"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";
import SignInCard from "../../components/SignInCard";
import IdentityRow from "../../components/IdentityRow";
import usePageTitle from "../../../hooks/usePageTitle";

type BorrowRequestRow = {
  id: number;
  user_book_id: number;
  owner_id: string;
  requester_id: string;
  kind: "borrow" | "note";
  status: "pending" | "approved" | "rejected" | "cancelled";
  message: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileLite = { id: string; username: string; avatar_path: string | null };

type BookLite = {
  id: number;
  object_type: string | null;
  title_override: string | null;
  edition: { title: string | null; isbn13: string | null } | null;
};

type MsgLite = { id: number; borrow_request_id: number; sender_id: string; message: string; created_at: string };

export default function MessagesPage() {
  usePageTitle("Messages");
  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<BorrowRequestRow[]>([]);

  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite>>({});
  const [avatarUrlByUserId, setAvatarUrlByUserId] = useState<Record<string, string>>({});
  const [booksById, setBooksById] = useState<Record<number, BookLite>>({});
  const [lastMsgByRequestId, setLastMsgByRequestId] = useState<Record<number, MsgLite | null>>({});
  const [readAtByRequestId, setReadAtByRequestId] = useState<Record<number, string | null>>({});

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
        .select("id,user_book_id,owner_id,requester_id,kind,status,message,created_at,updated_at")
        .or(`owner_id.eq.${userId},requester_id.eq.${userId}`)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (res.error) throw new Error(res.error.message);
      const allRows = ((((res.data as any) ?? []) as BorrowRequestRow[]) ?? []).filter((r) => r.kind === "borrow");
      const allRequestIds = Array.from(new Set(allRows.map((r) => r.id).filter((n) => Number.isFinite(n))));
      let deletedAtByRequestId: Record<number, string> = {};
      if (allRequestIds.length > 0) {
        const delRes = await supabase
          .from("borrow_request_deleted_for")
          .select("borrow_request_id,deleted_at")
          .eq("user_id", userId)
          .in("borrow_request_id", allRequestIds);
        if (!delRes.error) {
          for (const row of (delRes.data as any[]) ?? []) {
            const id = Number((row as any).borrow_request_id);
            const deletedAt = String((row as any).deleted_at ?? "");
            if (!Number.isFinite(id) || !deletedAt) continue;
            deletedAtByRequestId[id] = deletedAt;
          }
        }
      }
      const nextRows = allRows.filter((r) => !deletedAtByRequestId[r.id]);
      setRows(nextRows);

      const userIds = Array.from(new Set(nextRows.flatMap((r) => [r.owner_id, r.requester_id]).filter(Boolean)));
      const bookIds = Array.from(new Set(nextRows.map((r) => r.user_book_id).filter((n) => Number.isFinite(n))));
      const requestIds = Array.from(new Set(nextRows.map((r) => r.id).filter((n) => Number.isFinite(n))));

      if (userIds.length > 0) {
        const pr = await supabase.from("profiles").select("id,username,avatar_path").in("id", userIds);
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
        const br = await supabase.from("user_books").select("id,object_type,title_override,edition:editions(title,isbn13)").in("id", bookIds);
        if (!br.error) {
          const map: Record<number, BookLite> = {};
          for (const b of (br.data as any[]) ?? []) {
            if (!b?.id) continue;
            map[b.id as number] = {
              id: b.id as number,
              object_type: (b as any).object_type ?? null,
              title_override: (b as any).title_override ?? null,
              edition: (b as any).edition ?? null
            };
          }
          setBooksById(map);
        }
      } else {
        setBooksById({});
      }

      if (requestIds.length > 0) {
        const rr = await supabase
          .from("borrow_request_reads")
          .select("borrow_request_id,last_read_at")
          .eq("user_id", userId)
          .in("borrow_request_id", requestIds);
        if (rr.error) {
          setReadAtByRequestId({});
        } else {
          const map: Record<number, string | null> = {};
          for (const row of (rr.data as any[]) ?? []) {
            const id = Number((row as any).borrow_request_id);
            if (!Number.isFinite(id)) continue;
            map[id] = ((row as any).last_read_at as string) ?? null;
          }
          setReadAtByRequestId(map);
        }

        const mr = await supabase
          .from("borrow_request_messages")
          .select("id,borrow_request_id,sender_id,message,created_at")
          .in("borrow_request_id", requestIds)
          .order("created_at", { ascending: false })
          .limit(500);
        if (mr.error) {
          setLastMsgByRequestId({});
        } else {
          const by: Record<number, MsgLite | null> = {};
          for (const msg of (mr.data as any[]) ?? []) {
            const brId = Number((msg as any).borrow_request_id);
            if (!Number.isFinite(brId)) continue;
            if (by[brId]) continue;
            by[brId] = msg as any;
          }
          setLastMsgByRequestId(by);
        }
      } else {
        setLastMsgByRequestId({});
        setReadAtByRequestId({});
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load messages");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const pendingIncomingCount = useMemo(() => {
    if (!userId) return 0;
    return rows.filter((r) => r.owner_id === userId && r.status === "pending").length;
  }, [rows, userId]);

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

  return (
    <main className="container">
      {!session ? (
        <SignInCard note="Sign in to view borrow request chats." />
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>Messages</div>
            <div className="row" style={{ gap: "var(--space-10)", alignItems: "center" }}>
              <button onClick={refresh} disabled={busy}>
                Refresh
              </button>
              <div className="text-muted">{busy ? "Loading…" : error ? error : ""}</div>
            </div>
          </div>
          <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
            Borrow request conversations. Pending incoming: {pendingIncomingCount}.
          </div>

          <div style={{ marginTop: "var(--space-md)" }}>
            {rows.length === 0 ? (
              <div className="text-muted">No conversations yet.</div>
            ) : (
              rows.map((r) => {
                const isOwner = r.owner_id === userId;
                const otherId = isOwner ? r.requester_id : r.owner_id;
                const other = profilesById[otherId];
                const avatarUrl = avatarUrlByUserId[otherId] ?? null;
                const book = booksById[r.user_book_id];
                const title = (book?.title_override ?? "").trim() || book?.edition?.title || "(untitled)";
                const ownerUsername = profilesById[r.owner_id]?.username ?? null;
                const bookHref = ownerUsername ? `/u/${ownerUsername}/b/${r.user_book_id}` : `/app/books/${r.user_book_id}`;
                const lastMsg = lastMsgByRequestId[r.id] ?? null;
                const preview = (lastMsg?.message ?? r.message ?? "").trim();
                const lastReadAt = readAtByRequestId[r.id] ?? null;
                const isUnread = !lastReadAt || (r.updated_at && r.updated_at > lastReadAt);

                return (
                  <div key={r.id} className="card" style={{ marginTop: "var(--space-10)" }}>
                    <IdentityRow
                      avatarUrl={avatarUrl}
                      displayName={null}
                      username={other?.username || otherId}
                      label={isOwner ? "request from" : "to"}
                      rightSlot={
                        <div className="text-muted" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-sm)" }}>
                          {r.status === "approved" ? <span style={{ color: "#0b6b2e" }}>✓</span> : null}
                          {r.status === "rejected" ? <span style={{ color: "#b00020" }}>×</span> : null}
                          {r.status === "pending" ? <span>…</span> : null}
                          {isUnread ? <span style={{ color: "#b00020" }}>new</span> : null}
                        </div>
                      }
                    />

                    <div style={{ marginTop: "var(--space-8)" }}>
                      <span className="text-muted">{book?.object_type || "book"}: </span>
                      <Link href={bookHref}>{title}</Link>
                    </div>

                    {preview ? (
                      <div className="text-muted" style={{ marginTop: "var(--space-8)", whiteSpace: "pre-wrap" }}>
                        {preview}
                      </div>
                    ) : (
                      <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
                        (no messages yet)
                      </div>
                    )}

                    <div className="row" style={{ marginTop: "var(--space-10)", justifyContent: "space-between" }}>
                      <Link href={`/app/messages/${r.id}`} className="text-muted">
                        Open chat
                      </Link>
                      {isOwner && r.status === "pending" ? <Link href="/app/borrow-requests">Manage</Link> : null}
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
