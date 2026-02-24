"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import SignInCard from "../../components/SignInCard";

type BorrowScope = "anyone" | "followers" | "following";

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
  const [relationshipAllowed, setRelationshipAllowed] = useState<boolean>(false);
  const [loadingRelationship, setLoadingRelationship] = useState<boolean>(false);
  const [composerOpen, setComposerOpen] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [state, setState] = useState<{ busy: boolean; error: string | null; message: string | null }>({ busy: false, error: null, message: null });
  const [existing, setExisting] = useState<{ id: number; kind: "borrow" | "note"; status: string; message: string | null; created_at: string } | null>(null);

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
      if (!supabase || !sessionUserId) {
        setRelationshipAllowed(false);
        return;
      }
      if (scope === "anyone") {
        setRelationshipAllowed(true);
        return;
      }
      setLoadingRelationship(true);
      const res =
        scope === "followers"
          ? await supabase.from("follows").select("status").eq("follower_id", sessionUserId).eq("followee_id", ownerId).maybeSingle()
          : await supabase.from("follows").select("status").eq("follower_id", ownerId).eq("followee_id", sessionUserId).maybeSingle();
      if (!alive) return;
      setLoadingRelationship(false);
      if (res.error || !res.data) {
        setRelationshipAllowed(false);
        return;
      }
      setRelationshipAllowed((res.data as any).status === "approved");
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
    if (loadingRelationship) return false;
    return scope === "anyone" ? true : relationshipAllowed;
  }, [sessionUserId, isOwner, borrowable, scope, relationshipAllowed, loadingRelationship]);

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
    try {
      await supabase.rpc("mark_borrow_request_read", { input_borrow_request_id: created.id });
    } catch {
      // ignore
    }
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

  if (scope !== "anyone" && !relationshipAllowed) {
    return (
      <div className="muted">
        {scope === "following" ? "Only people this user follows can request to borrow." : "Only approved followers can request to borrow."}{" "}
        <Link href={`/u/${ownerUsername}`}>View profile</Link>.
      </div>
    );
  }

  if (existing) {
    return (
      <div>
        <div className="muted">Borrow request: {existing.status}.</div>
        <div className="row" style={{ marginTop: 8 }}>
          {existing.status === "pending" ? (
            <button onClick={cancelRequest} disabled={state.busy}>
              {state.busy ? "…" : "Cancel request"}
            </button>
          ) : null}
          <Link href={`/app/messages/${existing.id}`} className="muted">
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
