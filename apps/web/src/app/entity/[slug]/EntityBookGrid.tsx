"use client";

import Link from "next/link";
import CoverImage, { type CoverCrop } from "../../../components/CoverImage";
import { RELATED_ITEMS_GRID_MIN_WIDTH } from "../../../lib/grid";

export type GridItem = {
  id: number;
  title: string;
  secondaryLine?: string | null;
  tertiaryLine?: string | null;
  owner?: {
    username: string;
    href: string;
    avatarUrl: string | null;
    prefix?: string | null;
  } | null;
  coverUrl: string | null;
  coverCrop: CoverCrop | null;
  href: string | null;
};

export default function EntityBookGrid({
  items,
  gridClassName = "om-related-items-grid",
}: {
  items: GridItem[];
  gridClassName?: string;
}) {
  return (
    <div
      className={gridClassName}
      style={{ marginTop: "var(--space-14)", ["--om-related-items-grid-min" as any]: `${RELATED_ITEMS_GRID_MIN_WIDTH}px` }}
    >
      {items.map((item) => {
        const ownerRow = item.owner ? (
          <div
            className="om-avatar-lockup om-avatar-lockup-tight text-muted"
            style={{ marginTop: "var(--space-4)", ["--avatar-size" as any]: "18px" }}
          >
            <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.owner.prefix ? (
                <span className="text-muted" style={{ marginRight: 6 }}>
                  {item.owner.prefix}
                </span>
              ) : null}
              <Link href={item.owner.href} className="om-avatar-link" aria-label={item.owner.username} style={{ marginRight: 6 }}>
                {item.owner.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={item.owner.avatarUrl} className="om-avatar-img" />
                ) : (
                  <div className="om-avatar-img" style={{ background: "var(--bg-muted)" }} />
                )}
              </Link>
              <Link href={item.owner.href} style={{ textDecoration: "none", color: "inherit" }}>
                {item.owner.username}
              </Link>
            </div>
          </div>
        ) : null;

        const inner = (
          <>
            {item.href ? (
              <Link href={item.href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
                  <CoverImage
                    alt={item.title}
                    src={item.coverUrl}
                    cropData={item.coverCrop}
                    style={{ display: "block", width: "100%", height: "auto" }}
                    objectFit="contain"
                  />
                </div>
              </Link>
            ) : (
              <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
                <CoverImage
                  alt={item.title}
                  src={item.coverUrl}
                  cropData={item.coverCrop}
                  style={{ display: "block", width: "100%", height: "auto" }}
                  objectFit="contain"
                />
              </div>
            )}
            <div style={{ marginTop: "var(--space-sm)" }}>
              {item.href ? (
                <Link href={item.href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                  <span className="om-book-title">{item.title}</span>
                </Link>
              ) : (
                <span className="om-book-title">{item.title}</span>
              )}
              {item.secondaryLine ? (
                <div className="text-muted" style={{ marginTop: "var(--space-4)" }}>
                  {item.secondaryLine}
                </div>
              ) : null}
              {item.tertiaryLine ? (
                <div className="text-muted" style={{ marginTop: "var(--space-4)" }}>
                  {item.tertiaryLine}
                </div>
              ) : null}
              {ownerRow}
            </div>
          </>
        );
        return (
          <div key={item.id}>
            {item.href && !item.owner ? (
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
