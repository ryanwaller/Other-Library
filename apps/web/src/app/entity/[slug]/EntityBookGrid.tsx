"use client";

import Link from "next/link";
import CoverImage, { type CoverCrop } from "../../../components/CoverImage";

export type GridItem = {
  id: number;
  title: string;
  coverUrl: string | null;
  coverCrop: CoverCrop | null;
  href: string | null;
};

export default function EntityBookGrid({ items }: { items: GridItem[] }) {
  return (
    <div className="om-related-items-grid" style={{ marginTop: "var(--space-14)" }}>
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
