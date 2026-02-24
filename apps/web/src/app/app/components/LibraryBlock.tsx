"use client";

import type { ReactNode } from "react";

export default function LibraryBlock({
  libraryId,
  libraryName,
  bookCount,
  index,
  total,
  busy,
  isEditing,
  nameDraft,
  onStartEdit,
  onNameDraftChange,
  onSaveName,
  onCancelEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  children
}: {
  libraryId: number;
  libraryName: string;
  bookCount: number;
  index: number;
  total: number;
  busy: boolean;
  isEditing: boolean;
  nameDraft: string;
  onStartEdit: (libraryId: number, currentName: string) => void;
  onNameDraftChange: (next: string) => void;
  onSaveName: (libraryId: number, nameDraft: string) => void;
  onCancelEdit: () => void;
  onDelete: (libraryId: number) => void;
  onMoveUp: (libraryId: number) => void;
  onMoveDown: (libraryId: number) => void;
  children: ReactNode;
}) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="row" style={{ gap: 10 }}>
          {isEditing ? (
            <span className="row" style={{ gap: 8 }}>
              <input
                value={nameDraft}
                onChange={(e) => onNameDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onCancelEdit();
                    return;
                  }
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  onSaveName(libraryId, nameDraft);
                }}
                autoFocus
                style={{ minWidth: 220 }}
              />
              <button onClick={() => onSaveName(libraryId, nameDraft)} disabled={busy || !nameDraft.trim()}>
                Save
              </button>
              <button onClick={onCancelEdit} disabled={busy}>
                Cancel
              </button>
              <button onClick={() => onDelete(libraryId)} disabled={busy} style={{ marginLeft: 10 }}>
                Delete…
              </button>
            </span>
          ) : (
            <button
              onClick={() => onStartEdit(libraryId, libraryName)}
              style={{ padding: 0, border: "none", background: "transparent", textDecoration: "underline" }}
              aria-label="Rename catalog"
            >
              {libraryName}
            </button>
          )}
          <span className="muted">
            {bookCount} book{bookCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {index > 0 ? (
            <button onClick={() => onMoveUp(libraryId)} disabled={busy} aria-label="Move catalog up">
              ↑
            </button>
          ) : null}
          {index < total - 1 ? (
            <button onClick={() => onMoveDown(libraryId)} disabled={busy} aria-label="Move catalog down">
              ↓
            </button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
