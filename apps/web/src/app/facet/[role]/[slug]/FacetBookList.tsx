"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import CoverImage, { type CoverCrop } from "../../../../components/CoverImage";
import PagedBookList from "../../../app/components/PagedBookList";
import type { MusicMetadata } from "../../../../lib/music";
import { effectiveSecondaryLineFor } from "../../../../lib/book";

type FacetBook = {
  id: number;
  owner_id: string;
  library_id: number | null;
  created_at: string;
  object_type?: string | null;
  title_override: string | null;
  subtitle_override?: string | null;
  authors_override: string[] | null;
  editors_override?: string[] | null;
  issue_number?: string | null;
  issue_volume?: string | null;
  issue_season?: string | null;
  issue_year?: number | null;
  music_metadata?: MusicMetadata | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: {
    title: string | null;
    authors: string[] | null;
    subjects?: string[] | null;
    publisher?: string | null;
    publish_date?: string | null;
    description?: string | null;
    cover_url: string | null;
  } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

export default function FacetBookList({
  books,
  signedByPath
}: {
  books: FacetBook[];
  signedByPath: Record<string, string>;
}) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <PagedBookList
      items={books}
      viewMode="grid"
      gridCols={isMobile ? 2 : 4}
      containerStyle={{ 
        marginTop: "var(--space-10)", 
        display: "grid", 
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(180px, 1fr))", 
        gap: 16 
      }}
      renderItem={(book) => {
        const title = String((book.title_override ?? "").trim() || book.edition?.title || "(untitled)");
        const secondary = effectiveSecondaryLineFor(book);
        const coverMedia = (book.media ?? []).find((m) => m.kind === "cover");
        const coverUrl = coverMedia ? signedByPath[coverMedia.storage_path] : book.edition?.cover_url ?? null;
        const cropData = book.cover_crop ?? null;
        const imageSrc = cropData && book.cover_original_url ? (signedByPath[book.cover_original_url] ?? coverUrl) : coverUrl;
        const href = `/app/books/${book.id}`;
        return (
          <div key={book.id} className="om-book-card">
            <Link href={href} className="om-book-card-link" style={{ display: "block" }}>
              <div className="om-cover-slot" style={{ width: "100%", height: "auto" }}>
                <CoverImage alt={title} src={imageSrc} cropData={cropData} style={{ width: "100%", height: "auto", display: "block" }} objectFit="contain" />
              </div>
              <div style={{ marginTop: "var(--space-10)" }} className="book-title">
                {title}
              </div>
            </Link>
            {secondary.values.length > 0 ? <div className="om-book-secondary">{secondary.values.join(", ")}</div> : null}
          </div>
        );
      }}
    />
  );
}
