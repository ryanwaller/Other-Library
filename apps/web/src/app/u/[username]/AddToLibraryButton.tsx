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
  sourceBookId?: number | null;
  sourceOwnerId?: string | null;
  compact?: boolean;
};

type SourceBook = {
  id: number;
  edition_id: number | null;
  object_type: string | null;
  source_type?: string | null;
  source_url?: string | null;
  external_source_ids?: Record<string, string | null> | null;
  music_metadata?: Record<string, unknown> | null;
  issue_number?: string | null;
  issue_volume?: string | null;
  issue_season?: string | null;
  issue_year?: number | null;
  issn?: string | null;
  subtitle_override?: string | null;
  decade?: string | null;
  pages?: number | null;
  trim_width?: number | null;
  trim_height?: number | null;
  trim_unit?: string | null;
  cover_original_url?: string | null;
  cover_crop?: Record<string, unknown> | null;
  title_override?: string | null;
  authors_override?: string[] | null;
  editors_override?: string[] | null;
  designers_override?: string[] | null;
  publisher_override?: string | null;
  printer_override?: string | null;
  materials_override?: string | null;
  edition_override?: string | null;
  publish_date_override?: string | null;
  description_override?: string | null;
  subjects_override?: string[] | null;
  group_label?: string | null;
  media?: Array<{ kind: "cover" | "image"; storage_path: string; caption: string | null }> | null;
  book_tags?: Array<{ tag: { id: number; name: string; kind: "tag" | "category" } | null }>;
  book_entities?: Array<{
    role: string;
    position: number | null;
    visibility?: boolean | null;
    entity: { id?: string; name: string; slug?: string | null } | null;
  }> | null;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function isWishlistStatusConstraintError(error: { message?: string | null } | null | undefined): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("user_books_status_check") || (message.includes("status") && message.includes("check constraint"));
}

function isMissingSavedFromColumnError(error: { message?: string | null } | null | undefined): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("saved_from_user_id") && (message.includes("does not exist") || message.includes("schema cache"));
}

