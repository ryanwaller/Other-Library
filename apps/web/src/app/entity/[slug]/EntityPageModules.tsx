"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { CoverCrop } from "../../../components/CoverImage";
import { supabase } from "../../../lib/supabaseClient";
import EntityBookGrid, { type GridItem } from "./EntityBookGrid";

export type OwnerEntry = {
  ownerId: string;
  libraryId: number | null;
  userBookId: number;
  coverUrl: string | null;
  coverCrop: CoverCrop | null;
  title: string;
};

export type EntityModuleItem = {
  id: number;
  title: string;
  secondaryLine?: string | null;
  coverUrl: string | null;
  coverCrop: CoverCrop | null;
  ownerEntries: OwnerEntry[];
  publicFallbackHref: string | null;
};

export type HiddenOwnerItem = {
  id: number;
  secondaryLine: string | null;
  ownerEntries: OwnerEntry[];
};

export type ModuleData = {
  role: string;
  heading: string;
  items: EntityModuleItem[];
  hiddenOwnerItems: HiddenOwnerItem[];
  total: number;
  viewAllHref: string | null;
};

export default function EntityPageModules({ modules }: { modules: ModuleData[] }) {
  // undefined = session not yet resolved
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [myCatalogIds, setMyCatalogIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!supabase) {
      setUserId(null);
      return;
    }
    // getSession reads from localStorage — no network request.
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        supabase!
          .from("catalog_members")
          .select("catalog_id")
          .eq("user_id", uid)
          .not("accepted_at", "is", null)
          .then(({ data: memberData }) => {
            setMyCatalogIds(new Set((memberData ?? []).map((m: any) => m.catalog_id as number)));
          });
      }
    });
  }, []);

  // Build "Your copies" — includes books you directly own OR books in catalogs
  // you're a member of (e.g. shared organizational catalogs).
  // Checks both displayed items AND hidden groups (beyond the first 12 shown).
  const yourCopies: GridItem[] = [];
  if (userId) {
    const seenItemIds = new Set<number>();

    const tryAddEntry = (
      itemId: number,
      secondaryLine: string | null | undefined,
      entries: OwnerEntry[]
    ) => {
      if (seenItemIds.has(itemId)) return;
      for (const entry of entries) {
        const isOwner = entry.ownerId === userId;
        const inMyCatalog = entry.libraryId !== null && myCatalogIds.has(entry.libraryId);
        if (isOwner || inMyCatalog) {
          seenItemIds.add(itemId);
          yourCopies.push({
            id: entry.userBookId,
            title: entry.title,
            secondaryLine: secondaryLine ?? null,
            coverUrl: entry.coverUrl,
            coverCrop: entry.coverCrop,
            href: `/app/books/${entry.userBookId}`
          });
          break;
        }
      }
    };

    for (const mod of modules) {
      for (const item of mod.items) {
        tryAddEntry(item.id, item.secondaryLine, item.ownerEntries);
      }
      for (const hidden of mod.hiddenOwnerItems) {
        tryAddEntry(hidden.id, hidden.secondaryLine, hidden.ownerEntries);
      }
    }
  }

  yourCopies.sort((a, b) => {
    const titleCmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
    if (titleCmp !== 0) return titleCmp;
    return String(a.secondaryLine ?? "").localeCompare(String(b.secondaryLine ?? ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  });

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
          secondaryLine: item.secondaryLine ?? null,
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
