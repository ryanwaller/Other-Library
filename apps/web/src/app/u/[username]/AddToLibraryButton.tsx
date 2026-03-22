"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useAddToLibraryContext } from "./AddToLibraryProvider";
import { WISHLIST_LIBRARY_NAME } from "../../../lib/collection";

type Catalog = { id: number; name: string };

type AddToLibraryButtonProps = {
  editionId: number | null;
  titleFallback: string;
  authorsFallback: string[];
  publisherFallback?: string | null;
  publishDateFallback?: string | null;
  sourceOwnerId?: string | null;
  compact?: boolean;
};

export default function AddToLibraryButton({
  editionId,
  titleFallback,
  authorsFallback,
  publisherFallback,
  publishDateFallback,
  sourceOwnerId,
  compact
}: AddToLibraryButtonProps) {
  const ctx = useAddToLibraryContext();
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdOwnedId, setCreatedOwnedId] = useState<number | null>(null);
  const [createdWantedId, setCreatedWantedId] = useState<number | null>(null);
  const [ownedCount, setOwnedCount] = useState<number>(0);
  const [latestOwnedId, setLatestOwnedId] = useState<number | null>(null);
  const [wantedCount, setWantedCount] = useState<number>(0);
  const [latestWantedId, setLatestWantedId] = useState<number | null>(null);

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
      setOwnedCount(0);
      setLatestOwnedId(null);
      setWantedCount(0);
      setLatestWantedId(null);
      return;
    }

    const fromCtx = ctx?.getInfo(editionId) ?? null;
    if (fromCtx) {
      setOwnedCount(fromCtx.ownedCount);
      setLatestOwnedId(fromCtx.latestOwnedId);
      setWantedCount(fromCtx.wantedCount);
      setLatestWantedId(fromCtx.latestWantedId);
      return;
    }

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
    let nextOwnedCount = 0;
    let nextWantedCount = 0;
    let nextLatestOwnedId: number | null = null;
    let nextLatestWantedId: number | null = null;
    for (const row of rows) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const state = String(row?.collection_state ?? "owned").trim().toLowerCase();
      if (state === "wanted") {
        nextWantedCount += 1;
        if (!nextLatestWantedId) nextLatestWantedId = id;
      } else {
        nextOwnedCount += 1;
        if (!nextLatestOwnedId) nextLatestOwnedId = id;
      }
    }
    setOwnedCount(nextOwnedCount);
    setLatestOwnedId(nextLatestOwnedId);
    setWantedCount(nextWantedCount);
    setLatestWantedId(nextLatestWantedId);
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
      .eq("kind", "catalog")
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
      .eq("collection_state", "owned")
      .eq("edition_id", editionId);
    if (res.error) return;
    const ids = new Set<number>((res.data ?? []).map((r: any) => Number(r.library_id)));
    setCatalogsWithEdition(ids);
  }

  async function ensureCanonicalEditionId(): Promise<number | null> {
    if (!supabase) return null;
    if (editionId) return editionId;
    const title = titleFallback.trim();
    const authors = (authorsFallback ?? []).map((value) => String(value ?? "").trim()).filter(Boolean);
    if (!title) return null;

    let query = supabase.from("editions").select("id,authors,created_at").eq("title", title).order("created_at", { ascending: false }).limit(20);
    if (authors.length > 0) query = query.contains("authors", authors);
    const existing = await query;
    if (!existing.error) {
      const match = ((existing.data ?? []) as any[]).find((row) => {
        const rowAuthors = Array.isArray(row?.authors) ? row.authors.map((value: unknown) => String(value ?? "").trim().toLowerCase()).filter(Boolean) : [];
        if (authors.length === 0) return true;
        return authors.every((author) => rowAuthors.includes(author.toLowerCase()));
      });
      if (match?.id) return Number(match.id);
    }

    const inserted = await supabase
      .from("editions")
      .insert({
        title,
        authors,
        publisher: publisherFallback?.trim() || null,
        publish_date: publishDateFallback?.trim() || null
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    return Number((inserted.data as any)?.id ?? 0) || null;
  }

  async function ensureWishlistLibraryId(): Promise<number> {
    if (!supabase || !sessionUserId) throw new Error("Sign in required");
    const existing = await supabase
      .from("libraries")
      .select("id")
      .eq("owner_id", sessionUserId)
      .eq("kind", "wishlist")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const foundId = Number((existing.data as any)?.id ?? 0);
    if (foundId > 0) return foundId;
    const created = await supabase
      .from("libraries")
      .insert({ owner_id: sessionUserId, name: WISHLIST_LIBRARY_NAME, kind: "wishlist" })
      .select("id")
      .single();
    if (created.error) throw new Error(created.error.message);
    return Number((created.data as any)?.id ?? 0);
  }

  async function addToLibrary(libraryId: number, catalogName: string) {
    if (!supabase || !sessionUserId) return;
    setBusy(true);
    setError(null);
    try {
      const canonicalEditionId = await ensureCanonicalEditionId();
      const payload: any = { owner_id: sessionUserId, library_id: libraryId, edition_id: canonicalEditionId, collection_state: "owned" };
      if (!canonicalEditionId) {
        payload.title_override = titleFallback.trim() ? titleFallback.trim() : null;
        payload.authors_override = (authorsFallback ?? []).filter(Boolean).length > 0 ? (authorsFallback ?? []).filter(Boolean) : null;
      }
      const ins = await supabase.from("user_books").insert(payload).select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      const id = (ins.data as any)?.id as number | undefined;
      if (!id) throw new Error("Add failed");
      setCreatedOwnedId(id);
      if (canonicalEditionId) {
        ctx?.bumpOwned(canonicalEditionId, id);
        setOwnedCount((c) => c + 1);
        setLatestOwnedId(id);
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

  async function addToWishlist() {
    if (!supabase || !sessionUserId) return;
    setBusy(true);
    setError(null);
    try {
      const wishlistLibraryId = await ensureWishlistLibraryId();
      const canonicalEditionId = await ensureCanonicalEditionId();
      const payload: any = {
        owner_id: sessionUserId,
        library_id: wishlistLibraryId,
        edition_id: canonicalEditionId,
        collection_state: "wanted",
        status: "owned"
      };
      if (!canonicalEditionId) {
        payload.title_override = titleFallback.trim() ? titleFallback.trim() : null;
        payload.authors_override = (authorsFallback ?? []).filter(Boolean).length > 0 ? (authorsFallback ?? []).filter(Boolean) : null;
      }
      const ins = await supabase.from("user_books").insert(payload).select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      const id = Number((ins.data as any)?.id ?? 0);
      if (!id) throw new Error("Wishlist add failed");
      setCreatedWantedId(id);
      if (canonicalEditionId) {
        ctx?.bumpWanted(canonicalEditionId, id);
      }
      setWantedCount((c) => c + 1);
      setLatestWantedId(id);
    } catch (e: any) {
      setError(e?.message ?? "Wishlist add failed");
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
    setPickerOpen(true);
  }

  async function handleCreateCatalog() {
    const name = newCatalogName.trim();
    if (!name || !supabase || !sessionUserId) return;
    setNewCatalogBusy(true);
    try {
      const res = await supabase
        .from("libraries")
        .insert({ owner_id: sessionUserId, name, kind: "catalog" })
        .select("id")
        .single();
      if (res.error) throw new Error(res.error.message);
      const newId = (res.data as any)?.id as number;
      const newCatalog: Catalog = { id: newId, name };
      setCatalogs((prev) => [...prev, newCatalog]);
      await addToLibrary(newId, name);
    } catch (e: any) {
      setError(e?.message ?? "Failed to create catalog");
    } finally {
      setNewCatalogBusy(false);
    }
  }

  async function removeOne() {
    if (!supabase || !sessionUserId) return;
    if (!editionId) return;
    let id = latestOwnedId;
    if (!id) {
      const latestRes = await supabase
        .from("user_books")
        .select("id")
        .eq("owner_id", sessionUserId)
        .eq("edition_id", editionId)
        .eq("collection_state", "owned")
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
      setOwnedCount((c) => Math.max(0, c - 1));
      setCreatedOwnedId(null);
      await ctx?.refresh(editionId);
      await refreshExisting();
    } catch (e: any) {
      setError(e?.message ?? "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeWishlist() {
    if (!supabase || !sessionUserId) return;
    if (!editionId) return;
    let id = latestWantedId;
    if (!id) {
      const latestRes = await supabase
        .from("user_books")
        .select("id")
        .eq("owner_id", sessionUserId)
        .eq("edition_id", editionId)
        .eq("collection_state", "wanted")
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
      setWantedCount((c) => Math.max(0, c - 1));
      setCreatedWantedId(null);
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

  const ownedIdToOpen = latestOwnedId ?? createdOwnedId;
  const wantedIdToOpen = latestWantedId ?? createdWantedId;
  const label = compact ? "＋" : "＋ Add";

  const picker = pickerOpen ? (
    <CatalogPickerDropdown
      catalogs={catalogs}
      catalogsWithEdition={catalogsWithEdition}
      wantedCount={wantedCount}
      newCatalogMode={newCatalogMode}
      newCatalogName={newCatalogName}
      newCatalogBusy={newCatalogBusy}
      busy={busy}
      onSelect={(cat) => addToLibrary(cat.id, cat.name)}
      onSelectWishlist={addToWishlist}
      onNewCatalogMode={() => setNewCatalogMode(true)}
      onNewCatalogNameChange={setNewCatalogName}
      onCreateCatalog={handleCreateCatalog}
    />
  ) : null;

  return (
    <span className="row" style={{ gap: "var(--space-8)", flexWrap: "nowrap", alignItems: "center", minHeight: 24 }}>
      {editionId && ownedCount > 0 ? (
        <>
          <Link href={ownedIdToOpen ? `/app/books/${ownedIdToOpen}` : "/app"} style={{ textDecoration: "none" }}>
            <span className="card" style={{ padding: "2px 8px", display: "inline-flex", alignItems: "center" }}>
              {ownedCount}
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
          {wantedCount > 0 ? <span className="text-muted">{compact ? "Wishlist" : "In wishlist"}</span> : null}
        </>
      ) : editionId && wantedCount > 0 ? (
        <>
          <Link href={wantedIdToOpen ? `/app/books/${wantedIdToOpen}` : "/app"} style={{ textDecoration: "none" }}>
            <span className="card" style={{ padding: "2px 8px", display: "inline-flex", alignItems: "center" }}>
              Wishlist
            </span>
          </Link>
          <button onClick={removeWishlist} disabled={busy} title="Remove from wishlist">
            {busy ? (compact ? "…" : "Removing…") : compact ? "－" : "Remove"}
          </button>
          <div ref={pickerRef} style={{ position: "relative", display: "inline-block" }}>
            <button onClick={handleAddClick} disabled={busy} title="Add to catalog or wishlist">
              {busy ? (compact ? "…" : "Adding…") : compact ? "＋" : "Add"}
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
  wantedCount,
  newCatalogMode,
  newCatalogName,
  newCatalogBusy,
  busy,
  onSelect,
  onSelectWishlist,
  onNewCatalogMode,
  onNewCatalogNameChange,
  onCreateCatalog,
}: {
  catalogs: Catalog[];
  catalogsWithEdition: Set<number>;
  wantedCount: number;
  newCatalogMode: boolean;
  newCatalogName: string;
  newCatalogBusy: boolean;
  busy: boolean;
  onSelect: (cat: Catalog) => void;
  onSelectWishlist: () => void;
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
        <button
          onClick={onSelectWishlist}
          disabled={busy || wantedCount > 0}
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
            opacity: wantedCount > 0 ? 0.5 : 1
          }}
        >
          <span style={{ flex: 1 }}>Add to wishlist</span>
          {wantedCount > 0 ? <span className="text-muted">✓</span> : null}
        </button>
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
