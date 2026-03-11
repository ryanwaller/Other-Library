"use client";

import Link from "next/link";

export type FilterPair = {
  label: string;
  value: string;
  key: string;
  entityHref?: string;
  onClear?: () => void;
  clearHref?: string;
};

interface Props {
  pairs: FilterPair[];
  onClearAll?: () => void;
  clearAllHref?: string;
}

/**
 * Standardized display for active filters in toolbar/header rows.
 * Features grey labels, white values, and plain "clear" links.
 * Increased spacing between elements for readability.
 */
export default function ActiveFilterDisplay({ pairs, onClearAll, clearAllHref }: Props) {
  if (!pairs || pairs.length === 0) return null;

  return (
    <div className="row text-muted" style={{ gap: "var(--space-lg)", justifyContent: "flex-end", alignItems: "baseline" }}>
      <span style={{ display: "inline-flex", gap: "var(--space-32)", flexWrap: "wrap", alignItems: "baseline" }}>
        {pairs.map((p, idx) => (
          <span key={`${p.label}:${p.value}:${idx}`} className="row" style={{ gap: "var(--space-md)", alignItems: "baseline" }}>
            <span className="text-muted" style={{ marginRight: 2 }}>{p.label}</span>
            <span style={{ color: "var(--fg)", marginRight: 4 }}>
              {p.value}
              {p.entityHref ? (
                <>
                  {" "}
                  <Link href={p.entityHref} className="text-muted" style={{ textDecoration: "none" }}>
                    ↗
                  </Link>
                </>
              ) : null}
            </span>
            {p.onClear ? (
              <button
                type="button"
                onClick={p.onClear}
                className="text-muted"
                style={{ font: "inherit", cursor: "pointer", border: "none", background: "none", padding: 0 }}
              >
                clear
              </button>
            ) : p.clearHref ? (
              <Link href={p.clearHref} className="text-muted">
                clear
              </Link>
            ) : null}
          </span>
        ))}
      </span>
      
      {(onClearAll || clearAllHref) && pairs.length > 1 && (
        <span style={{ marginLeft: "var(--space-16)" }}>
          {onClearAll ? (
            <button
              type="button"
              onClick={onClearAll}
              className="om-clear-filter-btn"
            >
              clear all
            </button>
          ) : clearAllHref ? (
            <Link href={clearAllHref} className="om-clear-filter-btn">
              clear all
            </Link>
          ) : null}
        </span>
      )}
    </div>
  );
}
