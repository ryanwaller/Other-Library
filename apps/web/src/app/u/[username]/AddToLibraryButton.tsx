"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useAddToLibraryContext } from "./AddToLibraryProvider";

type AddToLibraryButtonProps = {
  editionId: number | null;
  titleFallback: string;
  authorsFallback: string[];
  sourceOwnerId?: string | null;
  compact?: boolean;
};

export default function AddToLibraryButton({ editionId, titleFallback, authorsFallback, sourceOwnerId, compact }: AddToLibraryButtonProps) {
  const ctx = useAddToLibraryContext();
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [count, setCount] = useState<number>(0);
  const [latestId, setLatestId] = useState<number | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSessionUserId(newSession?.user?.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const isSelf = useMemo(() => {
    if (!sessionUserId) return false;
    if (!sourceOwnerId) return false;
    return sessionUserId === sourceOwnerId;
  }, [sessionUserId, sourceOwnerId]);

  const canAdd = useMemo(() => {
    if (!sessionUserId) return false;
    if (isSelf) return false;
    return true;
  }, [sessionUserId, isSelf]);

  async function refreshExisting() {
    if (!editionId) {
      setCount(0);
      setLatestId(null);
      return;
    }

    const fromCtx = ctx?.getInfo(editionId) ?? null;
    if (fromCtx) {
      setCount(fromCtx.count);
      setLatestId(fromCtx.latestId);
      return;
    }

    if (!supabase || !sessionUserId) return;
    const [countRes, latestRes] = await Promise.all([
      supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", sessionUserId).eq("edition_id", editionId),
      supabase.from("user_books").select("id").eq("owner_id", sessionUserId).eq("edition_id", editionId).order("created_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    if (countRes.error) return;
    if (latestRes.error) return;
    setCount(countRes.count ?? 0);
    setLatestId((latestRes.data as any)?.id ?? null);
  }

  useEffect(() => {
    refreshExisting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId, editionId, ctx]);

  async function add() {
    if (!supabase || !sessionUserId) return;
    setBusy(true);
    setError(null);
    try {
      const payload: any = { owner_id: sessionUserId, edition_id: editionId };
      if (!editionId) {
        payload.edition_id = null;
        payload.title_override = titleFallback.trim() ? titleFallback.trim() : null;
        payload.authors_override = (authorsFallback ?? []).filter(Boolean).length > 0 ? (authorsFallback ?? []).filter(Boolean) : null;
      }

      const ins = await supabase.from("user_books").insert(payload).select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      const id = (ins.data as any)?.id as number | undefined;
      if (!id) throw new Error("Add failed");
      setCreatedId(id);
      if (editionId) {
        ctx?.bump(editionId, id);
        setCount((c) => c + 1);
        setLatestId(id);
      }
    } catch (e: any) {
      setError(e?.message ?? "Add failed");
    } finally {
      setBusy(false);
    }
  }

  if (!supabase) return null;
  if (!canAdd) return null;

  const idToOpen = latestId ?? createdId;
  const label = compact ? "＋" : "＋ Add";

  return (
    <span className="row" style={{ gap: 8 }}>
      {editionId && count > 0 ? (
        <>
          <Link href={idToOpen ? `/app/books/${idToOpen}` : "/app"} style={{ textDecoration: "none" }}>
            <span className="card" style={{ padding: "2px 8px", display: "inline-flex", alignItems: "center" }}>
              {count}
            </span>
          </Link>
          <button onClick={add} disabled={busy} title="Add another copy">
            {busy ? (compact ? "…" : "Adding…") : compact ? "＋" : "Add copy"}
          </button>
        </>
      ) : (
        <button onClick={add} disabled={busy}>
          {busy ? (compact ? "…" : "Adding…") : label}
        </button>
      )}
      {error ? <span className="muted">{error}</span> : null}
    </span>
  );
}
