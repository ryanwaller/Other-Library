"use client";

import { useState, useMemo, useEffect } from "react";

export function usePagination(
  viewMode: "grid" | "list",
  gridCols: number,
  searchQuery: string = "",
  actualColumns?: number
) {
  const initialLimit = useMemo(() => {
    if (viewMode === "list") return 24;
    const columns = Math.max(1, Number(actualColumns ?? gridCols ?? 1));
    return Math.max(columns * 4, 8);
  }, [viewMode, gridCols, actualColumns]);

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
