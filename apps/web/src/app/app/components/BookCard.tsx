"use client";

import Link from "next/link";

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
  publisher,
  publishYear,
  copiesCount,
  href,
  coverUrl,
  coverHeight,
  onDeleteCopy,
  deleteState,
  hideCopyCount,
  showDeleteCopy = true
}: {
  viewMode: BookCardViewMode;
  bulkMode: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  title: string;
  authors: string[];
  isbn13: string | null;
  tags: string[];
  publisher: string | null;
  publishYear: string | null;
  copiesCount: number;
  href: string;
  coverUrl: string | null;
  coverHeight: number;
  onDeleteCopy: () => void;
  deleteState: { busy: boolean; error: string | null; message: string | null } | undefined;
  hideCopyCount?: boolean;
  showDeleteCopy?: boolean;
}) {
  const coverEl = (
    <div className="om-cover-slot" style={{ height: coverHeight }}>
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={title} src={coverUrl} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
      ) : (
        <div style={{ width: "100%", height: "100%" }} />
      )}
    </div>
  );

  if (viewMode === "list") {
    return (
      <div className="card" style={{ display: "grid", gridTemplateColumns: bulkMode ? "26px 70px 1fr" : "70px 1fr", gap: 12, alignItems: "start" }}>
        {bulkMode ? <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label="Select book" /> : null}
        <Link href={href} style={{ display: "block", textDecoration: "none" }} className="om-book-card-link">
          <div className="om-cover-slot" style={{ width: 70, height: 70 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {coverUrl ? <img alt={title} src={coverUrl} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <div style={{ width: "100%", height: "100%" }} />}
          </div>
        </Link>
        <div>
          <div>
            <Link href={href} className="om-book-card-link">
              <span className="om-book-title">{title}</span>
            </Link>{" "}
            {!hideCopyCount ? <span className="muted">{copiesCount > 1 ? `(${copiesCount})` : ""}</span> : null}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            {authors.length > 0 ? (
              <>
                {authors.map((a, idx) => (
                  <span key={a}>
                    <Link href={`/app?author=${encodeURIComponent(a)}`}>{a}</Link>
                    {idx < authors.length - 1 ? <span>, </span> : null}
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

  const authorLine = authors.length > 0 ? authors.join(", ") : "";
  const pubBits = [publisher?.trim() || "", publishYear?.trim() || ""].filter(Boolean);
  const pubLine = pubBits.length > 0 ? pubBits.join(" · ") : "";

  return (
    <div className="card om-book-card">
      {bulkMode ? (
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label="Select book" />
          {!hideCopyCount ? <span className="muted">{copiesCount > 1 ? `(${copiesCount})` : ""}</span> : null}
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
              {!hideCopyCount ? <span className="muted">{copiesCount > 1 ? `(${copiesCount})` : ""}</span> : null}
            </div>
            {authorLine ? (
              <div className="muted" style={{ marginTop: 6 }}>
                {authorLine}
              </div>
            ) : null}
            {pubLine ? (
              <div className="muted" style={{ marginTop: 6 }}>
                {pubLine}
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
        <Link href={href} className="om-book-card-link" style={{ display: "block", color: "inherit" }}>
          {coverEl}
          <div style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <span className="om-book-title">{title}</span>
              {!hideCopyCount ? <span className="muted">{copiesCount > 1 ? `(${copiesCount})` : ""}</span> : null}
            </div>
            {authorLine ? (
              <div className="om-book-secondary">{authorLine}</div>
            ) : null}
            {pubLine ? (
              <div className="muted" style={{ marginTop: 6 }}>
                {pubLine}
              </div>
            ) : null}
          </div>
        </Link>
      )}
    </div>
  );
}
