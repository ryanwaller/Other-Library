"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { CoverCrop } from "../../../components/CoverImage";
import { supabase } from "../../../lib/supabaseClient";
import EntityBookGrid, { type GridItem } from "./EntityBookGrid";

export type OwnerEntry = {
  ownerId: string;
  userBookId: number;
  coverUrl: string | null;
  coverCrop: CoverCrop | null;
  title: string;
};

export type EntityModuleItem = {
  id: number;
  title: string;
  coverUrl: string | null;
  coverCrop: CoverCrop | null;
  ownerEntries: OwnerEntry[];
  publicFallbackHref: string | null;
};

export type ModuleData = {
  role: string;
  heading: string;
  items: EntityModuleItem[];
  total: number;
  viewAllHref: string | null;
};

export default function EntityPageModules({ modules }: { modules: ModuleData[] }) {
  // undefined = session not yet resolved
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) {
      setUserId(null);
      return;
    }
    // getSession reads from localStorage — no network request.
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
    });
  }, []);

  // Build "Your copies" — deduplicated by userBookId across all modules.
  const yourCopies: GridItem[] = [];
  if (userId) {
    const seenBookIds = new Set<number>();
    for (const mod of modules) {
      for (const item of mod.items) {
        for (const entry of item.ownerEntries) {
          if (entry.ownerId === userId && !seenBookIds.has(entry.userBookId)) {
            seenBookIds.add(entry.userBookId);
            yourCopies.push({
              id: entry.userBookId,
              title: entry.title,
              coverUrl: entry.coverUrl,
              coverCrop: entry.coverCrop,
              href: `/app/books/${entry.userBookId}`
            });
          }
        }
      }
    }
  }

  return (
    <>
      {yourCopies.length > 0 && (
        <div style={{ marginTop: "var(--space-xl)" }}>
          <hr className="divider" />
          <div style={{ marginTop: "var(--space-lg)" }}>
            <div>Your copies</div>
            <EntityBookGrid items={yourCopies} />
          </div>
        </div>
      )}

      {modules.map((mod) => {
        const filteredItems: GridItem[] = mod.items.map((item) => ({
          id: item.id,
          title: item.title,
          coverUrl: item.coverUrl,
          coverCrop: item.coverCrop,
          href: item.publicFallbackHref
        }));

        if (filteredItems.length === 0) return null;

        return (
          <div key={mod.role} style={{ marginTop: "var(--space-xl)" }}>
            <hr className="divider" />
            <div style={{ marginTop: "var(--space-lg)" }}>
              <div
                className="row"
                style={{ justifyContent: "space-between", alignItems: "baseline" }}
              >
                <div>{mod.heading}</div>
                {mod.viewAllHref ? (
                  <Link
                    href={mod.viewAllHref}
                    className="text-muted"
                    style={{ textDecoration: "none" }}
                  >
                    View all {mod.total}
                  </Link>
                ) : null}
              </div>
              <EntityBookGrid items={filteredItems} />
            </div>
          </div>
        );
      })}
    </>
  );
}
