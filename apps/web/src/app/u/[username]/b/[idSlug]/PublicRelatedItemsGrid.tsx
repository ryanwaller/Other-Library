"use client";

import Link from "next/link";
import { useState } from "react";
import CoverImage, { type CoverCrop } from "../../../../../components/CoverImage";
import { RELATED_ITEMS_GRID_MIN_WIDTH } from "../../../../../lib/grid";

export type PublicRelatedItemRow = {
  id: number;
  href: string;
  title: string;
  secondaryLine?: string | null;
  coverUrl: string | null;
  coverCrop: CoverCrop | null;
};

export default function PublicRelatedItemsGrid({
  heading,
  rows,
  moreHref = null,
}: {
  heading: string;
  rows: PublicRelatedItemRow[];
  moreHref?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, 4);
  const showMoreLink = rows.length > 4 && !!moreHref;
  const showPager = rows.length > 4 && !moreHref;

  return (
    <>
      <hr className="divider" />
      <div style={{ marginTop: "var(--space-lg)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
          <div style={{ minWidth: 0, flex: 1 }}>{heading}</div>
          {showMoreLink ? (
            <Link href={moreHref!} className="text-muted" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
              More
            </Link>
          ) : null}
        </div>
        <div
          className="om-related-items-grid om-related-items-mobile-grid"
          style={{ marginTop: "var(--space-14)", ["--om-related-items-grid-min" as any]: `${RELATED_ITEMS_GRID_MIN_WIDTH}px` }}
        >
          {visibleRows.map((row) => (
            <div key={row.id}>
              <Link href={row.href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
                  <CoverImage alt={row.title} src={row.coverUrl} cropData={row.coverCrop} style={{ display: "block", width: "100%", height: "auto" }} objectFit="contain" />
                </div>
              </Link>
              <div style={{ marginTop: "var(--space-sm)" }}>
                <Link href={row.href} style={{ color: "inherit", textDecoration: "none" }}>
                  <span className="om-book-title">{row.title}</span>
                </Link>
                {row.secondaryLine ? (
                  <div className="text-muted" style={{ marginTop: "var(--space-xs)" }}>{row.secondaryLine}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {showPager ? (
          <div className="row" style={{ marginTop: "var(--space-md)", justifyContent: "center" }}>
            <button className="text-muted" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "See less" : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
