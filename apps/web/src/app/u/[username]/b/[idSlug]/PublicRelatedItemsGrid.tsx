"use client";

import Link from "next/link";
import { useState } from "react";
import CoverImage, { type CoverCrop } from "../../../../../components/CoverImage";

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
  rows
}: {
  heading: string;
  rows: PublicRelatedItemRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, 4);
  const showPager = rows.length > 4;

  return (
    <>
      <hr className="divider" />
      <div style={{ marginTop: "var(--space-lg)" }}>
        <div>{heading}</div>
        <div className="om-related-items-grid" style={{ marginTop: "var(--space-14)" }}>
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
