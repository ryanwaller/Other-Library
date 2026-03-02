"use client";

import { usePagination } from "../hooks/usePagination";
import type { ReactNode } from "react";

export default function PagedBookList<T>({
  items,
  viewMode,
  gridCols,
  searchQuery = "",
  renderItem,
  containerStyle,
  noItemsMessage = "No books yet."
}: {
  items: T[];
  viewMode: "grid" | "list";
  gridCols: number;
  searchQuery?: string;
  renderItem: (item: T) => ReactNode;
  containerStyle?: React.CSSProperties;
  noItemsMessage?: string;
}) {
  const { limit, loadMore } = usePagination(viewMode, gridCols, searchQuery);

  if (items.length === 0) {
    return (
      <div className="muted" style={{ marginTop: 10 }}>
        {noItemsMessage}
      </div>
    );
  }

  return (
    <>
      <div style={containerStyle}>
        {items.slice(0, limit).map(renderItem)}
      </div>
      {items.length > limit && (
        <div className="row" style={{ marginTop: 12, marginBottom: 24, justifyContent: "center" }}>
          <button onClick={loadMore} className="muted">
            Load more
          </button>
        </div>
      )}
    </>
  );
}
