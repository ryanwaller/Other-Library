"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect, type MouseEvent } from "react";
import CoverImage from "../../../components/CoverImage";
import type { CatalogItem } from "../../../lib/types";
import { effectiveTitleFor } from "../../../lib/book";

export type BookCardViewMode = "grid" | "list";

export default function BookCard({
  viewMode,
  bulkMode,
  selected,
  onToggleSelected,
  title,
  authors,
  isbn13,
  href,
  coverUrl,
  cropData,
  originalSrc,
  onOpen,
  onDeleteCopy,
  deleteState,
  hideCopyCount,
  gridCols,
  secondaryMode = "authors"
}: {
  viewMode: BookCardViewMode;
  bulkMode: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  title: string;
  authors: string[];
  isbn13: string | null;
  tags: string[];
  copiesCount: number;
  href: string;
  coverUrl: string | null;
  cropData?: any | null;
  originalSrc?: string | null;
  onOpen?: () => void;
  onDeleteCopy: () => void;
  deleteState: { busy: boolean; error: string | null; message: string | null } | undefined;
  hideCopyCount?: boolean;
  showDeleteCopy?: boolean;
  gridCols?: number;
  secondaryMode?: "authors" | "plain";
}) {
  const router = useRouter();

  function openAuthorFilter(event: MouseEvent | React.KeyboardEvent, author: string) {
    event.preventDefault();
    event.stopPropagation();
    router.push(`/app?author=${encodeURIComponent(author)}`);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  };

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const truncatedAuthors = useMemo(() => {
    if (isMobile && authors.length > 2) {
      return [...authors.slice(0, 2), "+ more"];
    }
    if (gridCols === 8 && authors.length > 1) {
      return [authors[0], "+ more"];
    }
    return authors;
  }, [gridCols, authors, isMobile]);

  const effectiveCols = isMobile ? Math.min(gridCols ?? 4, 2) : (gridCols ?? 4);
  const coverSizes = viewMode === "list"
    ? "70px"
    : effectiveCols === 8 ? "calc(12.5vw - 11px)"
    : effectiveCols === 4 ? "calc(25vw - 9px)"
    : effectiveCols === 2 ? "calc(50vw - 6px)"
    : "100vw";

  const coverEl = (
    <div className="om-cover-slot" style={{ height: "auto", width: "100%" }}>
      <CoverImage
        alt={title}
        src={originalSrc ?? coverUrl}
        cropData={cropData}
        style={{ display: "block", width: "100%", height: "auto" }}
        objectFit="contain"
        sizes={coverSizes}
      />
    </div>
  );

  function renderSecondaryText() {
    if (truncatedAuthors.length === 0) return null;
    if (secondaryMode === "plain") {
      return (
        <>
          {truncatedAuthors.map((author, index) => (
            <span key={`${author}-${index}`}>
              <span className="text-muted">{author}</span>
              {index < truncatedAuthors.length - 1 ? <span>, </span> : null}
            </span>
          ))}
        </>
      );
    }
    return (
      <>
        {truncatedAuthors.map((author, index) => (
          <span key={author}>
            {author === "+ more" ? (
              <span className="text-muted">{author}</span>
            ) : (
              <Link
                href={`/app?author=${encodeURIComponent(author)}`}
                onClick={(e) => openAuthorFilter(e, author)}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {author}
              </Link>
            )}
            {index < truncatedAuthors.length - 1 ? <span>, </span> : null}
          </span>
        ))}
      </>
    );
  }

  if (viewMode === "list") {
    return (
      <div className="card" style={{ display: "grid", gridTemplateColumns: bulkMode ? "26px 70px 1fr" : "70px 1fr", gap: "var(--space-md)", alignItems: "start" }}>
        {bulkMode ? <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label="Select book" /> : null}
        <Link href={href} style={{ display: "block" }} className="om-book-card-link" onClick={onOpen}>
          <div className="om-cover-slot" style={{ width: 70, height: "auto" }}>
            <CoverImage alt={title} src={originalSrc ?? coverUrl} cropData={cropData} style={{ width: "100%", height: "auto" }} objectFit="contain" sizes={coverSizes} />
          </div>
        </Link>
        <div>
          <div>
            <Link href={href} className="om-book-card-link" style={{ color: "inherit", textDecoration: "none" }} onClick={onOpen}>
              <span className="om-book-title">{title}</span>
            </Link>
          </div>
          <div className="text-muted" style={{ marginTop: 4 }}>
            {renderSecondaryText()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="om-book-card">
      {bulkMode ? (
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-xs)" }}>
          <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label="Select book" />
        </div>
      ) : null}

      {bulkMode ? (
        <>
          <Link href={href} style={{ display: "block", textDecoration: "none" }} className="om-book-card-link" onClick={onOpen}>
            {coverEl}
          </Link>
          <div style={{ marginTop: "var(--space-md)" }}>
            <div style={{ width: "100%" }}>
              <Link href={href} style={{ color: "inherit", textDecoration: "none" }} className="om-book-card-link" onClick={onOpen}>
                <span className="om-book-title">{title}</span>
              </Link>
            </div>
            {authors.length > 0 ? (
              <div className="om-book-secondary">
                {renderSecondaryText()}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <Link href={href} style={{ display: "block", textDecoration: "none" }} className="om-book-card-link" onClick={onOpen}>
            {coverEl}
          </Link>
          <div style={{ marginTop: "var(--space-14)" }}>
            <div style={{ width: "100%" }}>
              <Link href={href} style={{ color: "inherit", textDecoration: "none" }} className="om-book-card-link" onClick={onOpen}>
                <span className="om-book-title">{title}</span>
              </Link>
            </div>
            {truncatedAuthors.length > 0 ? (
              <div className="om-book-secondary">
                {renderSecondaryText()}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
