"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type AlsoOwnedRow = {
  id: number;
  owner_id: string;
  visibility: "inherit" | "followers_only" | "public";
  owner: { username: string; avatar_path: string | null; visibility: "followers_only" | "public" } | null;
};

const DISPLAY_LIMIT = 8;

export default function AlsoOwnedBy({
  editionId,
  excludeUserBookId,
  excludeOwnerId
}: {
  editionId: number;
  excludeUserBookId: number;
  excludeOwnerId?: string | null;
}) {
  const [rows, setRows] = useState<Array<AlsoOwnedRow & { copies: number }>>([]);
  const [initialized, setInitialized] = useState(false);
  const [avatarUrlsByPath, setAvatarUrlsByPath] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !editionId) {
        setInitialized(true);
        return;
      }
      try {
        const res = await supabase
          .from("user_books")
          .select("id,owner_id,visibility,owner:profiles(username,avatar_path,visibility)")
          .eq("edition_id", editionId)
          .neq("id", excludeUserBookId)
          .order("created_at", { ascending: false })
          .limit(100);
        if (!alive) return;
        if (res.error) throw new Error(res.error.message);
        const data = (res.data ?? []) as any as AlsoOwnedRow[];

        // Group by owner, applying privacy filters.
        const byOwner = new Map<string, { row: AlsoOwnedRow; copies: number }>();
        for (const r of data) {
          if (!r?.owner_id) continue;
          if (excludeOwnerId && r.owner_id === excludeOwnerId) continue;
          // Exclude books explicitly marked followers-only or from private profiles.
          if (r.visibility === "followers_only") continue;
          if (r.owner?.visibility === "followers_only") continue;
          const cur = byOwner.get(r.owner_id);
          if (!cur) {
            byOwner.set(r.owner_id, { row: r, copies: 1 });
          } else {
            cur.copies += 1;
          }
        }
        const grouped = Array.from(byOwner.values()).map((x) => ({ ...x.row, copies: x.copies }));
        setRows(grouped);

        const paths = Array.from(new Set(grouped.map((r) => r.owner?.avatar_path).filter(Boolean))) as string[];
        if (paths.length > 0) {
          const signed = await supabase.storage.from("avatars").createSignedUrls(paths, 60 * 30);
          if (!alive) return;
          const amap: Record<string, string> = {};
          for (const s of signed.data ?? []) {
            if (s.path && s.signedUrl) amap[s.path] = s.signedUrl;
          }
          setAvatarUrlsByPath(amap);
        }
      } catch {
        // Silently hide the module on error.
      } finally {
        if (alive) setInitialized(true);
      }
    })();
    return () => { alive = false; };
  }, [editionId, excludeUserBookId, excludeOwnerId]);

  const owners = useMemo(() => {
    return rows
      .slice()
      .filter((r) => r.owner?.username)
      .sort((a, b) => (a.owner?.username ?? "").localeCompare(b.owner?.username ?? ""));
  }, [rows]);

  if (!supabase || !editionId || !initialized || owners.length === 0) return null;

  const displayed = expanded ? owners : owners.slice(0, DISPLAY_LIMIT);
  const extraCount = owners.length - DISPLAY_LIMIT;
  const libraryWord = owners.length === 1 ? "library" : "libraries";

  return (
    <>
      <hr className="divider" />
      <div style={{ marginTop: "var(--space-lg)" }}>
        <div>
          In {owners.length} other {libraryWord}
        </div>
        <div
          style={{
            marginTop: "var(--space-14)",
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-md)"
          }}
        >
          {displayed.map((r) => {
            const username = r.owner?.username ?? "";
            const avatarPath = r.owner?.avatar_path ?? null;
            const avatarUrl = avatarPath ? avatarUrlsByPath[avatarPath] ?? null : null;
            return (
              <Link
                key={r.owner_id}
                href={`/u/${encodeURIComponent(username)}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  textDecoration: "none",
                  color: "inherit"
                }}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={username}
                    src={avatarUrl}
                    className="om-member-stack-avatar om-member-stack-avatar-detail-down"
                  />
                ) : (
                  <span
                    className="om-member-stack-avatar om-member-stack-avatar-detail-down"
                    title={username}
                    style={{ background: "var(--bg-muted)" }}
                  />
                )}
                <span className="text-muted">{username}</span>
              </Link>
            );
          })}
        </div>
        {extraCount > 0 && (
          <div style={{ marginTop: "var(--space-sm)" }}>
            <button className="text-muted" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "See less" : `See all ${owners.length}`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
