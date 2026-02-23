"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import SignInCard from "../../components/SignInCard";

type BorrowScope = "anyone" | "approved_followers";

export default function BorrowRequestWidget({
  userBookId,
  ownerId,
  ownerUsername,
  bookTitle,
  borrowable,
  scope
}: {
  userBookId: number;
  ownerId: string;
  ownerUsername: string;
  bookTitle: string;
  borrowable: boolean;
  scope: BorrowScope;
}) {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [followApproved, setFollowApproved] = useState<boolean>(false);
  const [loadingFollow, setLoadingFollow] = useState<boolean>(false);
  const [composerOpen, setComposerOpen] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [threadDraft, setThreadDraft] = useState<string>("");
  const [state, setState] = useState<{ busy: boolean; error: string | null; message: string | null }>({ busy: false, error: null, message: null });
  const [existing, setExisting] = useState<{ id: number; kind: "borrow" | "note"; status: string; message: string | null; created_at: string } | null>(null);
  const [thread, setThread] = useState<Array<{ id: number; sender_id: string; message: string; created_at: string }>>([]);
  const [threadLoading, setThreadLoading] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSessionUserId(newSession?.user?.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const isOwner = useMemo(() => Boolean(sessionUserId && sessionUserId === ownerId), [sessionUserId, ownerId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !sessionUserId) {
        setExisting(null);
        return;
      }
      const res = await supabase
        .from("borrow_requests")
        .select("id,kind,status,message,created_at")
        .eq("user_book_id", userBookId)
        .eq("requester_id", sessionUserId)
        .eq("kind", "borrow")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      if (res.error) {
        setExisting(null);
        return;
      }
      setExisting((res.data as any) ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [sessionUserId, userBookId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !sessionUserId || !existing?.id) {
        setThread([]);
        return;
      }
      setThreadLoading(true);
      const res = await supabase
        .from("borrow_request_messages")
        .select("id,sender_id,message,created_at")
        .eq("borrow_request_id", existing.id)
        .order("created_at", { ascending: true })
        .limit(200);
      if (!alive) return;
      setThreadLoading(false);
      if (res.error) {
        setThread([]);
        return;
      }
      setThread(((res.data as any) ?? []) as any);
    })();
    return () => {
      alive = false;
    };
  }, [sessionUserId, existing?.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !sessionUserId) {
        setFollowApproved(false);
        return;
      }
      if (scope !== "approved_followers") {
        setFollowApproved(true);
        return;
      }
      setLoadingFollow(true);
      const res = await supabase.from("follows").select("status").eq("follower_id", sessionUserId).eq("followee_id", ownerId).maybeSingle();
      if (!alive) return;
      setLoadingFollow(false);
      if (res.error || !res.data) {
        setFollowApproved(false);
        return;
      }
      setFollowApproved((res.data as any).status === "approved");
    })();
    return () => {
      alive = false;
    };
  }, [sessionUserId, ownerId, scope]);

  const canRequest = useMemo(() => {
    if (!supabase) return false;
    if (!sessionUserId) return false;
    if (isOwner) return false;
    if (!borrowable) return false;
    if (loadingFollow) return false;
    return scope === "anyone" ? true : followApproved;
  }, [sessionUserId, isOwner, borrowable, scope, followApproved, loadingFollow]);

  async function sendThreadMessage() {
    if (!supabase || !sessionUserId || !existing?.id) return;
    const msg = threadDraft.trim();
    if (!msg) return;
    if (existing.status !== "pending" && existing.status !== "approved") return;
    setState({ busy: true, error: null, message: "Sending…" });
    const res = await supabase
      .from("borrow_request_messages")
      .insert({ borrow_request_id: existing.id, sender_id: sessionUserId, message: msg })
      .select("id,sender_id,message,created_at")
      .single();
    if (res.error) {
      setState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }
    setThreadDraft("");
    setThread((prev) => [...prev, res.data as any]);
    setState({ busy: false, error: null, message: "Sent" });
    window.dispatchEvent(new Event("om:borrow-requests-changed"));
  }

  async function requestBorrow() {
    if (!supabase || !sessionUserId) return;
    const msg = message.trim();
    if (!msg) return;
    setState({ busy: true, error: null, message: "Sending…" });
    const res = await supabase
      .from("borrow_requests")
      .insert({
        user_book_id: userBookId,
        owner_id: ownerId,
        requester_id: sessionUserId,
        kind: "borrow",
        message: msg
      })
      .select("id,kind,status,message,created_at")
      .single();
    if (res.error) {
      setState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }
    const created = res.data as any;
    setExisting(created);
    setComposerOpen(false);
    setMessage("");
    setState({ busy: false, error: null, message: "Requested" });
    window.dispatchEvent(new Event("om:borrow-requests-changed"));
  }

  async function cancelRequest() {
    if (!supabase || !sessionUserId || !existing?.id) return;
    setState({ busy: true, error: null, message: "Cancelling…" });
    const res = await supabase.from("borrow_requests").update({ status: "cancelled" }).eq("id", existing.id);
    if (res.error) {
      setState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }
    setExisting((e) => (e ? { ...e, status: "cancelled" } : e));
    setState({ busy: false, error: null, message: "Cancelled" });
    window.dispatchEvent(new Event("om:borrow-requests-changed"));
  }

  if (!supabase) return null;

  if (isOwner) {
    return <div className="muted">This is your book.</div>;
  }

  if (!sessionUserId) {
    return <SignInCard note="Sign in to request to borrow." />;
  }

  if (scope === "approved_followers" && !followApproved) {
    return (
      <div className="muted">
        Only approved followers can request to borrow.{" "}
        <Link href={`/u/${ownerUsername}`}>Request access</Link>.
      </div>
    );
  }

  if (existing?.status === "pending") {
    return (
      <div>
        <div className="muted">Borrow request: pending.</div>
        {existing.message ? (
          <div className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
            {existing.message}
          </div>
        ) : null}
        {threadLoading ? (
          <div className="muted" style={{ marginTop: 6 }}>
            Loading thread…
          </div>
        ) : thread.length > 0 ? (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {thread.map((m) => (
              <div key={m.id} className="muted" style={{ whiteSpace: "pre-wrap" }}>
                {(m.sender_id === sessionUserId ? "you" : "them")}: {m.message}
              </div>
            ))}
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          <textarea
            value={threadDraft}
            onChange={(e) => setThreadDraft(e.target.value)}
            placeholder="Message"
            rows={3}
            style={{ width: "100%" }}
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={sendThreadMessage} disabled={state.busy || !threadDraft.trim()}>
            {state.busy ? "…" : "Send message"}
          </button>
          <button onClick={cancelRequest} disabled={state.busy}>
            {state.busy ? "…" : "Cancel request"}
          </button>
          <Link href={`/app/messages/${existing.id}`} className="muted" style={{ marginLeft: 8 }}>
            Open chat
          </Link>
          <div className="muted">{state.message ? (state.error ? `${state.message} (${state.error})` : state.message) : ""}</div>
        </div>
      </div>
    );
  }

  if (!borrowable) {
    return <div className="muted">Not borrowable.</div>;
  }

  return (
    <div>
      <div className="muted">Request to borrow: {bookTitle}</div>
      {!composerOpen ? (
        <div className="row" style={{ marginTop: 8 }}>
          <button
            onClick={() => setComposerOpen(true)}
            disabled={!canRequest || state.busy}
            aria-label="Ask to borrow"
          >
            Ask to borrow
          </button>
          <div className="muted">{!canRequest ? "Not allowed." : ""}</div>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 8 }}>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Message (required)"
              rows={3}
              style={{ width: "100%" }}
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={requestBorrow} disabled={!canRequest || state.busy || !message.trim()}>
              {state.busy ? "Sending…" : "Send request"}
            </button>
            <button onClick={() => { setComposerOpen(false); setMessage(""); }} disabled={state.busy}>
              Cancel
            </button>
            <div className="muted">{state.message ? (state.error ? `${state.message} (${state.error})` : state.message) : ""}</div>
          </div>
        </>
      )}
    </div>
  );
}
