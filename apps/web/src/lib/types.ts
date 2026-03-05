import type { CoverCrop } from "../components/CoverImage";

export type PublicBook = {
  id: number;
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  title_override: string | null;
  authors_override: string[] | null;
  editors_override?: string[] | null;
  subjects_override: string[] | null;
  publisher_override: string | null;
  materials_override?: string | null;
  designers_override?: string[] | null;
  group_label?: string | null;
  object_type?: string | null;
  decade?: string | null;
  publish_date_override?: string | null;
  description_override?: string | null;
  location?: string | null;
  shelf?: string | null;
  status?: string | null;
  cover_original_url: string | null;
  cover_crop: CoverCrop | null;
  edition: { 
    id: number; 
    isbn13: string | null; 
    isbn10?: string | null;
    title: string | null; 
    authors: string[] | null; 
    cover_url: string | null;
    subjects: string[] | null;
    publisher: string | null;
    publish_date: string | null;
    description: string | null;
  } | null;
  media: Array<{ id?: number; kind: "cover" | "image"; storage_path: string; caption?: string | null; created_at?: string }>;
  book_tags?: Array<{ tag: { id: number; name: string; kind: "tag" | "category" } | null }>;
};

export type CatalogItem = PublicBook & {
  created_at: string;
  notes: string | null;
  book_tags?: Array<{ tag: { id: number; name: string; kind: "tag" | "category" } | null }>;
};

export type CatalogGroup = {
  key: string;
  libraryId: number;
  primary: PublicBook;
  copies: PublicBook[];
  copiesCount: number;
  tagNames: string[];
  categoryNames: string[];
  filterAuthors: string[];
  filterSubjects: string[];
  filterPublishers: string[];
  filterDesigners: string[];
  filterGroups: string[];
  filterDecades: string[];
  title: string;
  visibility: "inherit" | "followers_only" | "public" | "mixed";
  effectiveVisibility: "public" | "followers_only" | "mixed";
  latestCreatedAt: number;
  earliestCreatedAt: number;
};
