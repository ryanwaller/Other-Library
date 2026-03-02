"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect, type MouseEvent } from "react";
import CoverImage, { type CoverCrop } from "../../../components/CoverImage";

export type BookCardViewMode = "grid" | "list";

export default function BookCard({
  viewMode,
  bulkMode,
  selected,
  onToggleSelected,
  title,
  authors,
  isbn13,
  tags,
  copiesCount,
  href,
  coverUrl,
  cropData,
  originalSrc,
  onDeleteCopy,
  deleteState,
  hideCopyCount,
  showDeleteCopy = true,
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
  cropData?: CoverCrop | null;
  originalSrc?: string | null;
  onDeleteCopy: () => void;
  deleteState: { busy: boolean; error: string | null; message: string | null } | undefined;
  hideCopyCount?: boolean;
  showDeleteCopy?: boolean;
  gridCols?: number;
}) {
  const router = useRouter();
  const openAuthorFilter = (event: MouseEvent, author: string) => {
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

  const authorLine = truncatedAuthors.length > 0 ? truncatedAuthors.join(", ") : "";

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
        <Link href={href} style={{ display: "block", textDecoration: "none" }} className="om-book-card-link">
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
          {tags.length > 0 ? (
            <div className="muted" style={{ marginTop: 6 }}>
              {tags.slice(0, 6).map((t, idx) => (
                <span key={t}>
                  <Link href={`/app?tag=${encodeURIComponent(t)}`}>{t}</Link>
                  {idx < Math.min(tags.length, 6) - 1 ? <span>, </span> : null}
                </span>
              ))}
            </div>
          ) : null}
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 10 }}>
            {showDeleteCopy ? (
              <>
                <button onClick={onDeleteCopy} disabled={deleteState?.busy ?? false} title="Deletes one copy">
                  Delete copy
                </button>
                <span className="muted">{deleteState?.message ? (deleteState?.error ? `${deleteState?.message} (${deleteState?.error})` : deleteState?.message) : ""}</span>
              </>
            ) : null}
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
            {authorLine ? (
              <div className="muted" style={{ marginTop: 6 }}>
                {authorLine}
              </div>
            ) : null}

            {showDeleteCopy ? (
              <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
                <span className="muted">{deleteState?.message ? (deleteState?.error ? `${deleteState?.message} (${deleteState?.error})` : deleteState?.message) : ""}</span>
                <button onClick={onDeleteCopy} disabled={deleteState?.busy ?? false} title="Deletes one copy">
                  Delete copy
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div
          className="om-book-card-link"
          style={{ display: "block", color: "inherit", cursor: "pointer" }}
          role="link"
          tabIndex={0}
          onClick={() => router.push(href)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              router.push(href);
            }
          }}
        >
          {coverEl}
          <div style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <span className="om-book-title">{title}</span>
            </div>
            {authorLine ? (
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
        </div>
      )}
    </div>
  );
}
