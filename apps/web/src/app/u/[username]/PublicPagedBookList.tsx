"use client";

import Link from "next/link";
import { bookIdSlug } from "../../../lib/slug";
import CoverImage, { type CoverCrop } from "../../../components/CoverImage";
import PagedBookList from "../../app/components/PagedBookList";

type PublicBook = {
  id: number;
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  title_override: string | null;
  authors_override: string[] | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: {
    isbn13?: string | null;
    title?: string | null;
    authors?: string[] | null;
    cover_url?: string | null;
    subjects?: string[] | null;
    publisher?: string | null;
  } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

export default function PublicPagedBookList({
  books,
  username,
  signedMap
}: {
  books: PublicBook[];
  username: string;
  signedMap: Record<string, string>;
}) {
  return (
    <PagedBookList
      items={books}
      viewMode="grid"
      gridCols={4}
      containerStyle={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}
      renderItem={(b) => {
        const e = b.edition;
        const title = ((b.title_override ?? "").trim() || e?.title || "(untitled)") as string;
        const authors = ((b.authors_override ?? []).filter(Boolean).length > 0
          ? (b.authors_override ?? []).filter(Boolean)
          : (e?.authors ?? []).filter(Boolean)) as string[];
        const cover = (b.media ?? []).find((m) => m.kind === "cover");
        const coverUrl = cover ? signedMap[cover.storage_path] : e?.cover_url ?? null;
        const cropData = b.cover_crop ?? null;
        const imageSrc = cropData && b.cover_original_url ? (signedMap[b.cover_original_url] ?? coverUrl) : coverUrl;
        const href = `/u/${username}/b/${bookIdSlug(b.id, title)}`;
        return (
          <div key={b.id} className="om-book-card">
            <Link href={href} className="om-book-card-link" style={{ display: "block" }}>
              <div className="om-cover-slot" style={{ width: "100%", aspectRatio: "2 / 3" }}>
                <CoverImage alt={title} src={imageSrc} cropData={cropData} style={{ width: "100%", height: "100%", display: "block" }} />
              </div>
            </Link>
            <div style={{ marginTop: 8 }}>
              <Link href={href} className="om-book-title">
                {title}
              </Link>
            </div>
            <div className="om-book-secondary">
              {authors.length > 0
                ? authors.map((a, idx) => (
                    <span key={a}>
                      <Link href={`/u/${username}/a/${encodeURIComponent(a)}`}>{a}</Link>
                      {idx < authors.length - 1 ? <span>, </span> : null}
                    </span>
                  ))
                : "—"}
            </div>
          </div>
        );
      }}
    />
  );
}
