"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../../lib/supabaseClient";
import SignInCard from "../../../components/SignInCard";
import Link from "next/link";
import IdentityRow from "../../../components/IdentityRow";

function notifyBorrowRequestsChanged() {
  window.dispatchEvent(new Event("om:borrow-requests-changed"));
}

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

type Msg = { id: number; sender_id: string; message: string; created_at: string };

function parseEventMessage(raw: string): { status: "approved" | "rejected" | "cancelled" } | null {
  const msg = (raw ?? "").trim();
  if (msg.startsWith("__event__:")) {
    const status = msg.slice("__event__:".length).trim().toLowerCase();
    if (status === "approved" || status === "rejected" || status === "cancelled") return { status: status as any };
    return null;
  }
  if (!msg.startsWith("__system__:")) return null;
  const rest = msg.slice("__system__:".length);
  const [statusRaw] = rest.split("|");
  const status = (statusRaw ?? "").trim().toLowerCase();
  if (status === "approved" || status === "rejected") return { status: status as any };
  return null;
}

export default function MessageThreadPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const requestId = Number(params?.id);
  const rawBack = searchParams.get("back");
  const backHref = rawBack && rawBack.startsWith("/") ? rawBack : "/app/borrow-requests";

  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [req, setReq] = useState<BorrowRequestRow | null>(null);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite>>({});
  const [avatarUrlByUserId, setAvatarUrlByUserId] = useState<Record<string, string>>({});
  const [book, setBook] = useState<BookLite | null>(null);

  const [thread, setThread] = useState<Msg[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [deletedAtForMe, setDeletedAtForMe] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sendState, setSendState] = useState<{ busy: boolean; error: string | null; message: string | null }>({ busy: false, error: null, message: null });
  const [statusState, setStatusState] = useState<{ busy: boolean; error: string | null; message: string | null }>({ busy: false, error: null, message: null });
  const [markedReadForId, setMarkedReadForId] = useState<number | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [deleteState, setDeleteState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [deletedLocally, setDeletedLocally] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  const isOwner = useMemo(() => Boolean(userId && req?.owner_id && userId === req.owner_id), [userId, req?.owner_id]);
  const otherUserId = useMemo(() => {
    if (!req || !userId) return null;
    return userId === req.owner_id ? req.requester_id : req.owner_id;
  }, [req, userId]);

  async function refresh() {
    if (!supabase || !userId) return;
    if (!Number.isFinite(requestId)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await supabase
        .from("borrow_requests")
        .select("id,user_book_id,owner_id,requester_id,kind,status,message,created_at,updated_at")
        .eq("id", requestId)
        .maybeSingle();
      if (res.error) throw new Error(res.error.message);
      const next = (res.data as any) as BorrowRequestRow | null;
      if (!next) {
        setReq(null);
        setThread([]);
        setDeletedAtForMe(null);
        setBook(null);
        setProfilesById({});
        setAvatarUrlByUserId({});
        return;
      }
      if (next.kind !== "borrow") {
        setReq(null);
        setThread([]);
        setDeletedAtForMe(null);
        setBook(null);
        setProfilesById({});
        setAvatarUrlByUserId({});
        setError("This thread is not a borrow request.");
        return;
      }
      setReq(next);

      const deletedRes = await supabase
        .from("borrow_request_deleted_for")
        .select("deleted_at")
        .eq("borrow_request_id", requestId)
        .eq("user_id", userId)
        .maybeSingle();
      const deletedAt = deletedRes.error ? null : ((deletedRes.data as any)?.deleted_at ? String((deletedRes.data as any).deleted_at) : null);
      setDeletedAtForMe(deletedAt);

      // Mark read (so the red badge clears immediately).
      if (markedReadForId !== next.id) {
        try {
          await supabase.rpc("mark_borrow_request_read", { input_borrow_request_id: next.id });
          setMarkedReadForId(next.id);
          window.dispatchEvent(new Event("om:borrow-requests-changed"));
        } catch {
          // ignore
        }
      }

      const ids = Array.from(new Set([next.owner_id, next.requester_id].filter(Boolean)));
      if (ids.length > 0) {
        const pr = await supabase.from("profiles").select("id,username,avatar_path").in("id", ids);
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
      }

      const br = await supabase.from("user_books").select("id,object_type,title_override,edition:editions(title,isbn13)").eq("id", next.user_book_id).maybeSingle();
      if (!br.error && br.data) setBook(br.data as any);

      setThreadLoading(true);
      const mr = await supabase
        .from("borrow_request_messages")
        .select("id,sender_id,message,created_at")
        .eq("borrow_request_id", requestId)
        .gt("created_at", deletedAt || "1970-01-01T00:00:00Z")
        .order("created_at", { ascending: true })
        .limit(500);
      setThreadLoading(false);
      if (mr.error) {
        setThread([]);
      } else {
        setThread(((mr.data as any) ?? []) as any);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load thread");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      await refresh();
      setInitialLoadDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, requestId]);

  useEffect(() => {
    if (!userId || !Number.isFinite(requestId)) return;
    const t = window.setInterval(() => refresh(), 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, requestId]);

  async function send() {
    if (!supabase || !userId || !req) return;
    const msg = draft.trim();
    if (!msg) return;
    if (req.status !== "pending" && req.status !== "approved" && req.status !== "rejected") return;
    setSendState({ busy: true, error: null, message: "Sending…" });
    const res = await supabase
      .from("borrow_request_messages")
      .insert({ borrow_request_id: req.id, sender_id: userId, message: msg })
      .select("id,sender_id,message,created_at")
      .single();
    if (res.error) {
      setSendState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }
    try {
      await supabase.rpc("mark_borrow_request_read", { input_borrow_request_id: req.id });
    } catch {
      // ignore
    }
    setDraft("");
    setThread((prev) => [...prev, res.data as any]);
    setSendState({ busy: false, error: null, message: "Sent" });
    notifyBorrowRequestsChanged();
    window.setTimeout(() => setSendState({ busy: false, error: null, message: null }), 900);
  }

  async function setStatus(nextStatus: "approved" | "rejected" | "cancelled") {
    if (!supabase || !userId || !req) return;
    setStatusState({ busy: true, error: null, message: "Saving…" });
    const res = await supabase.from("borrow_requests").update({ status: nextStatus }).eq("id", req.id);
    if (res.error) {
      setStatusState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }

    if (nextStatus === "approved" || nextStatus === "rejected" || nextStatus === "cancelled") {
      const systemMsg = `__event__:${nextStatus}`;
      try {
        await supabase.from("borrow_request_messages").insert({ borrow_request_id: req.id, sender_id: userId, message: systemMsg });
      } catch {
        // best-effort
      }
    }

    try {
      await supabase.rpc("mark_borrow_request_read", { input_borrow_request_id: req.id });
    } catch {
      // ignore
    }
    notifyBorrowRequestsChanged();
    await refresh();
    setStatusState({ busy: false, error: null, message: "Saved" });
    window.setTimeout(() => setStatusState({ busy: false, error: null, message: null }), 900);
  }

  async function deleteConversationForMe() {
    if (!supabase || !req) return;
    setDeleteState({ busy: true, error: null });
    setDeletedLocally(true);
    const res = await supabase.rpc("delete_borrow_conversation", { input_borrow_request_id: req.id });
    if (res.error) {
      setDeletedLocally(false);
      setDeleteState({ busy: false, error: res.error.message });
      return;
    }
    notifyBorrowRequestsChanged();
    router.push(backHref);
    router.refresh();
  }

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

  if (!session) {
    return (
      <main className="container">
        <SignInCard note="Sign in to view this conversation." />
      </main>
    );
  }

  if (!initialLoadDone) return null;

  const other = otherUserId ? profilesById[otherUserId] : null;
  const otherAvatarUrl = otherUserId ? avatarUrlByUserId[otherUserId] ?? null : null;
  const title = ((book?.title_override ?? "").trim() || book?.edition?.title || "(untitled)") as string;
  const ownerName = profilesById[req?.owner_id ?? ""]?.username ?? "someone";
  const requesterName = profilesById[req?.requester_id ?? ""]?.username ?? "someone";

  function statusLabel(status: BorrowRequestRow["status"]): string {
    if (status === "approved") return "Approved";
    if (status === "rejected") return "Declined";
    if (status === "cancelled") return "Cancelled";
    return "Pending";
  }

  function formatEventLine(status: "approved" | "rejected" | "cancelled"): string {
    const qTitle = `‘${title}’`;
    if (status === "approved") return `${ownerName} approved ${qTitle} for ${requesterName}.`;
    if (status === "rejected") return `${ownerName} declined ${qTitle} for ${requesterName}.`;
    return `${requesterName} cancelled their request for ${qTitle}.`;
  }

  return (
    <main className="container">
      <div className="text-muted" style={{ marginBottom: "var(--space-md)" }}>
        <Link href={backHref}>Back</Link>
      </div>

      {req && (
        <div className="card">
          <IdentityRow
            avatarUrl={otherAvatarUrl}
            displayName={null}
            username={other?.username || otherUserId || ""}
            label={isOwner ? "request from" : "request to"}
            rightSlot={
              <div className="text-muted" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-sm)" }}>
                {req.status === "approved" ? <span style={{ color: "#0b6b2e" }}>✓</span> : null}
                {req.status === "rejected" ? <span style={{ color: "#b00020" }}>×</span> : null}
                {req.status === "pending" ? <span>…</span> : null}
              </div>
            }
          />

          <div style={{ marginTop: "var(--space-8)" }}>
            <span className="text-muted">{book?.object_type || "book"}: </span>
            <Link href={`/app/books/${req.user_book_id}`}>{title}</Link>
          </div>
        </div>
      )}

      <div className="om-thread" style={{ marginTop: "var(--space-14)" }}>
        {req?.message && !deletedAtForMe ? (
          <div className="om-thread-msg">
            <div className="text-muted">{requesterName}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{req.message}</div>
          </div>
        ) : null}

        {thread.length === 0 ? null : (
          <div style={{ marginTop: req?.message && !deletedAtForMe ? 10 : 0, display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
            {thread.map((m) => {
              const raw = String(m.message ?? "").trim();
              const isDeleteNotice = /deleted this conversation\.\s*also delete\?/i.test(raw);
              if (isDeleteNotice) {
                return (
                  <div key={m.id} className="om-thread-msg">
                    <div>{raw}</div>
                    {m.sender_id !== userId ? (
                      <div style={{ marginTop: "var(--space-sm)" }}>
                        <a
                          href="/app/settings?tab=loans"
                          className="text-muted"
                          style={{ textDecoration: "underline" }}
                          onClick={(e) => {
                            e.preventDefault();
                            void deleteConversationForMe();
                          }}
                        >
                          {deleteState.busy ? "Deleting…" : "Delete"}
                        </a>
                      </div>
                    ) : null}
                  </div>
                );
              }
              const ev = parseEventMessage(m.message);
              if (ev) {
                const evClass =
                  ev.status === "approved"
                    ? "om-event-line om-event-line--approved"
                    : ev.status === "rejected"
                      ? "om-event-line om-event-line--rejected"
                      : "om-event-line";
                return (
                  <div key={m.id} className={evClass}>
                    {formatEventLine(ev.status)}
                  </div>
                );
              }
              const senderName = profilesById[m.sender_id]?.username ?? "someone";
              return (
                <div key={m.id} className="om-thread-msg">
                  <div className="text-muted">{senderName}</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.message}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!deletedAtForMe && !deletedLocally ? (
      <div style={{ marginTop: "var(--space-14)" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message"
          rows={4}
          style={{ width: "100%" }}
        />

        <div className="row" style={{ marginTop: "var(--space-10)", justifyContent: "space-between", gap: "var(--space-10)", flexWrap: "wrap" }}>
          <div className="row" style={{ gap: "var(--space-10)", flexWrap: "wrap" }}>
            <button
              onClick={send}
              disabled={sendState.busy || !draft.trim() || !req || (req.status !== "pending" && req.status !== "approved" && req.status !== "rejected")}
            >
              {sendState.busy ? "Sending…" : "Send"}
            </button>
            <span className="text-muted">{sendState.message ? (sendState.error ? `${sendState.message} (${sendState.error})` : sendState.message) : ""}</span>
          </div>

          <div className="row" style={{ gap: "var(--space-10)", flexWrap: "wrap" }}>
            {req?.status === "pending" && isOwner ? (
              <>
                <button onClick={() => setStatus("approved")} disabled={statusState.busy}>
                  Approve
                </button>
                <button onClick={() => setStatus("rejected")} disabled={statusState.busy}>
                  Decline
                </button>
              </>
            ) : null}
            {req?.status === "pending" && !isOwner ? (
              <button onClick={() => setStatus("cancelled")} disabled={statusState.busy}>
                Cancel request
              </button>
            ) : null}
            <span className="text-muted">{statusState.message ? (statusState.error ? `${statusState.message} (${statusState.error})` : statusState.message) : ""}</span>
            <span className="text-muted">{deleteState.error ? `Delete failed (${deleteState.error})` : ""}</span>
          </div>
        </div>
      </div>
      ) : null}
    </main>
  );
}
