"use client";

import Link from "next/link";
import CoverImage, { type CoverCrop } from "../../../../components/CoverImage";
import PagedBookList from "../../../app/components/PagedBookList";

type FacetBook = {
  id: number;
  owner_id: string;
  library_id: number | null;
  created_at: string;
  title_override: string | null;
  authors_override: string[] | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: {
    title: string | null;
    authors: string[] | null;
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
  return (
    <PagedBookList
      items={books}
      viewMode="grid"
      gridCols={4}
      containerStyle={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}
      renderItem={(book) => {
        const title = String((book.title_override ?? "").trim() || book.edition?.title || "(untitled)");
        const authors =
          (book.authors_override ?? []).filter(Boolean).length > 0
            ? (book.authors_override ?? []).filter(Boolean)
            : (book.edition?.authors ?? []).filter(Boolean);
        const coverMedia = (book.media ?? []).find((m) => m.kind === "cover");
        const coverUrl = coverMedia ? signedByPath[coverMedia.storage_path] : book.edition?.cover_url ?? null;
        const cropData = book.cover_crop ?? null;
        const imageSrc = cropData && book.cover_original_url ? (signedByPath[book.cover_original_url] ?? coverUrl) : coverUrl;
        const href = `/app/books/${book.id}`;
        return (
          <div key={book.id} className="om-book-card">
            <Link href={href} className="om-book-card-link" style={{ display: "block" }}>
              <div className="om-cover-slot" style={{ width: "100%", aspectRatio: "2 / 3" }}>
                <CoverImage alt={title} src={imageSrc} cropData={cropData} style={{ width: "100%", height: "100%", display: "block" }} />
              </div>
              <div style={{ marginTop: 10 }} className="book-title">
                {title}
              </div>
            </Link>
            {authors.length > 0 ? <div className="om-book-secondary">{authors.join(", ")}</div> : null}
          </div>
        );
      }}
    />
  );
}
