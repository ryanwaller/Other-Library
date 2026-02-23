"use client";

import { useMemo } from "react";

export type BulkState = { busy: boolean; error: string | null; message: string | null };
export type LibraryOption = { id: number; name: string };

export default function BulkBar({
  bulkMode,
  bulkState,
  selectedGroupsCount,
  libraries,
  bulkCategoryName,
  setBulkCategoryName,
  bulkMoveLibraryId,
  setBulkMoveLibraryId,
  onBulkDeleteSelected,
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
  bulkMoveLibraryId: number | null;
  setBulkMoveLibraryId: (next: number) => void;
  onBulkDeleteSelected: () => void;
  onBulkAssignCategory: () => void;
  onBulkMoveSelected: () => void;
  onBulkCopySelected: () => void;
}) {
  const canAct = useMemo(() => selectedGroupsCount > 0 && !bulkState.busy, [selectedGroupsCount, bulkState.busy]);
  if (!bulkMode) return null;

  return (
    <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <button onClick={onBulkDeleteSelected} disabled={!canAct}>
        Delete selected
      </button>
      <span className="muted">Category</span>
      <input
        placeholder="Add category"
        value={bulkCategoryName}
        onChange={(e) => setBulkCategoryName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          onBulkAssignCategory();
        }}
        style={{ minWidth: 180 }}
      />
      <button onClick={onBulkAssignCategory} disabled={!canAct || !bulkCategoryName.trim()}>
        Apply
      </button>
      <span className="muted">Move to</span>
      <select
        value={bulkMoveLibraryId ?? ""}
        onChange={(e) => setBulkMoveLibraryId(Number(e.target.value))}
        disabled={bulkState.busy}
      >
        {libraries.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <button onClick={onBulkMoveSelected} disabled={!canAct || !bulkMoveLibraryId}>
        Move
      </button>
      <button onClick={onBulkCopySelected} disabled={!canAct || !bulkMoveLibraryId}>
        Copy
      </button>
      {bulkState.message ? <span className="muted">{bulkState.error ? `${bulkState.message} (${bulkState.error})` : bulkState.message}</span> : null}
    </div>
  );
}

