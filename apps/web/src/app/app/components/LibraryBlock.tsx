"use client";

import type { ReactNode } from "react";

export default function LibraryBlock({
  libraryId,
  libraryName,
  bookCount,
  index,
  total,
  collapsed,
  reorderMode,
  manageMode,
  busy,
  isEditing,
  nameDraft,
  onStartEdit,
  onNameDraftChange,
  onSaveName,
  onCancelEdit,
  onDelete,
  onToggleCollapsed,
  onMoveUp,
  onMoveDown,
  children
}: {
  libraryId: number;
  libraryName: string;
  bookCount: number;
  index: number;
  total: number;
  collapsed: boolean;
  reorderMode: boolean;
  manageMode: boolean;
  busy: boolean;
  isEditing: boolean;
  nameDraft: string;
  onStartEdit: (libraryId: number, currentName: string) => void;
  onNameDraftChange: (next: string) => void;
  onSaveName: (libraryId: number, nameDraft: string) => void;
  onCancelEdit: () => void;
  onDelete: (libraryId: number) => void;
  onToggleCollapsed: (libraryId: number) => void;
  onMoveUp: (libraryId: number) => void;
  onMoveDown: (libraryId: number) => void;
  children: ReactNode;
}) {
  const hasNameChanges = nameDraft.trim() !== libraryName.trim();
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="row" style={{ gap: 10, flex: 1, alignItems: "baseline" }}>
          <button
            onClick={() => {
              if (reorderMode) return;
              onToggleCollapsed(libraryId);
            }}
            disabled={busy || reorderMode}
            aria-label={collapsed ? "Expand catalog" : "Collapse catalog"}
            title={reorderMode ? undefined : collapsed ? "Expand" : "Collapse"}
            style={{
              padding: 0,
              width: 16,
              minWidth: 16,
              display: "inline-flex",
              justifyContent: "center",
              border: "none",
              background: "transparent",
              textDecoration: "none",
              cursor: busy || reorderMode ? "default" : "pointer",
              transform: "translateY(2px)"
            }}
          >
            <span className="om-catalog-caret" data-collapsed={collapsed ? "true" : "false"} aria-hidden="true" />
          </button>
          {manageMode && isEditing ? (
            <span
              className="row"
              style={{
                gap: 24,
                flex: 1,
                minWidth: 0,
                flexWrap: "nowrap",
                alignItems: "baseline"
              }}
            >
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
                style={{ minWidth: 220, flex: 1, transform: "translateY(-2px)" }}
              />
              {hasNameChanges ? (
                <div className="row" style={{ gap: 24, alignItems: "baseline" }}>
                  <button onClick={() => onSaveName(libraryId, nameDraft)} disabled={busy || !nameDraft.trim()}>
                    Save
                  </button>
                  <button onClick={onCancelEdit} disabled={busy}>
                    Cancel
                  </button>
                </div>
              ) : null}
              <button onClick={() => onDelete(libraryId)} disabled={busy} style={{ marginLeft: "auto" }}>
                Delete
              </button>
            </span>
          ) : manageMode && !reorderMode ? (
            <button
              onClick={() => onStartEdit(libraryId, libraryName)}
              className="om-library-edit-trigger"
              style={{ padding: 0, border: "none", background: "transparent", textDecoration: "none" }}
              aria-label="Rename catalog"
            >
              {libraryName}
            </button>
          ) : (
            <span>{libraryName}</span>
          )}
          {!isEditing ? (
            <span className="muted">
              {bookCount} book{bookCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        {reorderMode ? (
          <div className="row" style={{ gap: 10 }}>
            {index > 0 ? (
              <button
                onClick={() => onMoveUp(libraryId)}
                disabled={busy}
                style={{ padding: 0, border: "none", background: "transparent", textDecoration: "underline" }}
              >
                Move up
              </button>
            ) : null}
            {index < total - 1 ? (
              <button
                onClick={() => onMoveDown(libraryId)}
                disabled={busy}
                style={{ padding: 0, border: "none", background: "transparent", textDecoration: "underline" }}
              >
                Move down
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {collapsed ? null : children}
    </div>
  );
}
