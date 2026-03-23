"use client";

import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import CoverImage from "../../../components/CoverImage";
import { denseListFieldsFor } from "../../../lib/book";
import { resizeCoverUrl } from "../../../lib/coverUrl";
import type { PublicBook } from "../../../lib/types";

type DenseListRowProps = {
  item: PublicBook;
  href?: string;
  coverUrl: string | null;
  cropData?: any | null;
  originalSrc?: string | null;
  roundedCover?: boolean;
  utilityLabel?: string | null;
  leadingControl?: React.ReactNode;
  trailingAction?: React.ReactNode;
  trailingActionWidth?: number;
  isLastRow?: boolean;
  onOpen?: () => void;
};

export default function DenseListRow({
  item,
  href,
  coverUrl,
  cropData,
  originalSrc,
  roundedCover = false,
  utilityLabel = null,
  leadingControl,
  trailingAction,
  trailingActionWidth = 40,
  isLastRow = false,
  onOpen
}: DenseListRowProps) {
  const fields = denseListFieldsFor(item);
  const isClickable = Boolean(href);
  const hasLeading = Boolean(leadingControl);
  const hasTrailing = Boolean(trailingAction);
  const coverRadius = roundedCover ? 12 : 0;

  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  // Pre-resize both URLs so the browser always loads the right size.
  const thumbSrc = resizeCoverUrl(coverUrl, 80);
  const hoverSrc = resizeCoverUrl(originalSrc ?? coverUrl, 200);

  function handleThumbMouseMove(e: React.MouseEvent) {
    setHoverPos({ x: e.clientX, y: e.clientY });
  }

  function handleThumbMouseLeave() {
    setHoverPos(null);
  }

  return (
    <div
      className="om-dense-list-row"
      style={
        {
          ["--dense-leading" as string]: hasLeading ? "28px" : "0px",
          ["--dense-action" as string]: hasTrailing ? `${trailingActionWidth}px` : "0px"
        } as CSSProperties
      }
      data-last-row={isLastRow ? "true" : "false"}
    >
      {isClickable ? (
        <Link
          href={href!}
          className="om-dense-list-overlay"
          aria-label={`Open ${fields.primaryTitle}`}
          onClick={onOpen}
        />
      ) : null}

      <div className="om-dense-list-control" data-dense-interactive="true">
        {leadingControl}
      </div>

      <div
        className="om-dense-list-thumb"
        onMouseMove={handleThumbMouseMove}
        onMouseLeave={handleThumbMouseLeave}
        style={{ cursor: thumbSrc ? "default" : undefined }}
      >
        <div className="om-dense-list-thumb-frame" style={{ borderRadius: coverRadius }}>
          <CoverImage
            alt={fields.primaryTitle}
            src={thumbSrc}
            cropData={null}
            style={{ display: "block", width: "100%", aspectRatio: "3 / 4" }}
            objectFit="contain"
            sizes="40px"
          />
        </div>
      </div>

      {hoverPos && hoverSrc && typeof document !== "undefined"
        ? createPortal(
            <div
              style={{
                position: "fixed",
                top: hoverPos.y + 16,
                left: hoverPos.x + 16,
                zIndex: 9999,
                pointerEvents: "none",
                width: 160,
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                borderRadius: 4,
                overflow: "hidden",
                background: "var(--bg-muted, #1a1a1a)"
              }}
            >
              <CoverImage
                alt=""
                src={hoverSrc}
                cropData={cropData}
                style={{ display: "block", width: "100%" }}
                objectFit="contain"
                sizes="160px"
              />
            </div>,
            document.body
          )
        : null}

      <div className="om-dense-list-cell om-dense-list-cell--primary">
        <div className="om-dense-list-title">{fields.primaryTitle}</div>
        {fields.primarySubtitle ? (
          <div className="om-dense-list-subtitle text-muted">{fields.primarySubtitle}</div>
        ) : null}
      </div>

      <div className="om-dense-list-cell om-dense-list-cell--secondary text-muted">
        <span className="om-dense-list-single-line">{fields.secondary ?? fields.mobileSecondary ?? ""}</span>
      </div>

      <div className="om-dense-list-cell om-dense-list-cell--tertiary text-muted">
        <span className="om-dense-list-single-line">{fields.tertiary ?? ""}</span>
      </div>

      <div className="om-dense-list-cell om-dense-list-cell--utility text-muted">
        <span className="om-dense-list-single-line">{utilityLabel ?? ""}</span>
      </div>

      <div className="om-dense-list-cell om-dense-list-cell--action" data-dense-interactive="true">
        {trailingAction}
      </div>
    </div>
  );
}
