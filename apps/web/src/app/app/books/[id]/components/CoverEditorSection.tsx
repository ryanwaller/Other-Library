"use client";

import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from "react";
import type { TrimUnit } from "../../../../../lib/trimSize";
import CoverImage, { type CoverCrop } from "../../../../../components/CoverImage";
import CustomSlider from "../../../../../components/CustomSlider";
import CoverEditor, { type EditorState } from "./CoverEditor";
import { supabase } from "../../../../../lib/supabaseClient";

function toProxyImageUrl(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("blob:")) return raw;
  return `/api/image-proxy?url=${encodeURIComponent(raw)}`;
}

function toFullSizeImageUrl(url: string): string {
  let raw = (url ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("blob:")) return raw;
  try {
    const u = new URL(raw);
    const paramsToStrip = ["h", "w", "fit", "compress", "resize", "width", "height", "scale", "quality", "format", "op"];
    paramsToStrip.forEach(p => u.searchParams.delete(p));
    const host = u.hostname.toLowerCase();
    if (host.includes("googleusercontent.com") || host.includes("books.google.com")) {
      u.searchParams.set("zoom", "0");
      u.searchParams.delete("edge");
    }
    if (host.includes("covers.openlibrary.org")) {
      u.pathname = u.pathname.replace(/-(S|M|small|medium)\.jpg$/i, "-L.jpg");
    }
    if (host.includes("amazon.com") || host.includes("ssl-images-amazon.com")) {
      u.pathname = u.pathname.replace(/\._[A-Z0-9,_-]+\.(jpg|jpeg|png|gif|webp)$/i, ".$1");
    }
    if (u.searchParams.has("width") || u.searchParams.has("height")) {
      u.searchParams.delete("width");
      u.searchParams.delete("height");
    }
    raw = u.toString();
  } catch { /* ignore */ }
  return toProxyImageUrl(raw);
}

function safeFileName(name: string): string {
  return name.trim().replace(/[^\w.\-]+/g, "_").slice(0, 120) || "image";
}

function extFromContentType(contentType: string | null): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("image/png")) return "png";
  if (ct.includes("image/webp")) return "webp";
  if (ct.includes("image/avif")) return "avif";
  if (ct.includes("image/gif")) return "gif";
  return "jpg";
}

type MediaItem = {
  id: number;
  kind: "cover" | "image";
  storage_path: string;
  caption: string | null;
  created_at: string;
};

type BookForCoverSection = {
  id: number;
  cover_crop: CoverCrop | null;
  cover_original_url: string | null;
  media: MediaItem[];
  edition: { id: number; cover_url: string | null } | null;
};

export type CoverEditorSectionHandle = {
  resetEditor: () => void;
};

type CoverEditorSectionProps = {
  book: BookForCoverSection | null;
  coverUrl: string | null;
  coverOriginalSrc: string | null;
  setCoverOriginalSrc: (url: string | null) => void;
  isOwner: boolean;
  isNarrow: boolean;
  userId: string | null;
  effectiveTitle: string;
  formTrimWidth: string;
  formTrimHeight: string;
  formTrimUnit: TrimUnit;
  cropTrimWidth: string;
  cropTrimHeight: string;
  cropTrimUnit: TrimUnit | "ratio";
  onCropTrimWidthChange: (val: string) => void;
  onCropTrimHeightChange: (val: string) => void;
  onCropTrimUnitChange: (unit: TrimUnit | "ratio") => void;
  coverToolsOpen: boolean;
  setCoverToolsOpen: (open: boolean) => void;
  coverExpanded: boolean;
  setCoverExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  roundedCover?: boolean;
  refresh: () => Promise<void>;
  setSuggestedCoverUrl: (url: string | null) => void;
  onOptimisticCoverDelete: () => void;
  onTouchStart: React.TouchEventHandler<HTMLDivElement>;
  onTouchMove: React.TouchEventHandler<HTMLDivElement>;
  onTouchEnd: React.TouchEventHandler<HTMLDivElement>;
  onTouchCancel: React.TouchEventHandler<HTMLDivElement>;
  onCoverClick?: () => void;
};

