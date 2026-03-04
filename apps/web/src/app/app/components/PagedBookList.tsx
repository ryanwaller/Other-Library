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
  const { limit, loadMore, seeLess, canSeeLess } = usePagination(viewMode, gridCols, searchQuery);

  if (items.length === 0) {
    return (
      <div className="text-muted" style={{ marginTop: "var(--space-10)" }}>
        {noItemsMessage}
      </div>
    );
  }

  return (
    <>
      <div style={containerStyle}>
        {items.slice(0, limit).map(renderItem)}
      </div>
      {(items.length > limit || canSeeLess) && (
        <div className="row" style={{ marginTop: "var(--space-md)", marginBottom: 24, justifyContent: "center" }}>
          {items.length > limit ? (
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
  );
}
