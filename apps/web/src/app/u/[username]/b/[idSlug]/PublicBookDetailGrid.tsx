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

  return (
    <div
      className="om-book-detail-grid"
      style={coverExpanded ? { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" } : undefined}
    >
      <div>
        <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
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
  );
}
