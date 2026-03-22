"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import CoverImage from "../../../components/CoverImage";
import { denseListFieldsFor } from "../../../lib/book";
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

      <div className="om-dense-list-thumb">
        <div className="om-dense-list-thumb-frame" style={{ borderRadius: coverRadius }}>
          <CoverImage
            alt={fields.primaryTitle}
            src={originalSrc ?? coverUrl}
            cropData={cropData}
            style={{ display: "block", width: "100%", aspectRatio: "3 / 4" }}
            objectFit="contain"
            sizes="40px"
          />
        </div>
      </div>

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
