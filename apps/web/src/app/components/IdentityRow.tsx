"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface Props {
  avatarUrl: string | null;
  displayName: string | null;
  username: string;
  label?: string;
  rightSlot?: ReactNode;
}

/**
 * Standardized row for a person/profile.
 * Used in message lists, follow lists, borrow requests, etc.
 */
export default function IdentityRow({
  avatarUrl,
  displayName,
  username,
  label,
  rightSlot
}: Props) {
  const avatar = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" src={avatarUrl} className="om-avatar-img" />
  ) : (
    <div className="om-avatar-img" style={{ background: "var(--bg-muted)" }} />
  );

  const name = (displayName ?? "").trim() || username;

  return (
    <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", width: "100%" }}>
      <div className="om-avatar-lockup" style={{ minWidth: 0, flex: 1 }}>
        <Link href={`/u/${username}`} className="om-avatar-link">
          {avatar}
        </Link>
        <div style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label && <span className="muted" style={{ marginRight: 6 }}>{label}</span>}
          <Link href={`/u/${username}`}>
            {name}
          </Link>
        </div>
      </div>
      {rightSlot && (
        <div style={{ flex: "0 0 auto", marginLeft: "var(--space-md)" }}>
          {rightSlot}
        </div>
      )}
    </div>
  );
}
