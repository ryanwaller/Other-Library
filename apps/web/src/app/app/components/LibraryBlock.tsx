"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { usePagination } from "../hooks/usePagination";

export default function LibraryBlock({
  libraryId,
  libraryName,
  memberPreviews,
  showEditMembers,
  membersEditorOpen,
  onToggleMembersEditor,
  membersPanel,
  bookCount,
  index,
  total,
  collapsed,
  reorderMode,
  manageMode,
  rearrangingLibraryId,
  onToggleRearrange,
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
  viewMode,
  gridCols,
  isMobile,
  searchQuery,
  renderBooks
}: {
  libraryId: number;
  libraryName: string;
  memberPreviews?: Array<{ userId: string; username: string; avatarUrl: string | null }>;
  showEditMembers?: boolean;
  membersEditorOpen?: boolean;
  onToggleMembersEditor?: (libraryId: number) => void;
  membersPanel?: ReactNode;
  bookCount: number;
  index: number;
  total: number;
  collapsed: boolean;
  reorderMode: boolean;
  manageMode: boolean;
  rearrangingLibraryId: number | null;
  onToggleRearrange: (libraryId: number | null) => void;
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
  viewMode: "grid" | "list";
  gridCols: number;
  isMobile?: boolean;
  searchQuery: string;
  renderBooks: (limit: number, effectiveViewMode: "grid" | "list") => ReactNode;
}) {
  const hasNameChanges = nameDraft.trim() !== libraryName.trim();

  const isRearrangingThis = rearrangingLibraryId === libraryId;
  const effectiveViewMode = viewMode;

  const { limit, loadMore, seeLess, canSeeLess } = usePagination(effectiveViewMode, gridCols, searchQuery);

  return (
    <div className="card" style={{ marginTop: index === 0 ? 0 : "var(--space-14)" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "nowrap" }}>
        <div className="row" style={{ gap: "var(--space-10)", flex: 1, alignItems: "baseline", flexWrap: "nowrap", minWidth: 0 }}>
          <button
            onClick={() => {
              onToggleCollapsed(libraryId);
            }}
            disabled={busy}
            aria-label={collapsed ? "Expand catalog" : "Collapse catalog"}
            title={collapsed ? "Expand" : "Collapse"}
            style={{
              padding: 0,
              width: 16,
              minWidth: 16,
              display: "inline-flex",
              justifyContent: "center",
              alignItems: "center",
              border: "none",
              background: "transparent",
              textDecoration: "none",
              cursor: busy ? "default" : "pointer",
              transform: "translateY(-2px)"
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
                style={{
                  minWidth: 180,
                  flex: 1,
                  margin: 0,
                  padding: "0 0 9px",
                  border: "none",
                  borderBottom: "1px solid var(--border)"
                }}
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
            </span>
          ) : (
            <div className="row" style={{ flex: 1, justifyContent: "space-between", alignItems: "baseline", minWidth: 0 }}>
              <div className="row" style={{ alignItems: "center", gap: "var(--space-sm)", minWidth: 0, flexShrink: 1 }}>
                {manageMode ? (
                  <button
                    onClick={() => onStartEdit(libraryId, libraryName)}
                    className="om-library-edit-trigger"
                    style={{
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      textDecoration: "none",
                      textAlign: "left"
                    }}
                    aria-label="Rename catalog"
                  >
                    {libraryName}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      onToggleCollapsed(libraryId);
                    }}
                    disabled={busy}
                    style={{
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      textAlign: "left",
                      font: "inherit",
                      color: "inherit",
                      cursor: busy ? "default" : "pointer"
                    }}
                  >
                    {libraryName}
                  </button>
                )}
                {manageMode && showEditMembers ? (
                  <button
                    type="button"
                    onClick={() => onToggleMembersEditor?.(libraryId)}
                    className={membersEditorOpen ? "text-primary" : "text-muted"}
                    style={{ border: "none", background: "transparent", padding: 0, textDecoration: "underline", cursor: "pointer" }}
                  >
                    Edit Members
                  </button>
                ) : (memberPreviews ?? []).length > 0 ? (
                  <span className="om-member-stack" aria-label="Shared catalog members">
                    {(memberPreviews ?? []).slice(0, 6).map((m) =>
                      m.username ? (
                        <Link key={m.userId} href={`/u/${m.username}`} aria-label={`Open ${m.username}'s profile`} title={m.username}>
                          {m.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt={m.username} src={m.avatarUrl} className="om-member-stack-avatar" />
                          ) : (
                            <span className="om-member-stack-avatar" />
                          )}
                        </Link>
                      ) : m.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={m.userId} alt="" src={m.avatarUrl} className="om-member-stack-avatar" />
                      ) : (
                        <span key={m.userId} className="om-member-stack-avatar" />
                      )
                    )}
                    {(memberPreviews ?? []).length > 6 ? (
                      <span className="om-member-stack-overflow" title={`${(memberPreviews ?? []).length - 6} more members`}>
                        +{(memberPreviews ?? []).length - 6}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {!manageMode ? (
                <span className="text-muted" style={{ marginLeft: "var(--space-md)", whiteSpace: "nowrap", paddingBottom: 9, borderBottom: "1px solid transparent" }}>
                  {bookCount}&nbsp;&nbsp;item{bookCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {(reorderMode || manageMode) && !isEditing ? (
          <div className="row" style={{ gap: "var(--space-10)", marginLeft: "var(--space-md)", alignItems: "baseline" }}>
            {manageMode ? (
              <>
                <button
                  onClick={() => onToggleRearrange(rearrangingLibraryId === libraryId ? null : libraryId)}
                  disabled={busy}
                  style={{ padding: "0 0 9px", border: "none", borderBottom: "1px solid transparent", background: "transparent", textDecoration: "underline" }}
                >
                  {rearrangingLibraryId === libraryId ? "Done" : "Rearrange"}
                </button>
                <button
                  onClick={() => onDelete(libraryId)}
                  disabled={busy}
                  style={{ padding: "0 0 9px", border: "none", borderBottom: "1px solid transparent", background: "transparent", textDecoration: "underline" }}
                >
                  Delete
                </button>
              </>
            ) : null}
            {index > 0 ? (
              <button
                onClick={() => onMoveUp(libraryId)}
                disabled={busy}
                style={{ padding: "0 0 9px", border: "none", borderBottom: "1px solid transparent", background: "transparent", textDecoration: "underline" }}
              >
                Move up
              </button>
            ) : null}
            {index < total - 1 ? (
              <button
                onClick={() => onMoveDown(libraryId)}
                disabled={busy}
                style={{ padding: "0 0 9px", border: "none", borderBottom: "1px solid transparent", background: "transparent", textDecoration: "underline" }}
              >
                Move down
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {!collapsed && (
        <>
          {membersPanel}
          {renderBooks(limit, effectiveViewMode)}
          {(bookCount > limit || canSeeLess) && (
            <div className="row" style={{ marginTop: "var(--space-md)", marginBottom: 24, justifyContent: "center" }}>
              {bookCount > limit ? (
                <button onClick={loadMore} className="text-muted">
                  Load more
                </button>
              ) : null}
              {canSeeLess ? (
                <button onClick={seeLess} className="text-muted">
                  See less
                </button>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
