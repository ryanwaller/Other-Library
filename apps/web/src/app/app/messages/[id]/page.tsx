"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../../lib/supabaseClient";
import SignInCard from "../../../components/SignInCard";

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

function parseSystemMessage(raw: string): { status: "approved" | "rejected"; text: string } | null {
  const msg = (raw ?? "").trim();
  if (!msg.startsWith("__system__:")) return null;
  const rest = msg.slice("__system__:".length);
  const [statusRaw, ...textParts] = rest.split("|");
  const status = (statusRaw ?? "").trim().toLowerCase();
  const text = textParts.join("|").trim();
  if ((status !== "approved" && status !== "rejected") || !text) return null;
  return { status: status as any, text };
}

export default function MessageThreadPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const requestId = Number(params?.id);

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

  const [draft, setDraft] = useState("");
  const [sendState, setSendState] = useState<{ busy: boolean; error: string | null; message: string | null }>({ busy: false, error: null, message: null });
  const [statusState, setStatusState] = useState<{ busy: boolean; error: string | null; message: string | null }>({ busy: false, error: null, message: null });
  const [markedReadForId, setMarkedReadForId] = useState<number | null>(null);

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
        setBook(null);
        setProfilesById({});
        setAvatarUrlByUserId({});
        return;
      }
      if (next.kind !== "borrow") {
        setReq(null);
        setThread([]);
        setBook(null);
        setProfilesById({});
        setAvatarUrlByUserId({});
        setError("This thread is not a borrow request.");
        return;
      }
      setReq(next);

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
    refresh();
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

    if (nextStatus === "approved" || nextStatus === "rejected") {
      const ownerName = profilesById[req.owner_id]?.username ?? "user";
      const requesterName = profilesById[req.requester_id]?.username ?? "user";
      const thing = String(book?.object_type ?? "book").trim() || "book";
      const verb = nextStatus === "approved" ? "approved" : "rejected";
      const text = `${ownerName} has ${verb} ${requesterName}'s request to borrow this ${thing}.`;
      const systemMsg = `__system__:${verb}|${text}`;
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

  if (!session) {
    return (
      <main className="container">
        <SignInCard note="Sign in to view this conversation." />
      </main>
    );
  }

  const other = otherUserId ? profilesById[otherUserId] : null;
  const otherAvatarUrl = otherUserId ? avatarUrlByUserId[otherUserId] ?? null : null;
  const title = ((book?.title_override ?? "").trim() || book?.edition?.title || "(untitled)") as string;

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="muted">
          <Link href="/app/messages">Back</Link>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button onClick={refresh} disabled={busy}>
            Refresh
          </button>
          <button
            onClick={async () => {
              try {
                await supabase?.auth.signOut();
              } finally {
                router.push("/");
                router.refresh();
              }
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="row" style={{ gap: 8 }}>
            {otherAvatarUrl ? (
              <a href={otherAvatarUrl} target="_blank" rel="noreferrer" aria-label="Open avatar">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src={otherAvatarUrl} style={{ width: 18, height: 18, borderRadius: 999, objectFit: "cover", border: "1px solid var(--border)" }} />
              </a>
            ) : (
              <div style={{ width: 18, height: 18, borderRadius: 999, border: "1px solid var(--border)" }} />
            )}
            <div>
              <div>
                <span className="muted">with </span>
                {other?.username ? <Link href={`/u/${other.username}`}>{other.username}</Link> : <span className="muted">{otherUserId ?? ""}</span>}
              </div>
              <div className="muted">Book: {title}</div>
            </div>
          </div>
          <div className="muted">{busy ? "Loading…" : error ? error : req ? req.status : ""}</div>
        </div>

        {req?.message ? (
          <div className="card" style={{ marginTop: 10 }}>
            <div className="muted">Initial request</div>
            <div className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
              {req.message}
            </div>
          </div>
        ) : null}

        <div className="card" style={{ marginTop: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>Thread</div>
            <div className="muted">{threadLoading ? "Loading…" : ""}</div>
          </div>
          {thread.length === 0 ? (
            <div className="muted" style={{ marginTop: 8 }}>
              No replies yet.
            </div>
          ) : (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {thread.map((m) => {
                const sys = parseSystemMessage(m.message);
                if (sys) {
                  const color = sys.status === "approved" ? "#0b6b2e" : "#b00020";
                  return (
                    <div key={m.id} style={{ whiteSpace: "pre-wrap", color }}>
                      {sys.text}
                    </div>
                  );
                }
                return (
                  <div key={m.id} className="muted" style={{ whiteSpace: "pre-wrap" }}>
                    {(m.sender_id === userId ? "you" : "them")}: {m.message}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card" style={{ marginTop: 10 }}>
          <div className="muted">Reply</div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message"
            rows={4}
            style={{ width: "100%", marginTop: 8 }}
            onKeyDown={(e) => {
              if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
              e.preventDefault();
              send();
            }}
          />
          <div className="row" style={{ marginTop: 8, justifyContent: "space-between", gap: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <button
                onClick={send}
                disabled={sendState.busy || !draft.trim() || !req || (req.status !== "pending" && req.status !== "approved" && req.status !== "rejected")}
              >
                {sendState.busy ? "Sending…" : "Send"}
              </button>
              <span className="muted">{sendState.message ? (sendState.error ? `${sendState.message} (${sendState.error})` : sendState.message) : ""}</span>
            </div>
            <div className="row" style={{ gap: 10 }}>
              {req?.status === "pending" && isOwner ? (
                <>
                  <button onClick={() => setStatus("approved")} disabled={statusState.busy}>
                    Approve
                  </button>
                  <button onClick={() => setStatus("rejected")} disabled={statusState.busy}>
                    Reject
                  </button>
                </>
              ) : null}
              {req?.status === "pending" && !isOwner ? (
                <button onClick={() => setStatus("cancelled")} disabled={statusState.busy}>
                  Cancel request
                </button>
              ) : null}
              <span className="muted">{statusState.message ? (statusState.error ? `${statusState.message} (${statusState.error})` : statusState.message) : ""}</span>
            </div>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            Tip: press Ctrl+Enter (or ⌘+Enter) to send.
          </div>
        </div>
      </div>
    </main>
  );
}
