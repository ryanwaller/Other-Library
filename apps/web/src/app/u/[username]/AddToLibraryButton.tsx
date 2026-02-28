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
  const [defaultLibraryId, setDefaultLibraryId] = useState<number | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSessionUserId(newSession?.user?.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function ensureDefaultLibraryId(): Promise<number | null> {
    if (!supabase || !sessionUserId) {
      setDefaultLibraryId(null);
      return null;
    }

    const seen = new Set<number>();
    const candidateIds: number[] = [];
    if (Number.isFinite(defaultLibraryId as number) && (defaultLibraryId as number) > 0) {
      candidateIds.push(defaultLibraryId as number);
      seen.add(defaultLibraryId as number);
    }
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem("om_currentLibraryId") : null;
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed) && parsed > 0 && !seen.has(parsed)) {
        candidateIds.push(parsed);
        seen.add(parsed);
      }
    } catch {
      // ignore
    }

    for (const candidateId of candidateIds) {
      const preferred = await supabase.from("libraries").select("id").eq("id", candidateId).eq("owner_id", sessionUserId).maybeSingle();
      if (!preferred.error && preferred.data) {
        setDefaultLibraryId(candidateId);
        try {
          window.localStorage.setItem("om_currentLibraryId", String(candidateId));
        } catch {
          // ignore
        }
        return candidateId;
      }
    }

    // Fallback: first library owned by this user.
    const libs = await supabase.from("libraries").select("id").eq("owner_id", sessionUserId).order("created_at", { ascending: true }).limit(1);
    if (libs.error) return null;
    const id = (libs.data?.[0] as any)?.id as number | undefined;
    if (id) {
      setDefaultLibraryId(id);
      try {
        window.localStorage.setItem("om_currentLibraryId", String(id));
      } catch {
        // ignore
      }
      return id;
    }

    // If none exist yet, create a default library and retry once.
    const created = await supabase.from("libraries").insert({ owner_id: sessionUserId, name: "Your catalog" }).select("id").single();
    if (created.error) return null;
    const createdLibraryId = (created.data as any)?.id as number | undefined;
    if (createdLibraryId) {
      setDefaultLibraryId(createdLibraryId);
      try {
        window.localStorage.setItem("om_currentLibraryId", String(createdLibraryId));
      } catch {
        // ignore
      }
      return createdLibraryId;
    }
    return null;
  }

  async function refreshDefaultLibrary() {
    await ensureDefaultLibraryId();
  }

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

  useEffect(() => {
    refreshDefaultLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId]);

  async function add() {
    if (!supabase || !sessionUserId) return;
    const targetLibraryId = await ensureDefaultLibraryId();
    if (!targetLibraryId) {
      setError("No catalog selected");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: any = { owner_id: sessionUserId, library_id: targetLibraryId, edition_id: editionId };
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

  async function removeOne() {
    if (!supabase || !sessionUserId) return;
    if (!editionId) return;
    let id = latestId;
    if (!id) {
      const latestRes = await supabase
        .from("user_books")
        .select("id")
        .eq("owner_id", sessionUserId)
        .eq("edition_id", editionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestRes.error) return;
      id = (latestRes.data as any)?.id ?? null;
    }
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const del = await supabase.from("user_books").delete().eq("id", id).eq("owner_id", sessionUserId);
      if (del.error) throw new Error(del.error.message);
      setCount((c) => Math.max(0, c - 1));
      setCreatedId(null);
      await ctx?.refresh(editionId);
      await refreshExisting();
    } catch (e: any) {
      setError(e?.message ?? "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  if (!supabase) return null;
  if (!canAdd) return null;

  const idToOpen = latestId ?? createdId;
  const label = compact ? "＋" : "＋ Add";

  return (
    <span className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "center", minHeight: 24 }}>
      {editionId && count > 0 ? (
        <>
          <Link href={idToOpen ? `/app/books/${idToOpen}` : "/app"} style={{ textDecoration: "none" }}>
            <span className="card" style={{ padding: "2px 8px", display: "inline-flex", alignItems: "center" }}>
              {count}
            </span>
          </Link>
          <button onClick={removeOne} disabled={busy} title="Remove one copy">
            {busy ? (compact ? "…" : "Removing…") : compact ? "－" : "Remove copy"}
          </button>
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
