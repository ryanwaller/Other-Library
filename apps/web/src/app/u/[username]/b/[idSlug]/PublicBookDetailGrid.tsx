"use client";

import { useState } from "react";
import CoverImage, { type CoverCrop } from "../../../../../components/CoverImage";

export default function PublicBookDetailGrid({
  coverSrc,
  cropData,
  effectiveTitle,
  children,
}: {
  coverSrc: string | null;
  cropData: CoverCrop | null;
  effectiveTitle: string;
  children: React.ReactNode;
}) {
  const [coverExpanded, setCoverExpanded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

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
            onClick={coverSrc ? () => setLightboxOpen(true) : undefined}
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

      {lightboxOpen && coverSrc ? (
        <div
          style={{
            position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
            background: "rgba(0,0,0,0.85)", zIndex: 2000,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}
          onClick={() => setLightboxOpen(false)}
        >
          <div
            style={{
              position: "absolute", top: 24, right: 24,
              color: "#fff", cursor: "pointer",
              fontSize: 14, textDecoration: "underline"
            }}
            onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}
          >
            Close
          </div>

          <div
            style={{
              position: "relative", width: "calc(100% - 64px)", height: "calc(100% - 64px)",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverSrc}
              alt={effectiveTitle}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
