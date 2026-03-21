"use client";

import { useState, useMemo, useEffect } from "react";

export function usePagination(viewMode: "grid" | "list", gridCols: number, searchQuery: string = "") {
  const initialLimit = useMemo(() => {
    if (viewMode === "list") return 24;
    if (gridCols <= 2) return 16;
    if (gridCols <= 4) return 20;
    if (gridCols <= 6) return 24;
    return 36;
  }, [viewMode, gridCols]);

  const [limit, setLimit] = useState(initialLimit);

  // Reset limit when layout changes or search query changes
  useEffect(() => {
    setLimit(initialLimit);
  }, [initialLimit, searchQuery]);

  const loadMore = () => setLimit((prev) => prev + initialLimit);
  const seeLess = () => setLimit(initialLimit);
  const canSeeLess = limit > initialLimit;

  return {
    limit,
    loadMore,
    seeLess,
    canSeeLess,
    initialLimit
  };
}
