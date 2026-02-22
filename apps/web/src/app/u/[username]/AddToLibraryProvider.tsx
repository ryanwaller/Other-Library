"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type CopyInfo = {
  count: number;
  latestId: number | null;
};

type AddToLibraryContextValue = {
  getInfo: (editionId: number) => CopyInfo | null;
  bump: (editionId: number, createdId: number) => void;
  refresh: (editionId: number) => Promise<void>;
};

const AddToLibraryContext = createContext<AddToLibraryContextValue | null>(null);

export function useAddToLibraryContext(): AddToLibraryContextValue | null {
  return useContext(AddToLibraryContext);
}

export default function AddToLibraryProvider({ editionIds, children }: { editionIds: number[]; children: React.ReactNode }) {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [infoByEditionId, setInfoByEditionId] = useState<Record<number, CopyInfo>>({});

  const ids = useMemo(() => Array.from(new Set((editionIds ?? []).filter((x) => Number.isFinite(x) && x > 0))), [editionIds]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSessionUserId(newSession?.user?.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function refreshOne(editionId: number) {
    if (!supabase || !sessionUserId) return;
    const [countRes, latestRes] = await Promise.all([
      supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", sessionUserId).eq("edition_id", editionId),
      supabase.from("user_books").select("id").eq("owner_id", sessionUserId).eq("edition_id", editionId).order("created_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    const count = countRes.count ?? 0;
    const latestId = (latestRes.data as any)?.id ?? null;
    setInfoByEditionId((prev) => ({ ...prev, [editionId]: { count, latestId } }));
  }

  async function refreshAll() {
    if (!supabase || !sessionUserId) return;
    if (ids.length === 0) return;

    const countById: Record<number, number> = {};
    const latestById: Record<number, number> = {};

    // One query: fetch all matching rows (bounded), compute counts and latest by created_at.
    const res = await supabase
      .from("user_books")
      .select("id,edition_id,created_at")
      .eq("owner_id", sessionUserId)
      .in("edition_id", ids)
      .order("created_at", { ascending: false })
      .limit(500);
    if (res.error) return;

    for (const r of (res.data ?? []) as any[]) {
      const editionId = Number(r?.edition_id);
      const id = Number(r?.id);
      if (!Number.isFinite(editionId) || !Number.isFinite(id)) continue;
      countById[editionId] = (countById[editionId] ?? 0) + 1;
      if (!latestById[editionId]) latestById[editionId] = id;
    }

    setInfoByEditionId((prev) => {
      const next = { ...prev };
      for (const editionId of ids) {
        next[editionId] = {
          count: countById[editionId] ?? 0,
          latestId: latestById[editionId] ?? null
        };
      }
      return next;
    });
  }

  useEffect(() => {
    setInfoByEditionId({});
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId, ids.join(",")]);

  const value = useMemo<AddToLibraryContextValue>(() => {
    return {
      getInfo: (editionId: number) => infoByEditionId[editionId] ?? null,
      bump: (editionId: number, createdId: number) => {
        setInfoByEditionId((prev) => {
          const cur = prev[editionId] ?? { count: 0, latestId: null };
          return { ...prev, [editionId]: { count: cur.count + 1, latestId: createdId } };
        });
      },
      refresh: refreshOne
    };
  }, [infoByEditionId]);

  return <AddToLibraryContext.Provider value={value}>{children}</AddToLibraryContext.Provider>;
}

