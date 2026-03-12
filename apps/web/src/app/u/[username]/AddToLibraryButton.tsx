"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useAddToLibraryContext } from "./AddToLibraryProvider";

type Catalog = { id: number; name: string };

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

  // Catalog picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [catalogsLoaded, setCatalogsLoaded] = useState(false);
  const [catalogsWithEdition, setCatalogsWithEdition] = useState<Set<number>>(new Set());
  const [newCatalogMode, setNewCatalogMode] = useState(false);
  const [newCatalogName, setNewCatalogName] = useState("");
  const [newCatalogBusy, setNewCatalogBusy] = useState(false);

  const pickerRef = useRef<HTMLDivElement>(null);

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

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
        setNewCatalogMode(false);
        setNewCatalogName("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pickerOpen]);

  async function loadCatalogs(): Promise<Catalog[]> {
    if (!supabase || !sessionUserId) return [];
    const res = await supabase
      .from("libraries")
      .select("id,name")
      .eq("owner_id", sessionUserId)
      .order("created_at", { ascending: true });
    if (res.error) return [];
    const loaded = (res.data ?? []).map((r: any) => ({ id: Number(r.id), name: String(r.name ?? "") }));
    setCatalogs(loaded);
    setCatalogsLoaded(true);
    return loaded;
  }

  async function loadCatalogsWithEdition(loadedCatalogs: Catalog[]) {
    if (!supabase || !sessionUserId || !editionId || loadedCatalogs.length === 0) return;
    const res = await supabase
      .from("user_books")
      .select("library_id")
      .eq("owner_id", sessionUserId)
      .eq("edition_id", editionId);
    if (res.error) return;
    const ids = new Set<number>((res.data ?? []).map((r: any) => Number(r.library_id)));
    setCatalogsWithEdition(ids);
  }

  async function addToLibrary(libraryId: number, catalogName: string) {
    if (!supabase || !sessionUserId) return;
    setBusy(true);
    setError(null);
    try {
      const payload: any = { owner_id: sessionUserId, library_id: libraryId, edition_id: editionId };
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
        setCatalogsWithEdition((prev) => new Set([...prev, libraryId]));
      }
    } catch (e: any) {
      setError(e?.message ?? "Add failed");
    } finally {
      setBusy(false);
      setPickerOpen(false);
      setNewCatalogMode(false);
      setNewCatalogName("");
    }
  }

  async function handleAddClick() {
    if (!supabase || !sessionUserId) return;
    setError(null);

    let loaded = catalogs;
    if (!catalogsLoaded) {
      loaded = await loadCatalogs();
      await loadCatalogsWithEdition(loaded);
    }

    // Single catalog → add directly, no picker
    if (loaded.length === 1) {
      await addToLibrary(loaded[0]!.id, loaded[0]!.name);
      return;
    }

    setPickerOpen(true);
  }

  async function handleCreateCatalog() {
    const name = newCatalogName.trim();
    if (!name || !supabase || !sessionUserId) return;
    setNewCatalogBusy(true);
    try {
      const res = await supabase
        .from("libraries")
        .insert({ owner_id: sessionUserId, name })
        .select("id")
        .single();
      if (res.error) throw new Error(res.error.message);
      const newId = (res.data as any)?.id as number;
      const newCatalog: Catalog = { id: newId, name };
      setCatalogs((prev) => [...prev, newCatalog]);
      await addToLibrary(newId, name);
    } catch (e: any) {
      setError(e?.message ?? "Failed to create catalog");
      setNewCatalogBusy(false);
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

  const picker = pickerOpen ? (
    <CatalogPickerDropdown
      catalogs={catalogs}
      catalogsWithEdition={catalogsWithEdition}
      newCatalogMode={newCatalogMode}
      newCatalogName={newCatalogName}
      newCatalogBusy={newCatalogBusy}
      busy={busy}
      onSelect={(cat) => addToLibrary(cat.id, cat.name)}
      onNewCatalogMode={() => setNewCatalogMode(true)}
      onNewCatalogNameChange={setNewCatalogName}
      onCreateCatalog={handleCreateCatalog}
    />
  ) : null;

  return (
    <span className="row" style={{ gap: "var(--space-8)", flexWrap: "nowrap", alignItems: "center", minHeight: 24 }}>
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
          <div ref={pickerRef} style={{ position: "relative", display: "inline-block" }}>
            <button onClick={handleAddClick} disabled={busy} title="Add another copy">
              {busy ? (compact ? "…" : "Adding…") : compact ? "＋" : "Add copy"}
            </button>
            {picker}
          </div>
        </>
      ) : (
        <div ref={pickerRef} style={{ position: "relative", display: "inline-block" }}>
          <button onClick={handleAddClick} disabled={busy}>
            {busy ? (compact ? "…" : "Adding…") : label}
          </button>
          {picker}
        </div>
      )}
      {error ? <span className="text-muted">{error}</span> : null}
    </span>
  );
}

function CatalogPickerDropdown({
  catalogs,
  catalogsWithEdition,
  newCatalogMode,
  newCatalogName,
  newCatalogBusy,
  busy,
  onSelect,
  onNewCatalogMode,
  onNewCatalogNameChange,
  onCreateCatalog,
}: {
  catalogs: Catalog[];
  catalogsWithEdition: Set<number>;
  newCatalogMode: boolean;
  newCatalogName: string;
  newCatalogBusy: boolean;
  busy: boolean;
  onSelect: (cat: Catalog) => void;
  onNewCatalogMode: () => void;
  onNewCatalogNameChange: (v: string) => void;
  onCreateCatalog: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        right: 0,
        zIndex: 200,
        minWidth: 200,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        fontSize: "inherit",
      }}
    >
      {catalogs.length === 0 ? (
        <div className="text-muted" style={{ padding: "8px 12px" }}>
          No catalogs
        </div>
      ) : (
        catalogs.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onSelect(cat)}
            disabled={busy}
            style={{
              display: "flex",
              width: "100%",
              textAlign: "left",
              padding: "8px 12px",
              border: "none",
              borderBottom: "1px solid var(--border)",
              background: "transparent",
              cursor: busy ? "default" : "pointer",
              gap: "var(--space-8)",
              alignItems: "baseline",
            }}
          >
            <span style={{ flex: 1 }}>{cat.name}</span>
            {catalogsWithEdition.has(cat.id) ? (
              <span className="text-muted" style={{ fontSize: "0.85em" }}>✓</span>
            ) : null}
          </button>
        ))
      )}

      <div style={{ borderTop: "1px solid var(--border)" }}>
        {newCatalogMode ? (
          <div style={{ padding: "8px 12px", display: "flex", gap: "var(--space-8)", alignItems: "baseline" }}>
            <input
              autoFocus
              value={newCatalogName}
              onChange={(e) => onNewCatalogNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); onCreateCatalog(); }
                if (e.key === "Escape") { e.preventDefault(); onNewCatalogNameChange(""); }
              }}
              placeholder="Catalog name"
              disabled={newCatalogBusy}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              onClick={onCreateCatalog}
              disabled={newCatalogBusy || !newCatalogName.trim()}
            >
              {newCatalogBusy ? "…" : "Add"}
            </button>
          </div>
        ) : (
          <button
            onClick={onNewCatalogMode}
            className="text-muted"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 12px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Add to new catalog
          </button>
        )}
      </div>
    </div>
  );
}
