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
  copiesCount: number;
  href: string;
  coverUrl: string | null;
  coverHeight: number;
  onDeleteCopy: () => void;
  deleteState: { busy: boolean; error: string | null; message: string | null } | undefined;
  hideCopyCount?: boolean;
  showDeleteCopy?: boolean;
}) {
  const coverEl = coverUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={title}
      src={coverUrl}
      style={{ display: "block", width: "100%", height: coverHeight, objectFit: "contain", border: "1px solid var(--border)" }}
    />
  ) : (
    <div style={{ width: "100%", height: coverHeight, border: "1px solid var(--border)" }} />
  );

  if (viewMode === "list") {
    return (
      <div className="card" style={{ display: "grid", gridTemplateColumns: bulkMode ? "26px 70px 1fr" : "70px 1fr", gap: 12, alignItems: "start" }}>
        {bulkMode ? <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label="Select book" /> : null}
        <Link href={href} style={{ display: "block" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {coverUrl ? (
            <img alt={title} src={coverUrl} style={{ width: 70, height: 70, objectFit: "cover", border: "1px solid var(--border)" }} />
          ) : (
            <div style={{ width: 70, height: 70, border: "1px solid var(--border)" }} />
          )}
        </Link>
        <div>
          <div>
            <Link href={href}>{title}</Link>{" "}
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
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {tags.slice(0, 6).map((t) => (
                <span key={t} style={{ border: "1px solid var(--border)", padding: "2px 6px" }}>
                  <Link href={`/app?tag=${encodeURIComponent(t)}`} style={{ textDecoration: "none" }}>
                    {t}
                  </Link>
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
    <div className="card">
      {bulkMode ? (
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label="Select book" />
          {!hideCopyCount ? <span className="muted">{copiesCount > 1 ? `(${copiesCount})` : ""}</span> : null}
        </div>
      ) : null}
      <Link href={href} style={{ display: "block" }}>
        {coverEl}
      </Link>
      <div style={{ marginTop: 8 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
          <Link href={href}>{title}</Link>
          {!bulkMode && !hideCopyCount ? <span className="muted">{copiesCount > 1 ? `(${copiesCount})` : ""}</span> : null}
        </div>
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
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {tags.slice(0, 6).map((t) => (
            <span key={t} style={{ border: "1px solid var(--border)", padding: "2px 6px" }}>
              <Link href={`/app?tag=${encodeURIComponent(t)}`} style={{ textDecoration: "none" }}>
                {t}
              </Link>
            </span>
          ))}
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
        <Link href={href} className="muted">
          Details
        </Link>
        {showDeleteCopy ? (
          <button onClick={onDeleteCopy} disabled={deleteState?.busy ?? false} title="Deletes one copy">
            Delete copy
          </button>
        ) : null}
      </div>
      {showDeleteCopy && deleteState?.message ? (
        <div className="muted" style={{ marginTop: 6 }}>
          {deleteState?.error ? `${deleteState?.message} (${deleteState?.error})` : deleteState?.message}
        </div>
      ) : null}
    </div>
  );
}
