"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type AlsoOwnedRow = {
  id: number;
  owner_id: string;
  visibility: "inherit" | "followers_only" | "public";
  owner: { username: string; avatar_path: string | null } | null;
};

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
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrlsByPath, setAvatarUrlsByPath] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) {
        setInitialized(true);
        return;
      }
      if (!editionId) {
        setInitialized(true);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await supabase
          .from("user_books")
          .select("id,owner_id,visibility,owner:profiles(username,avatar_path)")
          .eq("edition_id", editionId)
          .neq("id", excludeUserBookId)
          .order("created_at", { ascending: false })
          .limit(40);
        if (!alive) return;
        if (res.error) throw new Error(res.error.message);
        const data = (res.data ?? []) as any as AlsoOwnedRow[];

        // Group by owner and count visible copies.
        const byOwner = new Map<string, { row: AlsoOwnedRow; copies: number }>();
        for (const r of data) {
          if (!r?.owner_id) continue;
          if (excludeOwnerId && r.owner_id === excludeOwnerId) continue;
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
        if (paths.length === 0) {
          setAvatarUrlsByPath({});
          setInitialized(true);
          return;
        }
        const signed = await supabase.storage.from("avatars").createSignedUrls(paths, 60 * 30);
        if (!alive) return;
        const amap: Record<string, string> = {};
        for (const s of signed.data ?? []) {
          if (s.path && s.signedUrl) amap[s.path] = s.signedUrl;
        }
        setAvatarUrlsByPath(amap);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load");
      } finally {
        setBusy(false);
        setInitialized(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [editionId, excludeUserBookId, excludeOwnerId]);

  const owners = useMemo(() => {
    return rows
      .slice()
      .filter((r) => r.owner?.username)
      .sort((a, b) => (a.owner?.username ?? "").localeCompare(b.owner?.username ?? ""));
  }, [rows]);

  if (!supabase || !editionId) return null;
  if (!initialized || busy || error || owners.length === 0) return null;

  return (
    <div style={{ marginTop: 14 }} className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>Also owned by</div>
        <div className="muted">{owners.length}</div>
      </div>
      {owners.length === 0 ? (
        <div className="muted" style={{ marginTop: 8 }}>
          None found.
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {owners.map((r) => {
            const username = r.owner?.username ?? "";
            const avatarPath = r.owner?.avatar_path ?? null;
            const avatarUrl = avatarPath ? avatarUrlsByPath[avatarPath] ?? null : null;
            return (
              <Link key={r.owner_id} href={`/u/${username}`} className="card om-avatar-lockup" style={{ textDecoration: "none" }}>
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={avatarUrl} className="om-avatar-img" />
                ) : (
                  <span className="om-avatar-img" style={{ display: "inline-block" }} />
                )}
                <span>{username}</span>
                <span className="muted">{r.copies > 1 ? `(${r.copies})` : ""}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
