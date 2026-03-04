"use client";

import { useState, type ReactNode } from "react";

type Props<T> = {
  items: T[];
  limit: number;
  renderVisible: (visible: T[], isExpanded: boolean) => ReactNode;
};

export default function ExpandableContent<T>({ items, limit, renderVisible }: Props<T>) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasMore = items.length > limit;
  const visible = isExpanded ? items : items.slice(0, limit);

  return (
    <>
      {renderVisible(visible, isExpanded)}
      {hasMore && (
        <div className="row" style={{ marginTop: "var(--space-md)", justifyContent: "center" }}>
          <button onClick={() => setIsExpanded(!isExpanded)} className="muted">
            {isExpanded ? "See less" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
