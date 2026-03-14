"use client";

import { useEffect, useMemo, useState } from "react";
import CoverImage, { type CoverCrop } from "../../../../../components/CoverImage";

type ImageMedia = {
  id: number;
  storage_path: string;
};

export default function PublicBookDetailGrid({
  coverSrc,
  cropData,
  effectiveTitle,
  images,
  signedMap,
  children,
}: {
  coverSrc: string | null;
  cropData: CoverCrop | null;
  effectiveTitle: string;
  images: ImageMedia[];
  signedMap: Record<string, string>;
  children: React.ReactNode;
}) {
  const [coverExpanded, setCoverExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const galleryItems = useMemo(() => {
    const out: Array<{ url: string; alt: string }> = [];
    if (coverSrc) out.push({ url: coverSrc, alt: effectiveTitle });
    for (const image of images) {
      const url = signedMap[image.storage_path];
      if (url) out.push({ url, alt: "" });
    }
    return out;
  }, [coverSrc, effectiveTitle, images, signedMap]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowLeft") setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : galleryItems.length - 1));
      if (e.key === "ArrowRight") setLightboxIndex((prev) => (prev !== null && prev < galleryItems.length - 1 ? prev + 1 : 0));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxIndex, galleryItems.length]);

  return (
    <>
      <div
        className="om-book-detail-grid"
        style={coverExpanded ? { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" } : undefined}
      >
        <div>
          <div
            className="om-cover-slot"
            style={{ width: "100%", height: "auto", cursor: coverSrc ? "pointer" : undefined }}
            onClick={coverSrc ? () => setLightboxIndex(0) : undefined}
          >
          <CoverImage
            alt={effectiveTitle}
            src={coverSrc}
            cropData={cropData}
            style={{ width: "100%", height: "auto", display: "block" }}
            objectFit="contain"
          />
          </div>
          {coverSrc ? (
            <div style={{ marginTop: "var(--space-sm)" }}>
              <button
                className="text-muted no-underline"
                onClick={() => setCoverExpanded((prev) => !prev)}
              >
                {coverExpanded ? "Smaller" : "Bigger"}
              </button>
            </div>
          ) : null}
        </div>
        {children}
      </div>

      {images.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <hr className="om-hr" style={{ marginBottom: 16 }} />
          <div className="text-muted">
            Images
          </div>
          <div className="om-images-grid" style={{ marginTop: "var(--space-10)" }}>
            {images.map((m, idx) => {
              const url = signedMap[m.storage_path];
              return (
                <div key={m.id} onClick={() => setLightboxIndex((coverSrc ? 1 : 0) + idx)} style={{ cursor: url ? "pointer" : undefined }}>
                  {url ? (
                    <div className="om-cover-slot" style={{ width: "100%", height: "auto", padding: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" src={url} style={{ width: "100%", height: "auto", objectFit: "contain", display: "block" }} />
                    </div>
                  ) : (
                    <div className="om-cover-slot" style={{ width: "100%", height: "auto", padding: 0 }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {lightboxIndex !== null && galleryItems[lightboxIndex] ? (
        <div
          style={{
            position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
            background: "rgba(0,0,0,0.85)", zIndex: 2000,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}
          onClick={() => setLightboxIndex(null)}
        >
          <div
            style={{
              position: "absolute", top: 24, right: 24,
              color: "#fff", cursor: "pointer",
              fontSize: 14, textDecoration: "underline"
            }}
            onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
          >
            Close
          </div>

          {galleryItems.length > 1 ? (
            <>
              <div
                style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "25%", cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : galleryItems.length - 1));
                }}
              />
              <div
                style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "25%", cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev !== null && prev < galleryItems.length - 1 ? prev + 1 : 0));
                }}
              />
            </>
          ) : null}

          <div
            style={{
              position: "relative", width: "calc(100% - 64px)", height: "calc(100% - 64px)",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={galleryItems[lightboxIndex].url}
              alt={galleryItems[lightboxIndex].alt}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
