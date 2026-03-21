"use client";

import { useEffect, useRef, useState } from "react";
import { usePagination } from "../hooks/usePagination";
import type { ReactNode } from "react";

export default function PagedBookList<T>({
  items,
  viewMode,
  gridCols,
  searchQuery = "",
  renderItem,
  containerStyle,
  noItemsMessage = "No items yet."
}: {
  items: T[];
  viewMode: "grid" | "list";
  gridCols: number;
  searchQuery?: string;
  renderItem: (item: T) => ReactNode;
  containerStyle?: React.CSSProperties;
  noItemsMessage?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredColumns, setMeasuredColumns] = useState<number>(gridCols);

  useEffect(() => {
    if (viewMode !== "grid") {
      setMeasuredColumns(1);
      return;
    }
    if (!containerRef.current || typeof window === "undefined") return;
    const node = containerRef.current;
    const measure = () => {
      const styles = window.getComputedStyle(node);
      const template = styles.gridTemplateColumns;
      if (!template || template === "none") {
        setMeasuredColumns(Math.max(1, gridCols));
        return;
      }
      const count = template
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean).length;
      setMeasuredColumns(Math.max(1, count));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [viewMode, gridCols, containerStyle]);

  const { limit, loadMore, seeLess, canSeeLess } = usePagination(viewMode, gridCols, searchQuery, measuredColumns);

  if (items.length === 0) {
    return (
      <div className="text-muted" style={{ marginTop: "var(--space-10)" }}>
        {noItemsMessage}
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} style={containerStyle}>
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
