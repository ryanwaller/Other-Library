"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface Props {
  avatarUrl: string | null;
  displayName: string | null;
  username: string;
  followerCount: number | null;
  followingCount: number | null;
  isLinked?: boolean;
  followButton?: ReactNode;
  bio?: ReactNode;
}

export default function PublicProfileHeader({
  avatarUrl,
  displayName,
  username,
  followerCount,
  followingCount,
  isLinked = true,
  followButton,
  bio
}: Props) {
  const avatar = avatarUrl ? (
    <div style={{ width: 48, height: 48, borderRadius: 999, overflow: "hidden", border: "1px solid var(--border-avatar)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="" src={avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  ) : (
    <div style={{ width: 48, height: 48, borderRadius: 999, border: "1px solid var(--border-avatar)", background: "var(--bg-muted)" }} />
  );

  const nameLockup = (
    <div style={{ textDecoration: "none", color: "inherit" }}>
      <div style={{ fontSize: "1em" }} className="om-header-display-name">{displayName || `@${username}`}</div>
      {displayName ? <div className="muted">@{username}</div> : null}
    </div>
  );

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div className="row" style={{ gap: "var(--space-md)", alignItems: "center" }}>
          {isLinked ? (
            <>
              <Link href={`/u/${username}`} className="om-avatar-link" aria-label="Open profile">
                {avatar}
              </Link>
              <Link href={`/u/${username}`} style={{ textDecoration: "none", color: "inherit" }} className="om-header-name-link">
                {nameLockup}
              </Link>
            </>
          ) : (
            <>
              {avatar}
              {nameLockup}
            </>
          )}
        </div>
      </div>

      <div className="row muted" style={{ marginTop: "var(--space-md)", gap: 16 }}>
        <span style={{ display: "inline-flex", gap: "var(--space-10)" }}>
          <Link href={`/u/${username}/followers`} className="muted">
            Followers
          </Link>
          <span>{followerCount ?? "—"}</span>
        </span>
        <span style={{ display: "inline-flex", gap: "var(--space-10)" }}>
          <Link href={`/u/${username}/following`} className="muted">
            Following
          </Link>
          <span>{followingCount ?? "—"}</span>
        </span>
        {followButton}
      </div>
      {bio && (
        <div className="muted" style={{ marginTop: "var(--space-8)", whiteSpace: "pre-wrap" }}>
          {bio}
        </div>
      )}
    </div>
  );
}
