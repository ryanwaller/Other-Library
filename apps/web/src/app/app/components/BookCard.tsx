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
  onDeleteCopy,
  deleteState,
  hideCopyCount,
  gridCols
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
  onDeleteCopy: () => void;
  deleteState: { busy: boolean; error: string | null; message: string | null } | undefined;
  hideCopyCount?: boolean;
  showDeleteCopy?: boolean;
  gridCols?: number;
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
      return [`${authors[0]} + more`];
    }
    return authors;
  }, [gridCols, authors, isMobile]);

  const coverEl = (
    <div className="om-cover-slot" style={{ height: "auto", width: "100%" }}>
      <CoverImage
        alt={title}
        src={originalSrc ?? coverUrl}
        cropData={cropData}
        style={{ display: "block", width: "100%", height: "auto" }}
        objectFit="contain"
      />
    </div>
  );

  if (viewMode === "list") {
    return (
      <div className="card" style={{ display: "grid", gridTemplateColumns: bulkMode ? "26px 70px 1fr" : "70px 1fr", gap: 12, alignItems: "start" }}>
        {bulkMode ? <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label="Select book" /> : null}
        <Link href={href} style={{ display: "block" }} className="om-book-card-link">
          <div className="om-cover-slot" style={{ width: 70, height: "auto" }}>
            <CoverImage alt={title} src={originalSrc ?? coverUrl} cropData={cropData} style={{ width: "100%", height: "auto" }} objectFit="contain" />
          </div>
        </Link>
        <div>
          <div>
            <Link href={href} className="om-book-card-link">
              <span className="om-book-title">{title}</span>
            </Link>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            {truncatedAuthors.length > 0 ? (
              <>
                {truncatedAuthors.map((a, idx) => (
                  <span key={a}>
                    {isMobile && a === "+ more" ? (
                      <span className="muted">{a}</span>
                    ) : (
                      <Link
                        href={`/app?author=${encodeURIComponent(a)}`}
                        onClick={(e) => openAuthorFilter(e, a)}
                      >
                        {a}
                      </Link>
                    )}
                    {idx < truncatedAuthors.length - 1 ? <span>, </span> : null}
                  </span>
                ))}
              </>
            ) : (
              isbn13 || ""
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card om-book-card">
      {bulkMode ? (
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label="Select book" />
        </div>
      ) : null}

      {bulkMode ? (
        <>
          <Link href={href} style={{ display: "block", textDecoration: "none" }} className="om-book-card-link">
            {coverEl}
          </Link>
          <div style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <Link href={href} style={{ textDecoration: "none" }} className="om-book-card-link">
                <span className="om-book-title">{title}</span>
              </Link>
            </div>
            {authors.length > 0 ? (
              <div className="om-book-secondary">
                {truncatedAuthors.map((author, index) => (
                  <span key={author}>
                    {gridCols === 8 && authors.length > 1 ? (
                      <span>{author}</span>
                    ) : isMobile && author === "+ more" ? (
                      <span className="muted">{author}</span>
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
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <Link href={href} style={{ display: "block", textDecoration: "none" }} className="om-book-card-link">
            {coverEl}
          </Link>
          <div style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <Link href={href} style={{ textDecoration: "none" }} className="om-book-card-link">
                <span className="om-book-title">{title}</span>
              </Link>
            </div>
            {truncatedAuthors.length > 0 ? (
              <div className="om-book-secondary">
                {truncatedAuthors.map((author, index) => (
                  <span key={author}>
                    {gridCols === 8 && authors.length > 1 ? (
                      <span>{author}</span>
                    ) : isMobile && author === "+ more" ? (
                      <span className="muted">{author}</span>
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
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
