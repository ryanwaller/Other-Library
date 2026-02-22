"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type AddToLibraryButtonProps = {
  editionId: number | null;
  titleFallback: string;
  authorsFallback: string[];
  sourceOwnerId?: string | null;
  compact?: boolean;
};

export default function AddToLibraryButton({ editionId, titleFallback, authorsFallback, sourceOwnerId, compact }: AddToLibraryButtonProps) {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [existingId, setExistingId] = useState<number | null>(null);

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
    if (!supabase || !sessionUserId) return;
    if (!editionId) {
      setExistingId(null);
      return;
    }
    const res = await supabase.from("user_books").select("id").eq("owner_id", sessionUserId).eq("edition_id", editionId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (res.error) return;
    setExistingId((res.data as any)?.id ?? null);
  }

  useEffect(() => {
    refreshExisting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId, editionId]);

  async function add() {
    if (!supabase || !sessionUserId) return;
    setBusy(true);
    setError(null);
    try {
      if (existingId) {
        setCreatedId(existingId);
        return;
      }

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
      setExistingId(id);
    } catch (e: any) {
      setError(e?.message ?? "Add failed");
    } finally {
      setBusy(false);
    }
  }

  if (!supabase) return null;
  if (!canAdd) return null;

  const idToOpen = createdId ?? existingId;
  const label = compact ? "＋" : "＋ Add";

  return (
    <span className="row" style={{ gap: 8 }}>
      {idToOpen ? (
        <Link href={`/app/books/${idToOpen}`}>{compact ? "open" : "Open in app"}</Link>
      ) : (
        <button onClick={add} disabled={busy}>
          {busy ? (compact ? "…" : "Adding…") : label}
        </button>
      )}
      {error ? <span className="muted">{error}</span> : null}
    </span>
  );
}
