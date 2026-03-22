"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type CopyInfo = {
  ownedCount: number;
  latestOwnedId: number | null;
  wantedCount: number;
  latestWantedId: number | null;
};

type AddToLibraryContextValue = {
  getInfo: (editionId: number) => CopyInfo | null;
  bumpOwned: (editionId: number, createdId: number) => void;
  bumpWanted: (editionId: number, createdId: number) => void;
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
    const rowsRes = await supabase
      .from("user_books")
      .select("id,collection_state,created_at")
      .eq("owner_id", sessionUserId)
      .eq("edition_id", editionId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (rowsRes.error) return;
    const rows = (rowsRes.data ?? []) as any[];
    let ownedCount = 0;
    let wantedCount = 0;
    let latestOwnedId: number | null = null;
    let latestWantedId: number | null = null;
    for (const row of rows) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const state = String(row?.collection_state ?? "owned").trim().toLowerCase();
      if (state === "wanted") {
        wantedCount += 1;
        if (!latestWantedId) latestWantedId = id;
      } else {
        ownedCount += 1;
        if (!latestOwnedId) latestOwnedId = id;
      }
    }
    setInfoByEditionId((prev) => ({ ...prev, [editionId]: { ownedCount, latestOwnedId, wantedCount, latestWantedId } }));
  }

  async function refreshAll() {
    if (!supabase || !sessionUserId) return;
    if (ids.length === 0) return;

    const ownedCountById: Record<number, number> = {};
    const wantedCountById: Record<number, number> = {};
    const latestOwnedById: Record<number, number> = {};
    const latestWantedById: Record<number, number> = {};

    // One query: fetch all matching rows (bounded), compute counts and latest by created_at.
    const res = await supabase
      .from("user_books")
      .select("id,edition_id,collection_state,created_at")
      .eq("owner_id", sessionUserId)
      .in("edition_id", ids)
      .order("created_at", { ascending: false })
      .limit(500);
    if (res.error) return;

    for (const r of (res.data ?? []) as any[]) {
      const editionId = Number(r?.edition_id);
      const id = Number(r?.id);
      if (!Number.isFinite(editionId) || !Number.isFinite(id)) continue;
      const state = String(r?.collection_state ?? "owned").trim().toLowerCase();
      if (state === "wanted") {
        wantedCountById[editionId] = (wantedCountById[editionId] ?? 0) + 1;
        if (!latestWantedById[editionId]) latestWantedById[editionId] = id;
      } else {
        ownedCountById[editionId] = (ownedCountById[editionId] ?? 0) + 1;
        if (!latestOwnedById[editionId]) latestOwnedById[editionId] = id;
      }
    }

    setInfoByEditionId((prev) => {
      const next = { ...prev };
      for (const editionId of ids) {
        next[editionId] = {
          ownedCount: ownedCountById[editionId] ?? 0,
          latestOwnedId: latestOwnedById[editionId] ?? null,
          wantedCount: wantedCountById[editionId] ?? 0,
          latestWantedId: latestWantedById[editionId] ?? null
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
      bumpOwned: (editionId: number, createdId: number) => {
        setInfoByEditionId((prev) => {
          const cur = prev[editionId] ?? { ownedCount: 0, latestOwnedId: null, wantedCount: 0, latestWantedId: null };
          return { ...prev, [editionId]: { ...cur, ownedCount: cur.ownedCount + 1, latestOwnedId: createdId } };
        });
      },
      bumpWanted: (editionId: number, createdId: number) => {
        setInfoByEditionId((prev) => {
          const cur = prev[editionId] ?? { ownedCount: 0, latestOwnedId: null, wantedCount: 0, latestWantedId: null };
          return { ...prev, [editionId]: { ...cur, wantedCount: cur.wantedCount + 1, latestWantedId: createdId } };
        });
      },
      refresh: refreshOne
    };
  }, [infoByEditionId]);

  return <AddToLibraryContext.Provider value={value}>{children}</AddToLibraryContext.Provider>;
}