export default function AddToLibraryButton({
  editionId,
  titleFallback,
  authorsFallback,
  publisherFallback,
  publishDateFallback,
  sourceBookId,
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
  const [flashMode, setFlashMode] = useState<"owned" | "wanted" | null>(null);

  // Catalog picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [catalogsLoaded, setCatalogsLoaded] = useState(false);
  const [catalogsWithEdition, setCatalogsWithEdition] = useState<Set<number>>(new Set());
  const [newCatalogMode, setNewCatalogMode] = useState(false);
  const [newCatalogName, setNewCatalogName] = useState("");
  const [newCatalogBusy, setNewCatalogBusy] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [pickerViewportLayout, setPickerViewportLayout] = useState<{ left: number; top: number; width: number } | null>(null);

  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSessionUserId(newSession?.user?.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const sync = () => setIsMobileViewport(window.innerWidth < 768);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
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

  useEffect(() => {
    if (!flashMode) return;
    const timer = window.setTimeout(() => setFlashMode(null), 1100);
    return () => window.clearTimeout(timer);
  }, [flashMode]);

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

  useEffect(() => {
    if (!pickerOpen || !isMobileViewport || !pickerRef.current) {
      if (!pickerOpen) setPickerViewportLayout(null);
      return;
    }
    const syncLayout = () => {
      const rect = pickerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.innerWidth;
      const maxWidth = Math.min(280, viewportWidth - 24);
      const left = Math.max(12, Math.min(rect.right - maxWidth, viewportWidth - maxWidth - 12));
      const top = Math.max(12, rect.bottom + 4);
      setPickerViewportLayout({ left, top, width: maxWidth });
    };
    syncLayout();
    window.addEventListener("resize", syncLayout);
    window.addEventListener("scroll", syncLayout, true);
    return () => {
      window.removeEventListener("resize", syncLayout);
      window.removeEventListener("scroll", syncLayout, true);
    };
  }, [pickerOpen, isMobileViewport]);

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

  async function getOrCreateOwnedTagId(ownerId: string, name: string, kind: "tag" | "category"): Promise<number> {
    if (!supabase) throw new Error("Sign in required");
    const normalized = name.trim().replace(/\s+/g, " ");
    const existing = await supabase
      .from("tags")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("name", normalized)
      .eq("kind", kind)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const existingId = Number((existing.data as any)?.id ?? 0);
    if (existingId > 0) return existingId;
    const inserted = await supabase
      .from("tags")
      .insert({ owner_id: ownerId, name: normalized, kind })
      .select("id")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    return Number((inserted.data as any)?.id ?? 0);
  }

  async function fetchSourceBook(): Promise<SourceBook | null> {
    if (!supabase || !sourceBookId || !Number.isFinite(sourceBookId)) return null;
    const res = await supabase
      .from("user_books")
      .select(
        "id,edition_id,object_type,source_type,source_url,external_source_ids,music_metadata,issue_number,issue_volume,issue_season,issue_year,issn,subtitle_override,decade,pages,trim_width,trim_height,trim_unit,cover_original_url,cover_crop,title_override,authors_override,editors_override,designers_override,publisher_override,printer_override,materials_override,edition_override,publish_date_override,description_override,subjects_override,group_label,media:user_book_media(kind,storage_path,caption),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,visibility,entity:entities(id,name,slug))"
      )
      .eq("id", sourceBookId)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? null) as SourceBook | null;
  }

  async function syncBookEntitiesAndTags(targetBookId: number, source: SourceBook) {
    if (!supabase || !sessionUserId) return;

    const namesByRole = new Map<string, string[]>();
    const visibilitiesByRole = new Map<string, boolean[]>();

    for (const row of source.book_entities ?? []) {
      const roleRaw = String(row?.role ?? "").trim();
      const name = String(row?.entity?.name ?? "").trim();
      if (!roleRaw || !name) continue;
      const role = roleRaw === "design" ? "designer" : roleRaw;
      const names = namesByRole.get(role) ?? [];
      const visibilities = visibilitiesByRole.get(role) ?? [];
      names.push(name);
      visibilities.push(row?.visibility !== false);
      namesByRole.set(role, names);
      visibilitiesByRole.set(role, visibilities);
    }

    for (const [role, names] of namesByRole.entries()) {
      const visibilities = visibilitiesByRole.get(role) ?? names.map(() => true);
      const rpc = await supabase.rpc("set_book_entities_v2", {
        p_user_book_id: targetBookId,
        p_role: role,
        p_names: names,
        p_visibility: visibilities
      });
      if (rpc.error) {
        await supabase.rpc("set_book_entities", { p_user_book_id: targetBookId, p_role: role, p_names: names });
      }
    }

    const tagRows: Array<{ user_book_id: number; tag_id: number }> = [];
    for (const tagRow of source.book_tags ?? []) {
      const tag = tagRow?.tag;
      const kind = tag?.kind === "category" ? "category" : tag?.kind === "tag" ? "tag" : null;
      const name = String(tag?.name ?? "").trim();
      if (!kind || !name) continue;
      const tagId = await getOrCreateOwnedTagId(sessionUserId, name, kind);
      tagRows.push({ user_book_id: targetBookId, tag_id: tagId });
    }
    if (tagRows.length > 0) {
      const upsert = await supabase.from("user_book_tags").upsert(tagRows as any, { onConflict: "user_book_id,tag_id" });
      if (upsert.error) throw new Error(upsert.error.message);
    }
  }

  async function syncWishlistCover(targetBookId: number, source: SourceBook) {
    if (!supabase) return;
    const fallbackCoverPath =
      String(source.cover_original_url ?? "").trim() ||
      String((source.media ?? []).find((media) => media.kind === "cover")?.storage_path ?? "").trim();
    if (fallbackCoverPath) {
      const updated = await supabase.from("user_books").update({ cover_original_url: fallbackCoverPath }).eq("id", targetBookId);
      if (updated.error) throw new Error(updated.error.message);
    }
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
      setFlashMode("owned");
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
      const source = await fetchSourceBook();
      const canonicalEditionId = source?.edition_id ?? (await ensureCanonicalEditionId());
      const fallbackAuthors = uniqueStrings(authorsFallback);
      const payload: any = {
        owner_id: sessionUserId,
        library_id: wishlistLibraryId,
        edition_id: canonicalEditionId,
        collection_state: "wanted",
        visibility: "followers_only",
        status: "wishlist",
        borrowable_override: false,
        saved_from_user_id: sourceOwnerId ?? null
      };
      payload.object_type = source?.object_type ?? null;
      payload.source_type = source?.source_type ?? null;
      payload.source_url = source?.source_url ?? null;
      payload.external_source_ids = source?.external_source_ids ?? null;
      payload.music_metadata = source?.music_metadata ?? null;
      payload.issue_number = source?.issue_number ?? null;
      payload.issue_volume = source?.issue_volume ?? null;
      payload.issue_season = source?.issue_season ?? null;
      payload.issue_year = source?.issue_year ?? null;
      payload.issn = source?.issn ?? null;
      payload.subtitle_override = source?.subtitle_override ?? null;
      payload.decade = source?.decade ?? null;
      payload.pages = source?.pages ?? null;
      payload.trim_width = source?.trim_width ?? null;
      payload.trim_height = source?.trim_height ?? null;
      payload.trim_unit = source?.trim_unit ?? null;
      payload.cover_crop = source?.cover_crop ?? null;
      payload.group_label = source?.group_label ?? null;
      payload.title_override = String(source?.title_override ?? "").trim() || titleFallback.trim() || null;
      payload.authors_override = Array.isArray(source?.authors_override)
        ? uniqueStrings(source?.authors_override)
        : (fallbackAuthors.length > 0 ? fallbackAuthors : null);
      payload.editors_override = Array.isArray(source?.editors_override) ? uniqueStrings(source?.editors_override) : null;
      payload.designers_override = Array.isArray(source?.designers_override) ? uniqueStrings(source?.designers_override) : null;
      payload.publisher_override = String(source?.publisher_override ?? "").trim() || String(publisherFallback ?? "").trim() || null;
      payload.printer_override = String(source?.printer_override ?? "").trim() || null;
      payload.materials_override = String(source?.materials_override ?? "").trim() || null;
      payload.edition_override = String(source?.edition_override ?? "").trim() || null;
      payload.publish_date_override = String(source?.publish_date_override ?? "").trim() || String(publishDateFallback ?? "").trim() || null;
      payload.description_override = String(source?.description_override ?? "").trim() || null;
      payload.subjects_override = Array.isArray(source?.subjects_override) ? uniqueStrings(source?.subjects_override) : [];
      let ins = await supabase.from("user_books").insert(payload).select("id").single();
      if (ins.error && payload.status === "wishlist" && isWishlistStatusConstraintError(ins.error)) {
        delete payload.status;
        ins = await supabase.from("user_books").insert(payload).select("id").single();
      }
      if (ins.error && payload.saved_from_user_id && isMissingSavedFromColumnError(ins.error)) {
        delete payload.saved_from_user_id;
        ins = await supabase.from("user_books").insert(payload).select("id").single();
      }
      if (ins.error) throw new Error(ins.error.message);
      const id = Number((ins.data as any)?.id ?? 0);
      if (!id) throw new Error("Wishlist add failed");
      if (source) {
        await syncBookEntitiesAndTags(id, source);
        await syncWishlistCover(id, source);
      }
      setCreatedWantedId(id);
      if (canonicalEditionId) {
        ctx?.bumpWanted(canonicalEditionId, id);
      }
      setWantedCount((c) => c + 1);
      setLatestWantedId(id);
      setFlashMode("wanted");
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
  const label = flashMode === "owned" || flashMode === "wanted" ? "✓" : compact ? "＋" : "＋ Add";

  const picker = pickerOpen ? (
    <CatalogPickerDropdown
      isMobileViewport={isMobileViewport}
      viewportLayout={pickerViewportLayout}
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
              {busy ? (compact ? "…" : "Adding…") : flashMode === "owned" ? "✓" : compact ? "＋" : "Add copy"}
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
              {busy ? (compact ? "…" : "Adding…") : flashMode === "wanted" ? "✓" : compact ? "＋" : "Add"}
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
  isMobileViewport,
  viewportLayout,
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
  isMobileViewport: boolean;
  viewportLayout: { left: number; top: number; width: number } | null;
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
        position: isMobileViewport ? "fixed" : "absolute",
        top: isMobileViewport ? (viewportLayout?.top ?? 12) : "calc(100% + 4px)",
        left: isMobileViewport ? 12 : "auto",
        right: isMobileViewport ? 12 : 0,
        zIndex: 200,
        minWidth: isMobileViewport ? undefined : 200,
        width: isMobileViewport ? "auto" : undefined,
        maxWidth: isMobileViewport ? "calc(100vw - 24px)" : undefined,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        fontSize: "inherit",
        boxSizing: "border-box",
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
