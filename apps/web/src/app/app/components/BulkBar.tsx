"use client";

import { useMemo, useRef, useState } from "react";

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
  onBulkCopySelected
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
}) {
  const canAct = useMemo(() => selectedGroupsCount > 0 && !bulkState.busy, [selectedGroupsCount, bulkState.busy]);
  const [moveQuery, setMoveQuery] = useState("");
  const [copyQuery, setCopyQuery] = useState("");

  const visibilityRef = useRef<HTMLDetailsElement | null>(null);
  const moveRef = useRef<HTMLDetailsElement | null>(null);
  const moreRef = useRef<HTMLDetailsElement | null>(null);

  function close(ref: React.RefObject<HTMLDetailsElement | null>) {
    if (ref.current) ref.current.open = false;
  }

  if (!bulkMode) return null;
  if (selectedGroupsCount === 0) return null;

  const filteredMoveTargets = libraries.filter((l) => l.name.toLowerCase().includes(moveQuery.trim().toLowerCase()));
  const filteredCopyTargets = libraries.filter((l) => l.name.toLowerCase().includes(copyQuery.trim().toLowerCase()));

  return (
    <div className="om-bulkbar" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
          <span>{selectedGroupsCount} selected</span>
          <button onClick={onClearSelected} className="muted" type="button">
            Clear
          </button>
          {bulkState.message ? (
            <span className="muted">{bulkState.error ? `${bulkState.message} (${bulkState.error})` : bulkState.message}</span>
          ) : null}
        </div>

        <div className="row" style={{ gap: 14, alignItems: "baseline" }}>
          <details ref={visibilityRef} className="om-menu">
            <summary className="om-menu-summary" tabIndex={0}>
              Visibility <span aria-hidden="true">▾</span>
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

          <details ref={moveRef} className="om-menu">
            <summary className="om-menu-summary" tabIndex={0}>
              Move <span aria-hidden="true">▾</span>
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
                placeholder="Move to…"
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
                {filteredMoveTargets.length === 0 ? <div className="muted">No matches.</div> : null}
              </div>
            </div>
          </details>

          <details ref={moreRef} className="om-menu">
            <summary className="om-menu-summary" tabIndex={0}>
              More <span aria-hidden="true">▾</span>
            </summary>
            <div
              className="om-menu-panel"
              role="menu"
              onKeyDown={(e) => {
                if (e.key === "Escape") close(moreRef);
              }}
            >
              <div className="muted" style={{ marginBottom: 6 }}>
                Add category
              </div>
              <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
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
                <button type="button" onClick={onBulkAssignCategory} disabled={!canAct || !bulkCategoryName.trim()}>
                  Add
                </button>
              </div>

              <div className="muted" style={{ marginTop: 12, marginBottom: 6 }}>
                Copy to
              </div>
              <input value={copyQuery} onChange={(e) => setCopyQuery(e.target.value)} placeholder="Copy to…" />
              <div className="om-menu-list" style={{ marginTop: 8 }}>
                {filteredCopyTargets.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close(moreRef);
                      onBulkCopySelected(l.id);
                    }}
                    disabled={!canAct}
                    style={{ textAlign: "left" }}
                  >
                    {l.name}
                  </button>
                ))}
                {filteredCopyTargets.length === 0 ? <div className="muted">No matches.</div> : null}
              </div>

              <hr className="om-hr" />
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
                Delete…
              </button>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
