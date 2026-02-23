"use client";

import Link from "next/link";

export type BookCardViewMode = "grid" | "list";
export type BookVisibility = "inherit" | "followers_only" | "public" | "mixed";

export type InlineState = { busy: boolean; error: string | null; message: string | null };

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
  visibility,
  onChangeVisibility,
  href,
  coverUrl,
  coverHeight,
  coverInputKey,
  onSelectCover,
  pendingCover,
  coverState,
  onUploadCover,
  onClearCover,
  onDeleteCopy,
  deleteState
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
  visibility: BookVisibility;
  onChangeVisibility: (next: Exclude<BookVisibility, "mixed">) => void;
  href: string;
  coverUrl: string | null;
  coverHeight: number;
  coverInputKey: number;
  onSelectCover: (files: FileList | null) => void;
  pendingCover: File | undefined;
  coverState: InlineState | undefined;
  onUploadCover: () => void;
  onClearCover: () => void;
  onDeleteCopy: () => void;
  deleteState: InlineState | undefined;
}) {
  const coverEl = coverUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={title} src={coverUrl} style={{ width: "100%", height: coverHeight, objectFit: "contain", border: "1px solid var(--border)" }} />
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
            <Link href={href}>{title}</Link> <span className="muted">{copiesCount > 1 ? `(${copiesCount})` : ""}</span>
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
            <span className="muted">Visibility</span>
            <select value={visibility} onChange={(ev) => onChangeVisibility(ev.target.value as any)}>
              {visibility === "mixed" ? (
                <option value="mixed" disabled>
                  mixed
                </option>
              ) : null}
              <option value="inherit">inherit</option>
              <option value="followers_only">followers_only</option>
              <option value="public">public</option>
            </select>
            <span className="muted">Cover</span>
            <input key={coverInputKey} type="file" accept="image/*" onChange={(ev) => onSelectCover(ev.target.files)} />
            {pendingCover ? (
              <>
                <button onClick={onUploadCover} disabled={coverState?.busy ?? false}>
                  {coverState?.busy ? "Uploading…" : "Submit"}
                </button>
                <button onClick={onClearCover} disabled={coverState?.busy ?? false}>
                  Clear
                </button>
              </>
            ) : null}
            <button onClick={onDeleteCopy} disabled={deleteState?.busy ?? false} title="Deletes one copy">
              Delete copy
            </button>
            <span className="muted">{deleteState?.message ? (deleteState?.error ? `${deleteState?.message} (${deleteState?.error})` : deleteState?.message) : ""}</span>
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
          <span className="muted">{copiesCount > 1 ? `(${copiesCount})` : ""}</span>
        </div>
      ) : null}
      <Link href={href} style={{ display: "block" }}>
        {coverEl}
      </Link>
      <div style={{ marginTop: 8 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
          <Link href={href}>{title}</Link>
          {!bulkMode ? <span className="muted">{copiesCount > 1 ? `(${copiesCount})` : ""}</span> : null}
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
        <div className="muted">Visibility</div>
        <select value={visibility} onChange={(ev) => onChangeVisibility(ev.target.value as any)}>
          {visibility === "mixed" ? (
            <option value="mixed" disabled>
              mixed
            </option>
          ) : null}
          <option value="inherit">inherit</option>
          <option value="followers_only">followers_only</option>
          <option value="public">public</option>
        </select>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="muted">Cover override</div>
        <input key={coverInputKey} type="file" accept="image/*" onChange={(ev) => onSelectCover(ev.target.files)} style={{ marginTop: 6 }} />
        {pendingCover ? (
          <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
            <div className="row">
              <button onClick={onUploadCover} disabled={coverState?.busy ?? false}>
                {coverState?.busy ? "Uploading…" : "Submit"}
              </button>
              <button onClick={onClearCover} disabled={coverState?.busy ?? false} style={{ marginLeft: 8 }}>
                Clear
              </button>
            </div>
            <div className="muted">{coverState?.message ? (coverState?.error ? `${coverState?.message} (${coverState?.error})` : coverState?.message) : ""}</div>
          </div>
        ) : coverState?.message ? (
          <div className="muted" style={{ marginTop: 6 }}>
            {coverState?.error ? `${coverState?.message} (${coverState?.error})` : coverState?.message}
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 6 }}>
            Upload a cover if the book has no online cover.
          </div>
        )}
      </div>

      <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
        <Link href={href} className="muted">
          Details
        </Link>
        <button onClick={onDeleteCopy} disabled={deleteState?.busy ?? false} title="Deletes one copy">
          Delete copy
        </button>
      </div>
      {deleteState?.message ? (
        <div className="muted" style={{ marginTop: 6 }}>
          {deleteState?.error ? `${deleteState?.message} (${deleteState?.error})` : deleteState?.message}
        </div>
      ) : null}
    </div>
  );
}

