"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect, type MouseEvent } from "react";
import CoverImage from "../../../components/CoverImage";
import type { CatalogItem } from "../../../lib/types";
import { effectiveTitleFor } from "../../../lib/book";
import { resizeCoverUrl } from "../../../lib/coverUrl";
import DenseListRow from "./DenseListRow";

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
  secondaryMode = "authors",
  roundedCover = false,
  wishlistMatchSummary = null,
  showWishlistMatchSummary = true,
  item,
  utilityLabel = null,
  isLastRow = false
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
  roundedCover?: boolean;
  item?: CatalogItem;
  utilityLabel?: string | null;
  isLastRow?: boolean;
  wishlistMatchSummary?: {
    followedCount: number;
    followedUsernames: string[];
    publicCount: number;
    publicUsernames: string[];
  } | null;
  showWishlistMatchSummary?: boolean;
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
    if ((gridCols ?? 0) >= 8 && authors.length > 1) {
      return [authors[0], "+ more"];
    }
    return authors;
  }, [gridCols, authors, isMobile]);

  const gridSizes = isMobile
    ? "50vw"
    : (gridCols ?? 6) >= 8
      ? "(max-width: 1100px) 15vw, 12vw"
      : (gridCols ?? 6) >= 6
        ? "(max-width: 1100px) 20vw, 17vw"
        : "(max-width: 1100px) 30vw, 25vw";

  // Target resize width (2x DPR headroom). Skip resize when cropData.mode="transform"
  // because the CSS transform math relies on the image's natural pixel dimensions.
  const gridResizeWidth = isMobile ? 400 : (gridCols ?? 6) >= 8 ? 300 : (gridCols ?? 6) >= 6 ? 400 : 600;
  const rawGridSrc = originalSrc ?? coverUrl;
  const gridSrc = cropData?.mode === "transform" ? rawGridSrc : resizeCoverUrl(rawGridSrc, gridResizeWidth);

  const coverEl = (
    <div className="om-cover-slot" style={{ height: "auto", width: "100%", borderRadius: roundedCover ? 24 : 0, overflow: roundedCover ? "hidden" : "visible" }}>
      <CoverImage
        alt={title}
        src={gridSrc}
        cropData={cropData}
        style={{ display: "block", width: "100%", height: "auto" }}
        objectFit="contain"
        sizes={gridSizes}
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

  const wishlistMatchLine = useMemo(() => {
    if (!showWishlistMatchSummary) return null;
    if (!wishlistMatchSummary) return null;
    if (wishlistMatchSummary.followedCount > 1) return `Owned by ${wishlistMatchSummary.followedCount} people you follow`;
    if (wishlistMatchSummary.followedCount === 1) return `In ${wishlistMatchSummary.followedUsernames[0]}'s library`;
    if (wishlistMatchSummary.publicCount > 0) return `In ${wishlistMatchSummary.publicUsernames[0]}'s library`;
    return null;
  }, [showWishlistMatchSummary, wishlistMatchSummary]);

  if (viewMode === "list") {
    const rowItem = item ?? ({
      id: 0,
      library_id: 0,
      visibility: "public",
      title_override: title,
      subtitle_override: null,
      authors_override: authors,
      subjects_override: [],
      publisher_override: null,
      edition: null,
      media: [],
      cover_original_url: null,
      cover_crop: cropData ?? null
    } as CatalogItem);

    return (
      <DenseListRow
        item={rowItem}
        href={!bulkMode && href ? href : undefined}
        coverUrl={coverUrl}
        originalSrc={originalSrc}
        cropData={cropData}
        roundedCover={roundedCover}
        utilityLabel={utilityLabel}
        leadingControl={
          bulkMode ? <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label="Select book" /> : undefined
        }
        isLastRow={isLastRow}
        onOpen={onOpen}
      />
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
            {wishlistMatchLine ? <div className="text-muted" style={{ marginTop: "var(--space-xs)" }}>{wishlistMatchLine}</div> : null}
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
            {wishlistMatchLine ? <div className="text-muted" style={{ marginTop: "var(--space-xs)" }}>{wishlistMatchLine}</div> : null}
          </div>
        </>
      )}
    </div>
  );
}
