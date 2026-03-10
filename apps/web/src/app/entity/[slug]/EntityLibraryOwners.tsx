"use client";

import Link from "next/link";
import { useState } from "react";

const DISPLAY_LIMIT = 8;

export type OwnerProfile = {
  id: string;
  username: string;
  avatarUrl: string | null;
};

export default function EntityLibraryOwners({ owners }: { owners: OwnerProfile[] }) {
  const [expanded, setExpanded] = useState(false);

  if (owners.length === 0) return null;

  const displayed = expanded ? owners : owners.slice(0, DISPLAY_LIMIT);
  const extraCount = owners.length - DISPLAY_LIMIT;
  const libraryWord = owners.length === 1 ? "library" : "libraries";

  return (
    <div style={{ marginTop: "var(--space-lg)" }}>
      <div>In {owners.length} {libraryWord}</div>
      <div
        style={{
          marginTop: "var(--space-14)",
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-md)"
        }}
      >
        {displayed.map((owner) => (
          <Link
            key={owner.id}
            href={`/u/${encodeURIComponent(owner.username)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              textDecoration: "none",
              color: "inherit"
            }}
          >
            {owner.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={owner.username}
                src={owner.avatarUrl}
                className="om-member-stack-avatar om-member-stack-avatar-detail-down"
              />
            ) : (
              <span
                className="om-member-stack-avatar om-member-stack-avatar-detail-down"
                title={owner.username}
                style={{ background: "var(--bg-muted)" }}
              />
            )}
            <span className="text-muted">{owner.username}</span>
          </Link>
        ))}
      </div>
      {extraCount > 0 && (
        <div style={{ marginTop: "var(--space-sm)" }}>
          <button className="text-muted" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "See less" : `See all ${owners.length}`}
          </button>
        </div>
      )}
    </div>
  );
}
