"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

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
  const [note, setNote] = useState<string>("");
  const [state, setState] = useState<{ busy: boolean; error: string | null; message: string | null }>({ busy: false, error: null, message: null });
  const [existing, setExisting] = useState<{ id: number; status: string; created_at: string } | null>(null);

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
        .select("id,status,created_at")
        .eq("user_book_id", userBookId)
        .eq("requester_id", sessionUserId)
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

  async function requestBorrow() {
    if (!supabase || !sessionUserId) return;
    setState({ busy: true, error: null, message: "Sending…" });
    const res = await supabase
      .from("borrow_requests")
      .insert({
        user_book_id: userBookId,
        owner_id: ownerId,
        requester_id: sessionUserId,
        message: note.trim() ? note.trim() : null
      })
      .select("id,status,created_at")
      .single();
    if (res.error) {
      setState({ busy: false, error: res.error.message, message: "Failed" });
      return;
    }
    setExisting(res.data as any);
    setNote("");
    setState({ busy: false, error: null, message: "Requested" });
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
  }

  if (!supabase) return null;

  if (!borrowable) {
    return <div className="muted">Not borrowable.</div>;
  }

  if (isOwner) {
    return <div className="muted">This is your book.</div>;
  }

  if (!sessionUserId) {
    return (
      <div className="muted">
        Sign in to request to borrow this book.{" "}
        <Link href="/app" target="_blank" rel="noreferrer">
          Open app
        </Link>
        .
      </div>
    );
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
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={cancelRequest} disabled={state.busy}>
            {state.busy ? "…" : "Cancel request"}
          </button>
          <div className="muted">{state.message ? (state.error ? `${state.message} (${state.error})` : state.message) : ""}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="muted">Request to borrow: {bookTitle}</div>
      <div style={{ marginTop: 8 }}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note"
          rows={3}
          style={{ width: "100%" }}
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={requestBorrow} disabled={!canRequest || state.busy}>
          {state.busy ? "Sending…" : "Send request"}
        </button>
        <div className="muted">{state.message ? (state.error ? `${state.message} (${state.error})` : state.message) : ""}</div>
      </div>
    </div>
  );
}