const CoverEditorSection = forwardRef<CoverEditorSectionHandle, CoverEditorSectionProps>(
  function CoverEditorSection({
    book,
    coverUrl,
    coverOriginalSrc,
    setCoverOriginalSrc,
    isOwner,
    isNarrow,
    userId,
    effectiveTitle,
    formTrimWidth,
    formTrimHeight,
    formTrimUnit,
    cropTrimWidth,
    cropTrimHeight,
    cropTrimUnit,
    onCropTrimWidthChange,
    onCropTrimHeightChange,
    onCropTrimUnitChange,
    coverToolsOpen,
    setCoverToolsOpen,
    coverExpanded,
    setCoverExpanded,
    roundedCover = false,
    refresh,
    setSuggestedCoverUrl,
    onOptimisticCoverDelete,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    onCoverClick,
  }, ref) {
    const [pendingCover, setPendingCover] = useState<File | null>(null);
    const [coverEditorSrc, setCoverEditorSrc] = useState<string | null>(null);
    const coverEditorObjectUrlRef = useRef<string | null>(null);
    const [editorState, setEditorState] = useState<EditorState>({
      x: 0, y: 0, zoom: 1, rotation: 0, brightness: 1, contrast: 1
    });
    const [minZoomFloor, setMinZoomFloor] = useState<number>(1);
    const [coverState, setCoverState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
      busy: false, error: null, message: null
    });
    const [coverInputKey, setCoverInputKey] = useState(0);

    useImperativeHandle(ref, () => ({
      resetEditor() {
        setPendingCover(null);
        setCoverEditorSrc(null);
        setCoverInputKey(k => k + 1);
      }
    }));

    // pendingCover → object URL
    useEffect(() => {
      if (!pendingCover) return;
      const url = URL.createObjectURL(pendingCover);
      if (coverEditorObjectUrlRef.current) URL.revokeObjectURL(coverEditorObjectUrlRef.current);
      coverEditorObjectUrlRef.current = url;
      setCoverEditorSrc(url);
      setEditorState({ x: 0, y: 0, zoom: 1.0, rotation: 0, brightness: 1, contrast: 1 });
      return () => { URL.revokeObjectURL(url); };
    }, [pendingCover]);

    // Cleanup object URL on unmount
    useEffect(() => {
      return () => {
        if (coverEditorObjectUrlRef.current) {
          URL.revokeObjectURL(coverEditorObjectUrlRef.current);
          coverEditorObjectUrlRef.current = null;
        }
      };
    }, []);

    const cropTrimSizeValid = useMemo(() => {
      const w = parseFloat(cropTrimWidth);
      const h = parseFloat(cropTrimHeight);
      return Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
    }, [cropTrimWidth, cropTrimHeight]);

    const coverAspect = useMemo(() => {
      if (cropTrimSizeValid) {
        return parseFloat(cropTrimWidth) / parseFloat(cropTrimHeight);
      }
      return undefined;
    }, [cropTrimSizeValid, cropTrimWidth, cropTrimHeight]);

    function cancelCoverEdit() {
      setPendingCover(null);
      setCoverEditorSrc(null);
      setCoverInputKey(k => k + 1);
      setCoverToolsOpen(false);
    }

    function resetCoverEdit() {
      setEditorState({ zoom: 1.0, x: 0, y: 0, rotation: 0, brightness: 1, contrast: 1 });
      const origSrc = toFullSizeImageUrl((coverOriginalSrc ?? coverUrl) || "");
      setCoverEditorSrc(origSrc);
    }

    async function uploadCover() {
      if (!supabase || !book || !userId) return;
      if (!isOwner) return;

      setCoverState({ busy: true, error: null, message: "Saving…" });
      try {
        const cropData: CoverCrop = {
          zoom: editorState.zoom,
          rotation: editorState.rotation,
          brightness: editorState.brightness,
          contrast: editorState.contrast,
          x: editorState.x,
          y: editorState.y,
          mode: "transform"
        };

        if (pendingCover && coverEditorSrc) {
          const baseName = safeFileName(pendingCover.name.replace(/\.[^/.]+$/, ""));
          const ext = extFromContentType(pendingCover.type);
          const path = `${userId}/${book.id}/cover-original-${Date.now()}-${baseName}.${ext}`;

          const existing = (book.media ?? []).filter((m) => m.kind === "cover");
          for (const m of existing) {
            if (m.storage_path) await supabase.storage.from("user-book-media").remove([m.storage_path]);
            if (m.id) await supabase.from("user_book_media").delete().eq("id", m.id);
          }

          const up = await supabase.storage.from("user-book-media").upload(path, pendingCover, {
            cacheControl: "31536000", upsert: false, contentType: pendingCover.type || "image/jpeg"
          });
          if (up.error) throw new Error(up.error.message);

          await supabase.from("user_book_media").insert({ user_book_id: book.id, kind: "cover", storage_path: path, caption: null });

          await supabase.from("user_books").update({ cover_original_url: path }).eq("id", book.id);
          try {
            const { data: sd } = await supabase.storage.from("user-book-media").createSignedUrl(path, 3600);
            if (sd?.signedUrl) setCoverOriginalSrc(toFullSizeImageUrl(sd.signedUrl));
          } catch { /* best-effort */ }
        }

        await supabase.from("user_books").update({ cover_crop: cropData as any }).eq("id", book.id);

        {
          let tw: number | null = null;
          let th: number | null = null;
          let tu: string | null = null;
          if (cropTrimUnit !== "ratio") {
            const w = parseFloat(cropTrimWidth);
            const h = parseFloat(cropTrimHeight);
            if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
              tw = w; th = h; tu = cropTrimUnit;
            }
          } else {
            const w = parseFloat(formTrimWidth);
            const h = parseFloat(formTrimHeight);
            if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
              tw = w; th = h; tu = formTrimUnit;
            }
          }
          await supabase.from("user_books").update({ trim_width: tw, trim_height: th, trim_unit: tu }).eq("id", book.id);
        }

        setPendingCover(null);
        setCoverEditorSrc(null);
        setCoverInputKey(k => k + 1);
        await refresh();
        setCoverState({ busy: false, error: null, message: "Saved" });
        setCoverToolsOpen(false);
        setTimeout(() => {
          setCoverState(s => s.message === "Saved" ? { ...s, message: null } : s);
        }, 1000);
      } catch (e: any) {
        setCoverState({ busy: false, error: e?.message ?? "Save failed", message: "Save failed" });
      }
    }

    async function deleteCover() {
      if (!supabase || !book || !userId) return;
      if (!isOwner) return;
      setCoverState({ busy: true, error: null, message: "Deleting cover…" });
      try {
        const up = await supabase.from("user_books").update({ cover_original_url: null, cover_crop: null }).eq("id", book.id);
        if (up.error) throw new Error(up.error.message);

        const existing = (book.media ?? []).filter((m) => m.kind === "cover");
        for (const m of existing) {
          if (m?.storage_path) await supabase.storage.from("user-book-media").remove([m.storage_path]);
          if (m?.id) await supabase.from("user_book_media").delete().eq("id", m.id);
        }

        setCoverEditorSrc(null);
        setPendingCover(null);
        setSuggestedCoverUrl(null);
        setCoverToolsOpen(false);

        if (book.edition?.id) {
          await supabase.from("editions").update({ cover_url: null }).eq("id", book.edition.id);
        }

        onOptimisticCoverDelete();

        await refresh();
        setCoverState({ busy: false, error: null, message: "Deleted" });
        window.setTimeout(() => setCoverState(s => s.message === "Deleted" ? { ...s, message: null } : s), 1500);
      } catch (e: any) {
        setCoverState({ busy: false, error: e?.message ?? "Delete failed", message: "Delete failed" });
      }
    }

    return (
      <div>
        <div
          className="om-cover-slot"
          style={{
            position: "relative",
            width: "100%",
            height: "auto",
            padding: 0,
            overflow: "hidden",
            borderRadius: roundedCover ? 24 : 0,
            display: coverEditorSrc ? "block" : "flex",
            touchAction: "pan-y",
            filter: coverEditorSrc
              ? `brightness(${editorState.brightness}) contrast(${editorState.contrast})`
              : undefined,
            cursor: !coverEditorSrc && coverUrl && !coverToolsOpen ? "pointer" : undefined
          }}
          onClick={!coverEditorSrc && coverUrl && !coverToolsOpen ? onCoverClick : undefined}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          {coverEditorSrc ? (
            <CoverEditor
              src={coverEditorSrc}
              state={editorState}
              onChange={(next) => setEditorState(s => ({ ...s, ...next }))}
              onLoad={({ minZoom }) => setMinZoomFloor(minZoom)}
              aspectRatio={coverAspect ?? (2/3)}
              style={{ width: "100%", height: "auto", aspectRatio: `${coverAspect ?? (2/3)}` }}
            />
          ) : (
            <CoverImage
              alt={effectiveTitle}
              src={coverOriginalSrc ?? coverUrl}
              cropData={book?.cover_crop ?? null}
              style={{ width: "100%", height: "auto", display: "block" }}
              objectFit="contain"
            />
          )}
        </div>

        {isOwner ? (
          <details
            open={coverToolsOpen}
            onToggle={(e) => {
              const open = (e.currentTarget as HTMLDetailsElement).open;
              setCoverToolsOpen(open);

              if (open && coverUrl && !coverEditorSrc && !pendingCover) {
                const origSrc = toFullSizeImageUrl((coverOriginalSrc ?? coverUrl) || "");
                setCoverEditorSrc(origSrc);
                const crop = book?.cover_crop;
                const isTransform = crop?.mode === "transform";
                setEditorState({
                  zoom: isTransform ? (crop.zoom ?? 1.0) : 1.0,
                  x: isTransform ? (crop.x ?? 0) : 0,
                  y: isTransform ? (crop.y ?? 0) : 0,
                  rotation: crop?.rotation ?? 0,
                  brightness: crop?.brightness ?? 1,
                  contrast: crop?.contrast ?? 1
                });
              }
            }}
            style={{ marginTop: "var(--space-10)", border: "none", outline: "none", boxShadow: "none" }}
          >
            <summary className="om-disclosure-summary" style={{ listStyle: "none", border: "none", outline: "none", boxShadow: "none", display: "flex", width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                {coverToolsOpen ? (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void uploadCover(); }}
                    disabled={coverState.busy}
                  >
                    {coverState.busy ? "Saving…" : "Save"}
                  </button>
                ) : (
                  <span className="text-muted" style={{ cursor: "pointer" }}>
                    {coverUrl ? "Edit cover" : "Add cover"}
                  </span>
                )}

                <div className="row" style={{ gap: "var(--space-md)", alignItems: "baseline", justifyContent: "flex-end" }}>
                  {!isNarrow && coverUrl ? (
                    <button
                      className="text-muted"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCoverExpanded((prev) => !prev);
                      }}
                      disabled={coverState.busy}
                    >
                      {coverExpanded ? "Smaller" : "Bigger"}
                    </button>
                  ) : null}
                  {coverToolsOpen ? (
                    <button
                      className="text-muted"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelCoverEdit(); }}
                      disabled={coverState.busy}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            </summary>
            <div style={{ marginTop: 0 }}>
              {coverEditorSrc ? (
                <div style={{ marginTop: 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    <div className="row" style={{ marginTop: "var(--space-8)", alignItems: "center" }}>
                      <div className="text-muted" style={{ minWidth: 110 }}>Trim size</div>
                      <div className="row" style={{ gap: "var(--space-sm)", alignItems: "center" }}>
                        <input
                          type="number"
                          value={cropTrimWidth}
                          min={0.01}
                          step={0.01}
                          onChange={(e) => onCropTrimWidthChange(e.target.value)}
                          placeholder="W"
                          style={{ width: 68 }}
                        />
                        <span className="text-muted">×</span>
                        <input
                          type="number"
                          value={cropTrimHeight}
                          min={0.01}
                          step={0.01}
                          onChange={(e) => onCropTrimHeightChange(e.target.value)}
                          placeholder="H"
                          style={{ width: 68 }}
                        />
                        <select
                          value={cropTrimUnit}
                          onChange={(e) => onCropTrimUnitChange(e.target.value as any)}
                          style={{ width: "auto", minWidth: 0 }}
                        >
                          <option value="ratio">ratio</option>
                          <option value="in">in</option>
                          <option value="mm">mm</option>
                        </select>
                      </div>
                    </div>

                    <div className="row no-wrap" style={{ marginTop: "var(--space-8)", alignItems: "center" }}>
                      <div className="text-muted" style={{ minWidth: 110 }}>Zoom</div>
                      <CustomSlider
                        min={1}
                        max={4}
                        step={0.01}
                        value={editorState.zoom}
                        onChange={(zoom) => setEditorState(s => ({ ...s, zoom }))}
                        style={{ flex: "1 1 auto" }}
                      />
                    </div>
                    <div className="row no-wrap" style={{ marginTop: "var(--space-8)", alignItems: "center" }}>
                      <div className="text-muted" style={{ minWidth: 110 }}>Rotate</div>
                      <CustomSlider
                        min={-180}
                        max={180}
                        step={1}
                        value={editorState.rotation}
                        onChange={(rotation) => setEditorState(s => ({ ...s, rotation }))}
                        style={{ flex: "1 1 auto" }}
                      />
                    </div>
                    <div className="row no-wrap" style={{ marginTop: "var(--space-8)", alignItems: "center" }}>
                      <div className="text-muted" style={{ minWidth: 110 }}>Bright</div>
                      <CustomSlider
                        min={0.5}
                        max={1.5}
                        step={0.01}
                        value={editorState.brightness}
                        onChange={(brightness) => setEditorState(s => ({ ...s, brightness }))}
                        style={{ flex: "1 1 auto" }}
                      />
                    </div>
                    <div className="row no-wrap" style={{ marginTop: "var(--space-8)", alignItems: "center" }}>
                      <div className="text-muted" style={{ minWidth: 110 }}>Contrast</div>
                      <CustomSlider
                        min={0.5}
                        max={1.5}
                        step={0.01}
                        value={editorState.contrast}
                        onChange={(contrast) => setEditorState(s => ({ ...s, contrast }))}
                        style={{ flex: "1 1 auto" }}
                      />
                    </div>
                  </div>
                </div>
              ) : coverUrl ? (
                <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>Click Replace or wait for cover to load.</div>
              ) : (
                <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>No cover image. Click "Add cover" to upload.</div>
              )}
              {coverToolsOpen && (
                <div className="row" style={{ marginTop: "var(--space-md)", gap: 16 }}>
                  <label
                    className="text-muted"
                    style={{ cursor: "pointer", textDecoration: "underline" }}
                  >
                    Replace
                    <input
                      key={coverInputKey}
                      type="file"
                      accept="image/*"
                      onChange={(ev) => {
                        setPendingCover((ev.target.files ?? [])[0] ?? null);
                      }}
                      style={{ display: "none" }}
                    />
                  </label>

                  {coverUrl && (
                    <button
                      className="text-muted"
                      style={{ textDecoration: "underline" }}
                      onClick={resetCoverEdit}
                    >
                      Reset
                    </button>
                  )}

                  {coverUrl && (
                    <button
                      className="text-muted"
                      style={{ textDecoration: "underline" }}
                      onClick={() => void deleteCover()}
                      disabled={coverState.busy}
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
              {coverState.message ? (
                <div className="text-muted" style={{ marginTop: "var(--space-sm)" }}>
                  {coverState.error ? `${coverState.message} (${coverState.error})` : coverState.message}
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    );
  }
);

export default CoverEditorSection;
