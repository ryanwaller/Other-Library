"use client";

import Link from "next/link";
import CoverImage, { type CoverCrop } from "../../../components/CoverImage";
import { RELATED_ITEMS_GRID_MIN_WIDTH } from "../../../lib/grid";

export type GridItem = {
  id: number;
  title: string;
  secondaryLine?: string | null;
  coverUrl: string | null;
  coverCrop: CoverCrop | null;
  href: string | null;
};

export default function EntityBookGrid({ items }: { items: GridItem[] }) {
  return (
    <div
      className="om-related-items-grid"
      style={{ marginTop: "var(--space-14)", ["--om-related-items-grid-min" as any]: `${RELATED_ITEMS_GRID_MIN_WIDTH}px` }}
    >
      {items.map((item) => {
        const inner = (
          <>
            <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
              <CoverImage
                alt={item.title}
                src={item.coverUrl}
                cropData={item.coverCrop}
                style={{ display: "block", width: "100%", height: "auto" }}
                objectFit="contain"
              />
            </div>
            <div style={{ marginTop: "var(--space-sm)" }}>
              <span className="om-book-title">{item.title}</span>
              {item.secondaryLine ? (
                <div className="text-muted" style={{ marginTop: "var(--space-4)" }}>
                  {item.secondaryLine}
                </div>
              ) : null}
            </div>
          </>
        );
        return (
          <div key={item.id}>
            {item.href ? (
              <Link href={item.href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                {inner}
              </Link>
            ) : (
              <div>{inner}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
