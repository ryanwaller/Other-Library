"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import CoverImage, { type CoverCrop } from "../../../components/CoverImage";
import { supabase } from "../../../lib/supabaseClient";

export type EntityModuleItem = {
  id: number;
  title: string;
  coverUrl: string | null;
  coverCrop: CoverCrop | null;
  // All public owners of this edition — used to resolve the correct link.
  ownerEntries: Array<{ ownerId: string; userBookId: number }>;
  // Pre-resolved fallback for non-owners / logged-out users.
  publicFallbackHref: string | null;
};

export default function EntityBookGrid({ items }: { items: EntityModuleItem[] }) {
  // undefined = not yet resolved; null = logged out; string = user id
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

  return (
    <div className="om-related-items-grid" style={{ marginTop: "var(--space-14)" }}>
      {items.map((item) => {
        let href: string | null = null;
        // Once session is resolved, check if the viewer owns a copy.
        if (userId !== undefined) {
          if (userId) {
            const owned = item.ownerEntries.find((e) => e.ownerId === userId);
            if (owned) href = `/app/books/${owned.userBookId}`;
          }
          if (!href) href = item.publicFallbackHref;
        }
        // While session is loading (undefined), treat as logged out for link resolution.
        if (userId === undefined) href = item.publicFallbackHref;

        const inner = (
          <>
            <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
              <CoverImage
                alt={item.title}
                src={item.coverUrl}
                cropData={item.coverCrop}
                style={{ display: "block", width: "100%", height: "auto" }}
                objectFit="contain"
              />
            </div>
            <div style={{ marginTop: "var(--space-sm)" }}>
              <span className="om-book-title">{item.title}</span>
            </div>
          </>
        );

        return (
          <div key={item.id}>
            {href ? (
              <Link href={href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                {inner}
              </Link>
            ) : (
              <div>{inner}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
