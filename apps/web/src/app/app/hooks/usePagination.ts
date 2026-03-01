"use client";

import { useState, useMemo, useEffect } from "react";

export function usePagination(viewMode: "grid" | "list", gridCols: number, searchQuery: string = "") {
  const initialLimit = useMemo(() => {
    if (viewMode === "list") return 24;
    if (gridCols === 2) return 24; // 12 rows * 2
    if (gridCols === 8) return 32; // 4 rows * 8
    return 16; // Default (grid of 4): 4 rows * 4
  }, [viewMode, gridCols]);

  const [limit, setLimit] = useState(initialLimit);

  // Reset limit when layout changes or search query changes
  useEffect(() => {
    setLimit(initialLimit);
  }, [initialLimit, searchQuery]);

  const loadMore = () => setLimit((prev) => prev + initialLimit);

  return {
    limit,
    loadMore,
    initialLimit
  };
}
