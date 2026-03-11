"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type BulkState = { busy: boolean; error: string | null; message: string | null };
export type LibraryOption = { id: number; name: string };

export default function BulkBar({
  bulkMode,
  bulkState,
  selectedGroupsCount,
  libraries,
  bulkCategoryName,
  setBulkCategoryName,
  onClearSelected,
  onBulkDeleteSelected,
  onBulkMakePublic,
  onBulkMakePrivate,
  onBulkAssignCategory,
  onBulkMoveSelected,
  onBulkCopySelected,
  onBulkChangeObjectType,
  onAnyMenuOpen
}: {
  bulkMode: boolean;
  bulkState: BulkState;
  selectedGroupsCount: number;
  libraries: LibraryOption[];
  bulkCategoryName: string;
  setBulkCategoryName: (next: string) => void;
  onClearSelected: () => void;
  onBulkDeleteSelected: () => void;
  onBulkMakePublic: () => void;
  onBulkMakePrivate: () => void;
  onBulkAssignCategory: () => void;
  onBulkMoveSelected: (libraryId: number) => void;
  onBulkCopySelected: (libraryId: number) => void;
  onBulkChangeObjectType: (objectType: string | null) => void;
  onAnyMenuOpen?: () => void;
}) {
  const canAct = useMemo(() => selectedGroupsCount > 0 && !bulkState.busy, [selectedGroupsCount, bulkState.busy]);
  const [moveQuery, setMoveQuery] = useState("");

  const visibilityRef = useRef<HTMLDetailsElement | null>(null);
  const moveRef = useRef<HTMLDetailsElement | null>(null);
  const moreRef = useRef<HTMLDetailsElement | null>(null);

  function close(ref: React.RefObject<HTMLDetailsElement | null>) {
    if (ref.current) ref.current.open = false;
  }

  function closeAllMenus() {
    close(visibilityRef);
    close(moveRef);
    close(moreRef);
  }

  useEffect(() => {
    const onPointerDownCapture = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const v = visibilityRef.current;
      const m = moveRef.current;
      const more = moreRef.current;
      if (v?.open && v.contains(target)) return;
      if (m?.open && m.contains(target)) return;
      if (more?.open && more.contains(target)) return;
      if (v?.open || m?.open || more?.open) closeAllMenus();
    };
    window.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => window.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, []);

  if (!bulkMode) return null;
  if (selectedGroupsCount === 0) return null;

  const filteredMoveTargets = libraries.filter((l) => l.name.toLowerCase().includes(moveQuery.trim().toLowerCase()));

  return (
    <div className="om-bulkbar" style={{ marginTop: "var(--space-sm)" }}>
      <div className="row om-bulkbar-row" style={{ justifyContent: "flex-start", alignItems: "baseline", gap: 14 }}>
        <details
          ref={visibilityRef}
          className="om-menu"
          onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open;
            if (!open) return;
            close(moveRef);
            close(moreRef);
            onAnyMenuOpen?.();
          }}
        >
          <summary className="om-filter-control om-menu-summary" tabIndex={0} style={{ minWidth: 120 }}>
            <span>Visibility</span>
            <span className="om-filter-caret" aria-hidden="true" />
          </summary>
          <div
            className="om-menu-panel"
            role="menu"
            onKeyDown={(e) => {
              if (e.key === "Escape") close(visibilityRef);
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close(visibilityRef);
                onBulkMakePublic();
              }}
              disabled={!canAct}
            >
              Public
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close(visibilityRef);
                onBulkMakePrivate();
              }}
              disabled={!canAct}
            >
              Private
            </button>
          </div>
        </details>

        <details
          ref={moveRef}
          className="om-menu"
          onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open;
            if (!open) return;
            close(visibilityRef);
            close(moreRef);
            onAnyMenuOpen?.();
          }}
        >
          <summary className="om-filter-control om-menu-summary" tabIndex={0} style={{ minWidth: 100 }}>
            <span>Move</span>
            <span className="om-filter-caret" aria-hidden="true" />
          </summary>
          <div
            className="om-menu-panel"
            role="menu"
            onKeyDown={(e) => {
              if (e.key === "Escape") close(moveRef);
            }}
          >
            <input
              value={moveQuery}
              onChange={(e) => setMoveQuery(e.target.value)}
              placeholder="Search"
            />
            <div className="om-menu-list">
              {filteredMoveTargets.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close(moveRef);
                    onBulkMoveSelected(l.id);
                  }}
                  disabled={!canAct}
                  style={{ textAlign: "left" }}
                >
                  {l.name}
                </button>
              ))}
              {filteredMoveTargets.length === 0 ? <div className="text-muted">No matches.</div> : null}
            </div>
          </div>
        </details>

        <details
          ref={moreRef}
          className="om-menu"
          onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open;
            if (!open) return;
            close(visibilityRef);
            close(moveRef);
            onAnyMenuOpen?.();
          }}
        >
          <summary className="om-filter-control om-menu-summary" tabIndex={0} style={{ minWidth: 100 }}>
            <span>More</span>
            <span className="om-filter-caret" aria-hidden="true" />
          </summary>
          <div
            className="om-menu-panel"
            role="menu"
            onKeyDown={(e) => {
              if (e.key === "Escape") close(moreRef);
            }}
          >
            <div className="text-muted" style={{ marginBottom: "var(--space-sm)" }}>
              Add category
            </div>
            <div className="row" style={{ gap: "var(--space-10)", alignItems: "baseline", marginBottom: "var(--space-md)" }}>
              <input
                value={bulkCategoryName}
                onChange={(e) => setBulkCategoryName(e.target.value)}
                placeholder="Category…"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  onBulkAssignCategory();
                }}
              />
            </div>
            <div className="text-muted" style={{ marginBottom: "var(--space-sm)" }}>
              Object type
            </div>
            <div style={{ marginBottom: "var(--space-md)" }}>
              {(["book", "music"] as const).map((ot) => (
                <button
                  key={ot}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close(moreRef);
                    onBulkChangeObjectType(ot);
                  }}
                  disabled={!canAct}
                  style={{ textAlign: "left", display: "block", width: "100%" }}
                >
                  {ot.charAt(0).toUpperCase() + ot.slice(1)}
                </button>
              ))}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close(moreRef);
                onBulkDeleteSelected();
              }}
              disabled={!canAct}
              style={{ textAlign: "left" }}
            >
              Delete book(s)
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
