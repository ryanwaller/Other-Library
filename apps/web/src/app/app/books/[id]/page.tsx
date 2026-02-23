"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../../lib/supabaseClient";
import { bookIdSlug } from "../../../../lib/slug";
import AlsoOwnedBy from "../../../u/[username]/AlsoOwnedBy";
import SignInCard from "../../../components/SignInCard";

type UserBookDetail = {
  id: number;
  owner_id: string;
  library_id: number;
  visibility: "inherit" | "followers_only" | "public";
  status: "owned" | "loaned" | "selling" | "trading";
  borrowable_override: boolean | null;
  borrow_request_scope_override: "anyone" | "approved_followers" | null;
  title_override: string | null;
  authors_override: string[] | null;
  publisher_override: string | null;
  publish_date_override: string | null;
  description_override: string | null;
  subjects_override: string[] | null;
  location: string | null;
  shelf: string | null;
  notes: string | null;
  edition: {
    id: number;
    isbn10: string | null;
    isbn13: string | null;
    title: string | null;
    authors: string[] | null;
    publisher: string | null;
    publish_date: string | null;
    description: string | null;
    subjects: string[] | null;
    cover_url: string | null;
    raw: Record<string, unknown> | null;
  } | null;
  media: Array<{ id: number; kind: "cover" | "image"; storage_path: string; caption: string | null; created_at: string }>;
  book_tags: Array<{ tag: { id: number; name: string; kind: "tag" | "category" } | null }>;
};

type MetadataSearchResult = {
  source: "openlibrary" | "googleBooks";
  title: string | null;
  authors: string[];
  publisher: string | null;
  publish_date: string | null;
  publish_year: number | null;
  subjects: string[];
  isbn10: string | null;
  isbn13: string | null;
  cover_url: string | null;
};

type ImportPreview = {
  title: string | null;
  authors: string[];
  publisher: string | null;
  publish_date: string | null;
  description: string | null;
  subjects: string[];
  isbn10: string | null;
  isbn13: string | null;
  cover_url: string | null;
  cover_candidates: string[];
  sources: string[];
};

type MergeSource = {
  user_book_id: number;
  owner_id: string;
  owner_username: string | null;
  title_override: string | null;
  authors_override: string[] | null;
  publisher_override: string | null;
  publish_date_override: string | null;
  description_override: string | null;
  subjects_override: string[] | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
};

function normalizeTagName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function normalizeSubjectName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function safeFileName(name: string): string {
  return name.trim().replace(/[^\w.\-]+/g, "_").slice(0, 120) || "image";
}

function onEnter(e: KeyboardEvent<HTMLInputElement>, fn: () => void) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  fn();
}

function parseAuthorsInput(input: string): string[] {
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export default function BookDetailPage() {
  const params = useParams();
  const idParam = (params as any)?.id;
  const bookId = Number(Array.isArray(idParam) ? idParam[0] : idParam);

  const [session, setSession] = useState<Session | null>(null);
  const userId = session?.user?.id ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<UserBookDetail | null>(null);
  const [mediaUrlsByPath, setMediaUrlsByPath] = useState<Record<string, string>>({});
  const [ownerProfile, setOwnerProfile] = useState<{ username: string; visibility: "followers_only" | "public" } | null>(null);
  const [ownerBorrowDefaults, setOwnerBorrowDefaults] = useState<{ borrowable_default: boolean; borrow_request_scope: "anyone" | "approved_followers" } | null>(
    null
  );
  const [shareState, setShareState] = useState<{ error: string | null; message: string | null }>({ error: null, message: null });
  const [copiesCount, setCopiesCount] = useState<number | null>(null);
  const [copiesCountState, setCopiesCountState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [libraries, setLibraries] = useState<Array<{ id: number; name: string; created_at: string }>>([]);
  const [formLibraryId, setFormLibraryId] = useState<number | null>(null);
  const [libraryMoveState, setLibraryMoveState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [copiesDraft, setCopiesDraft] = useState<string>("");
  const [copiesUpdateState, setCopiesUpdateState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [formTitle, setFormTitle] = useState("");
  const [formAuthors, setFormAuthors] = useState("");
  const [formPublisher, setFormPublisher] = useState("");
  const [formPublishDate, setFormPublishDate] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formShelf, setFormShelf] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formVisibility, setFormVisibility] = useState<"inherit" | "followers_only" | "public">("inherit");
  const [formStatus, setFormStatus] = useState<"owned" | "loaned" | "selling" | "trading">("owned");
  const [formBorrowable, setFormBorrowable] = useState<"inherit" | "yes" | "no">("inherit");
  const [formBorrowScope, setFormBorrowScope] = useState<"inherit" | "anyone" | "approved_followers">("inherit");
  const [saveState, setSaveState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [newTag, setNewTag] = useState("");
  const [tagState, setTagState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [newCategory, setNewCategory] = useState("");
  const [categoryState, setCategoryState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [newSubject, setNewSubject] = useState("");
  const [subjectState, setSubjectState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [linkIsbn, setLinkIsbn] = useState("");
  const [linkState, setLinkState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  const [searchTitle, setSearchTitle] = useState("");
  const [searchAuthor, setSearchAuthor] = useState("");
  const [searchState, setSearchState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);

  const [importUrl, setImportUrl] = useState("");
  const [importState, setImportState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMeta, setImportMeta] = useState<{ final_url: string | null; domain: string | null; domain_kind: string | null; scraped_sources: string[] }>({
    final_url: null,
    domain: null,
    domain_kind: null,
    scraped_sources: []
  });

  const [pendingCover, setPendingCover] = useState<File | null>(null);
  const [coverState, setCoverState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });
  const [coverInputKey, setCoverInputKey] = useState(0);

  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [imagesState, setImagesState] = useState<{ busy: boolean; done: number; total: number; error: string | null; message: string | null }>({
    busy: false,
    done: 0,
    total: 0,
    error: null,
    message: null
  });
  const [imagesInputKey, setImagesInputKey] = useState(0);

  const [mergeSource, setMergeSource] = useState<MergeSource | null>(null);
  const [mergeState, setMergeState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null
  });

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) return;
      if (!userId) {
        setLibraries([]);
        return;
      }
      if (!book || book.owner_id !== userId) {
        setLibraries([]);
        return;
      }
      const res = await supabase.from("libraries").select("id,name,created_at").eq("owner_id", userId).order("created_at", { ascending: true });
      if (!alive) return;
      if (res.error) {
        setLibraries([]);
        return;
      }
      setLibraries((res.data ?? []) as any);
    })();
    return () => {
      alive = false;
    };
  }, [userId, book?.owner_id]);

  async function refresh() {
    if (!supabase) return;
    if (!Number.isFinite(bookId) || bookId <= 0) return;
    setBusy(true);
    setError(null);
    setOwnerProfile(null);
    setOwnerBorrowDefaults(null);
    setMergeSource(null);
    setMergeState({ busy: false, error: null, message: null });
    setCopiesCount(null);
    setCopiesCountState({ busy: false, error: null });
    try {
      const res = await supabase
        .from("user_books")
        .select(
          "id,owner_id,library_id,visibility,status,borrowable_override,borrow_request_scope_override,title_override,authors_override,publisher_override,publish_date_override,description_override,subjects_override,location,shelf,notes,edition:editions(id,isbn10,isbn13,title,authors,publisher,publish_date,description,subjects,cover_url,raw),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))"
        )
        .eq("id", bookId)
        .maybeSingle();
      if (res.error) throw new Error(res.error.message);
      const row = (res.data ?? null) as any as UserBookDetail | null;
      if (!row) {
        setBook(null);
        setError("Not found (or not visible).");
        return;
      }

      setBook(row);
      setFormTitle(row.title_override ?? "");
      setFormAuthors((row.authors_override ?? []).filter(Boolean).join(", "));
      setFormPublisher(row.publisher_override ?? row.edition?.publisher ?? "");
      setFormPublishDate(row.publish_date_override ?? row.edition?.publish_date ?? "");
      setFormDescription(row.description_override ?? row.edition?.description ?? "");
      setFormLocation(row.location ?? "");
      setFormShelf(row.shelf ?? "");
      setFormNotes(row.notes ?? "");
      setFormVisibility(row.visibility);
      setFormStatus(row.status);
      setFormLibraryId((row as any).library_id ?? null);
      setFormBorrowable(row.borrowable_override === null || row.borrowable_override === undefined ? "inherit" : row.borrowable_override ? "yes" : "no");
      setFormBorrowScope(
        row.borrow_request_scope_override === null || row.borrow_request_scope_override === undefined ? "inherit" : (row.borrow_request_scope_override as any)
      );

      setSearchTitle((row.title_override ?? row.edition?.title ?? "").trim());
      setSearchAuthor(((row.authors_override ?? row.edition?.authors ?? []) as string[]).filter(Boolean).slice(0, 1).join(", "));
      setSearchResults([]);
      setSearchState({ busy: false, error: null, message: null });
      setLinkState({ busy: false, error: null, message: null });

      const ownerId = row.owner_id as string | undefined;
      if (ownerId) {
        const profileRes = await supabase
          .from("profiles")
          .select("username,visibility,borrowable_default,borrow_request_scope")
          .eq("id", ownerId)
          .maybeSingle();
        if (!profileRes.error && profileRes.data?.username) {
          setOwnerProfile({ username: profileRes.data.username, visibility: profileRes.data.visibility as any });
          setOwnerBorrowDefaults({
            borrowable_default: Boolean((profileRes.data as any).borrowable_default),
            borrow_request_scope: ((profileRes.data as any).borrow_request_scope === "anyone" ? "anyone" : "approved_followers") as any
          });
        }
      }

      if (ownerId) {
        setCopiesCountState({ busy: true, error: null });
        try {
          const countWithinLibrary = userId && ownerId === userId ? ((row as any).library_id as number | null) : null;
          if (row.edition?.id) {
            let q = supabase
              .from("user_books")
              .select("id", { count: "exact", head: true })
              .eq("owner_id", ownerId)
              .eq("edition_id", row.edition.id);
            if (countWithinLibrary) q = q.eq("library_id", countWithinLibrary);
            const countRes = await q;
            if (countRes.error) throw new Error(countRes.error.message);
            setCopiesCount(countRes.count ?? 0);
            if (countWithinLibrary) setCopiesDraft(String(countRes.count ?? 0));
          } else {
            let q = supabase.from("user_books").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).is("edition_id", null);
            if (countWithinLibrary) q = q.eq("library_id", countWithinLibrary);
            if (row.title_override) q = q.eq("title_override", row.title_override);
            else q = q.is("title_override", null);
            if (row.authors_override && row.authors_override.length > 0) q = q.eq("authors_override", row.authors_override);
            else q = q.is("authors_override", null);
            const countRes = await q;
            if ((countRes as any).error) throw new Error((countRes as any).error.message);
            setCopiesCount((countRes as any).count ?? 0);
            if (countWithinLibrary) setCopiesDraft(String((countRes as any).count ?? 0));
          }
          setCopiesCountState({ busy: false, error: null });
        } catch (e: any) {
          setCopiesCountState({ busy: false, error: e?.message ?? "Failed to count copies" });
        }
      }

      const paths = Array.from(
        new Set(
          (row.media ?? [])
            .map((m) => (typeof m?.storage_path === "string" ? m.storage_path : ""))
            .filter(Boolean)
        )
      );
      if (paths.length > 0) {
        const signedRes = await supabase.storage.from("user-book-media").createSignedUrls(paths, 60 * 60);
        const next: Record<string, string> = {};
        for (const s of signedRes.data ?? []) {
          if (s.path && s.signedUrl) next[s.path] = s.signedUrl;
        }
        setMediaUrlsByPath(next);
      }

      // If you own this book and it's missing key metadata/media, look for a visible "source" to merge from.
      try {
        if (userId && row.owner_id === userId && row.edition?.id) {
          const hasCoverMedia = (row.media ?? []).some((m) => m.kind === "cover");
          const hasEditionCover = Boolean(row.edition.cover_url);
          const hasAnyImages = (row.media ?? []).some((m) => m.kind === "image");

          const missingTitle = !row.title_override && !row.edition.title;
          const missingAuthors = (!row.authors_override || row.authors_override.length === 0) && (!row.edition.authors || row.edition.authors.length === 0);
          const missingPublisher = !row.publisher_override && !row.edition.publisher;
          const missingPublishDate = !row.publish_date_override && !row.edition.publish_date;
          const missingDescription = !row.description_override && !row.edition.description;
          const missingSubjects = (!row.subjects_override || row.subjects_override.length === 0) && (!row.edition.subjects || row.edition.subjects.length === 0);

          const needsAny =
            (!hasCoverMedia && !hasEditionCover) ||
            !hasAnyImages ||
            missingTitle ||
            missingAuthors ||
            missingPublisher ||
            missingPublishDate ||
            missingDescription ||
            missingSubjects;

          if (needsAny) {
            const cand = await supabase
              .from("user_books")
              .select(
                "id,owner_id,title_override,authors_override,publisher_override,publish_date_override,description_override,subjects_override,media:user_book_media(kind,storage_path)"
              )
              .eq("edition_id", row.edition.id)
              .neq("owner_id", userId)
              .limit(20);
            if (!cand.error) {
              const rows = (cand.data ?? []) as any[];
              let best: any | null = null;
              let bestScore = -1;
              for (const r of rows) {
                const media = (r.media ?? []) as any[];
                const hasCover = media.some((m) => m.kind === "cover" && m.storage_path);
                const hasImgs = media.some((m) => m.kind === "image" && m.storage_path);
                let score = 0;
                if (hasCover) score += 100;
                if (hasImgs) score += 10;
                if (r.publisher_override) score += 2;
                if (r.publish_date_override) score += 1;
                if (r.description_override) score += 1;
                if (Array.isArray(r.subjects_override) && r.subjects_override.length > 0) score += 1;
                if (Array.isArray(r.authors_override) && r.authors_override.length > 0) score += 1;
                if (r.title_override) score += 1;
                if (score > bestScore) {
                  bestScore = score;
                  best = r;
                }
              }

              if (best && bestScore > 0) {
                const profileRes = await supabase.from("profiles").select("username").eq("id", best.owner_id).maybeSingle();
                const owner_username = (profileRes.data?.username as string | undefined) ?? null;
                setMergeSource({
                  user_book_id: best.id as number,
                  owner_id: best.owner_id as string,
                  owner_username,
                  title_override: best.title_override ?? null,
                  authors_override: (best.authors_override ?? null) as any,
                  publisher_override: best.publisher_override ?? null,
                  publish_date_override: best.publish_date_override ?? null,
                  description_override: best.description_override ?? null,
                  subjects_override: (best.subjects_override ?? null) as any,
                  media: ((best.media ?? []) as any[])
                    .filter((m) => (m.kind === "cover" || m.kind === "image") && typeof m.storage_path === "string" && m.storage_path)
                    .map((m) => ({ kind: m.kind as "cover" | "image", storage_path: m.storage_path as string }))
                });
              }
            }
          }
        }
      } catch {
        // best-effort only
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load book");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, userId]);

  const effectiveTitle = useMemo(() => {
    return formTitle.trim() ? formTitle.trim() : book?.edition?.title ?? "(untitled)";
  }, [formTitle, book]);

  const effectivePublisher = useMemo(() => {
    return formPublisher.trim() ? formPublisher.trim() : book?.edition?.publisher ?? "";
  }, [formPublisher, book]);

  const effectivePublishDate = useMemo(() => {
    return formPublishDate.trim() ? formPublishDate.trim() : book?.edition?.publish_date ?? "";
  }, [formPublishDate, book]);

  const effectiveDescription = useMemo(() => {
    return formDescription.trim() ? formDescription.trim() : book?.edition?.description ?? "";
  }, [formDescription, book]);

  const effectiveAuthors = useMemo(() => {
    const override = parseAuthorsInput(formAuthors);
    if (override.length > 0) return override;
    return (book?.edition?.authors ?? []).filter(Boolean);
  }, [formAuthors, book]);

  const copiesLabel = useMemo(() => {
    if (!book?.owner_id) return "Copies";
    if (userId && book.owner_id === userId) return "Your copies";
    return "Copies";
  }, [book?.owner_id, userId]);

  const effectiveSubjects = useMemo(() => {
    const override = book?.subjects_override;
    if (override !== null && override !== undefined) return (override ?? []).filter(Boolean);
    return (book?.edition?.subjects ?? []).filter(Boolean);
  }, [book]);

  const tags = useMemo(() => {
    const all = ((book?.book_tags ?? []).map((bt) => bt.tag).filter(Boolean) as any[]).filter((t) => t?.id && t?.name);
    return all
      .filter((t) => t.kind === "tag")
      .map((t) => ({ id: t.id as number, name: String(t.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [book]);

  const categories = useMemo(() => {
    const all = ((book?.book_tags ?? []).map((bt) => bt.tag).filter(Boolean) as any[]).filter((t) => t?.id && t?.name);
    return all
      .filter((t) => t.kind === "category")
      .map((t) => ({ id: t.id as number, name: String(t.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [book]);

  const coverMedia = useMemo(() => (book?.media ?? []).find((m) => m.kind === "cover") ?? null, [book]);
  const coverUrl = coverMedia ? mediaUrlsByPath[coverMedia.storage_path] : book?.edition?.cover_url ?? null;
  const imageMedia = useMemo(() => (book?.media ?? []).filter((m) => m.kind === "image") ?? [], [book]);

  const publicBookPath = useMemo(() => {
    if (!book || !ownerProfile?.username) return null;
    return `/u/${ownerProfile.username}/b/${bookIdSlug(book.id, effectiveTitle)}`;
  }, [book, ownerProfile, effectiveTitle]);

  const publicBookUrl = useMemo(() => {
    if (!publicBookPath) return null;
    if (typeof window === "undefined") return publicBookPath;
    try {
      const url = new URL(window.location.origin);
      if (url.hostname.startsWith("app.")) {
        url.hostname = url.hostname.slice("app.".length);
      }
      return `${url.origin}${publicBookPath}`;
    } catch {
      return publicBookPath;
    }
  }, [publicBookPath]);

  const isPubliclyVisible = useMemo(() => {
    if (!book) return false;
    if (book.visibility === "public") return true;
    if (book.visibility === "inherit" && ownerProfile?.visibility === "public") return true;
    return false;
  }, [book, ownerProfile]);

  const editionId = useMemo(() => {
    return book?.edition?.id ?? null;
  }, [book]);

  async function copyPublicLink() {
    if (!publicBookUrl) return;
    setShareState({ error: null, message: null });
    try {
      await navigator.clipboard.writeText(publicBookUrl);
      setShareState({ error: null, message: "Copied" });
      window.setTimeout(() => setShareState({ error: null, message: null }), 1500);
    } catch (e: any) {
      setShareState({ error: e?.message ?? "Copy failed", message: "Copy failed" });
    }
  }

  async function saveEdits() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    setSaveState({ busy: true, error: null, message: "Saving…" });
    const title_override = formTitle.trim() ? formTitle.trim() : null;
    const authors_override = parseAuthorsInput(formAuthors);
    const payload = {
      title_override,
      authors_override: authors_override.length > 0 ? authors_override : null,
      publisher_override: formPublisher.trim() ? formPublisher.trim() : null,
      publish_date_override: formPublishDate.trim() ? formPublishDate.trim() : null,
      description_override: formDescription.trim() ? formDescription.trim() : null,
      location: formLocation.trim() ? formLocation.trim() : null,
      shelf: formShelf.trim() ? formShelf.trim() : null,
      notes: formNotes.trim() ? formNotes.trim() : null,
      visibility: formVisibility,
      status: formStatus,
      borrowable_override: formBorrowable === "inherit" ? null : formBorrowable === "yes",
      borrow_request_scope_override: formBorrowScope === "inherit" ? null : formBorrowScope
    };
    const res = await supabase.from("user_books").update(payload).eq("id", book.id);
    if (res.error) {
      setSaveState({ busy: false, error: res.error.message, message: "Save failed" });
      return;
    }
    await refresh();
    setSaveState({ busy: false, error: null, message: "Saved" });
  }

  async function moveToLibrary(nextLibraryId: number) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    if (!nextLibraryId || !Number.isFinite(nextLibraryId)) return;
    setLibraryMoveState({ busy: true, error: null, message: "Moving…" });
    try {
      const upd = await supabase.from("user_books").update({ library_id: nextLibraryId }).eq("id", book.id);
      if (upd.error) throw new Error(upd.error.message);
      setFormLibraryId(nextLibraryId);
      try {
        window.localStorage.setItem("om_currentLibraryId", String(nextLibraryId));
      } catch {
        // ignore
      }
      await refresh();
      setLibraryMoveState({ busy: false, error: null, message: "Moved" });
      window.setTimeout(() => setLibraryMoveState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setLibraryMoveState({ busy: false, error: e?.message ?? "Move failed", message: "Move failed" });
    }
  }

  async function updateCopies() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    const libId = formLibraryId ?? (book as any).library_id ?? null;
    if (!libId) return;
    const desired = Number(copiesDraft);
    if (!Number.isFinite(desired) || desired < 1) {
      setCopiesUpdateState({ busy: false, error: "Copies must be at least 1", message: "Invalid" });
      return;
    }

    setCopiesUpdateState({ busy: true, error: null, message: "Updating…" });
    try {
      let q = supabase.from("user_books").select("id,created_at").eq("owner_id", userId).eq("library_id", libId);
      if (book.edition?.id) {
        q = q.eq("edition_id", book.edition.id);
      } else {
        q = q.is("edition_id", null);
        if (book.title_override) q = q.eq("title_override", book.title_override);
        else q = q.is("title_override", null);
        if (book.authors_override && book.authors_override.length > 0) q = q.eq("authors_override", book.authors_override);
        else q = q.is("authors_override", null);
      }

      const existing = await q.order("created_at", { ascending: false }).limit(200);
      if (existing.error) throw new Error(existing.error.message);
      const ids = ((existing.data ?? []) as any[]).map((r) => r.id as number).filter((n) => Number.isFinite(n));
      const current = ids.length;

      if (desired === current) {
        setCopiesUpdateState({ busy: false, error: null, message: "No change" });
        window.setTimeout(() => setCopiesUpdateState({ busy: false, error: null, message: null }), 1200);
        return;
      }

      if (desired > current) {
        const toAdd = desired - current;
        const payloadBase: any = {
          owner_id: userId,
          library_id: libId,
          edition_id: book.edition?.id ?? null,
          visibility: formVisibility,
          status: formStatus,
          title_override: book.title_override ?? null,
          authors_override: (book.authors_override ?? null) as any,
          publisher_override: book.publisher_override ?? null,
          publish_date_override: book.publish_date_override ?? null,
          description_override: book.description_override ?? null,
          subjects_override: book.subjects_override ?? null,
          location: null,
          shelf: null,
          notes: null
        };
        const rows = Array.from({ length: toAdd }, () => ({ ...payloadBase }));
        const ins = await supabase.from("user_books").insert(rows as any);
        if (ins.error) throw new Error(ins.error.message);
      } else {
        const toRemove = current - desired;
        const removable = ids.filter((id) => id !== book.id);
        const idsToDelete = removable.slice(0, toRemove);
        if (idsToDelete.length < toRemove) throw new Error("To reduce copies below 1, use Delete instead.");
        const del = await supabase.from("user_books").delete().in("id", idsToDelete);
        if (del.error) throw new Error(del.error.message);
      }

      await refresh();
      setCopiesUpdateState({ busy: false, error: null, message: "Updated" });
      window.setTimeout(() => setCopiesUpdateState({ busy: false, error: null, message: null }), 1200);
    } catch (e: any) {
      setCopiesUpdateState({ busy: false, error: e?.message ?? "Update failed", message: "Update failed" });
    }
  }

  async function getOrCreateTagId(name: string, kind: "tag" | "category"): Promise<number> {
    if (!supabase || !userId) throw new Error("Not signed in");
    const normalized = normalizeTagName(name);
    const existing = await supabase.from("tags").select("id").eq("owner_id", userId).eq("name", normalized).eq("kind", kind).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.id) return existing.data.id as number;
    const inserted = await supabase.from("tags").insert({ owner_id: userId, name: normalized, kind }).select("id").single();
    if (inserted.error) throw new Error(inserted.error.message);
    return inserted.data.id as number;
  }

  async function addTag() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    const name = normalizeTagName(newTag);
    if (!name) return;
    setTagState({ busy: true, error: null, message: "Adding…" });
    try {
      const tagId = await getOrCreateTagId(name, "tag");
      const ins = await supabase.from("user_book_tags").insert({ user_book_id: book.id, tag_id: tagId });
      if (ins.error && !ins.error.message.toLowerCase().includes("duplicate")) throw new Error(ins.error.message);
      setNewTag("");
      await refresh();
      setTagState({ busy: false, error: null, message: "Added" });
    } catch (e: any) {
      setTagState({ busy: false, error: e?.message ?? "Add failed", message: "Add failed" });
    }
  }

  async function removeTag(tagId: number) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    setTagState({ busy: true, error: null, message: "Removing…" });
    const del = await supabase.from("user_book_tags").delete().eq("user_book_id", book.id).eq("tag_id", tagId);
    if (del.error) {
      setTagState({ busy: false, error: del.error.message, message: "Remove failed" });
      return;
    }
    await refresh();
    setTagState({ busy: false, error: null, message: "Removed" });
  }

  async function addCategory() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    const name = normalizeTagName(newCategory);
    if (!name) return;
    setCategoryState({ busy: true, error: null, message: "Adding…" });
    try {
      const tagId = await getOrCreateTagId(name, "category");
      const ins = await supabase.from("user_book_tags").insert({ user_book_id: book.id, tag_id: tagId });
      if (ins.error && !ins.error.message.toLowerCase().includes("duplicate")) throw new Error(ins.error.message);
      setNewCategory("");
      await refresh();
      setCategoryState({ busy: false, error: null, message: "Added" });
    } catch (e: any) {
      setCategoryState({ busy: false, error: e?.message ?? "Add failed", message: "Add failed" });
    }
  }

  async function removeCategory(tagId: number) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    setCategoryState({ busy: true, error: null, message: "Removing…" });
    const del = await supabase.from("user_book_tags").delete().eq("user_book_id", book.id).eq("tag_id", tagId);
    if (del.error) {
      setCategoryState({ busy: false, error: del.error.message, message: "Remove failed" });
      return;
    }
    await refresh();
    setCategoryState({ busy: false, error: null, message: "Removed" });
  }

  async function addSubject() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    const name = normalizeSubjectName(newSubject);
    if (!name) return;
    setSubjectState({ busy: true, error: null, message: "Adding…" });
    const current = (effectiveSubjects ?? []).slice();
    const exists = current.some((s) => s.toLowerCase() === name.toLowerCase());
    const next = exists ? current : [...current, name];
    next.sort((a, b) => a.localeCompare(b));
    const upd = await supabase.from("user_books").update({ subjects_override: next }).eq("id", book.id);
    if (upd.error) {
      setSubjectState({ busy: false, error: upd.error.message, message: "Add failed" });
      return;
    }
    setNewSubject("");
    await refresh();
    setSubjectState({ busy: false, error: null, message: "Added" });
  }

  async function removeSubject(name: string) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    setSubjectState({ busy: true, error: null, message: "Removing…" });
    const current = (effectiveSubjects ?? []).slice();
    const next = current.filter((s) => s.toLowerCase() !== name.toLowerCase());
    const upd = await supabase.from("user_books").update({ subjects_override: next }).eq("id", book.id);
    if (upd.error) {
      setSubjectState({ busy: false, error: upd.error.message, message: "Remove failed" });
      return;
    }
    await refresh();
    setSubjectState({ busy: false, error: null, message: "Removed" });
  }

  async function uploadCover() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    if (!pendingCover) return;
    setCoverState({ busy: true, error: null, message: "Uploading cover…" });

    const path = `${userId}/${book.id}/cover-${Date.now()}-${safeFileName(pendingCover.name)}`;
    const up = await supabase.storage.from("user-book-media").upload(path, pendingCover, {
      cacheControl: "3600",
      upsert: false,
      contentType: pendingCover.type || "application/octet-stream"
    });
    if (up.error) {
      setCoverState({ busy: false, error: up.error.message, message: "Upload failed" });
      return;
    }

    const inserted = await supabase
      .from("user_book_media")
      .insert({ user_book_id: book.id, kind: "cover", storage_path: path, caption: null })
      .select("id")
      .single();
    if (inserted.error) {
      setCoverState({ busy: false, error: inserted.error.message, message: "Upload failed" });
      return;
    }

    await supabase
      .from("user_book_media")
      .update({ kind: "image" })
      .eq("user_book_id", book.id)
      .eq("kind", "cover")
      .neq("id", inserted.data.id);

    setPendingCover(null);
    setCoverInputKey((k) => k + 1);
    await refresh();
    setCoverState({ busy: false, error: null, message: "Cover uploaded" });
  }

  async function setAsCover(mediaId: number) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    setCoverState({ busy: true, error: null, message: "Setting cover…" });
    const demote = await supabase.from("user_book_media").update({ kind: "image" }).eq("user_book_id", book.id).eq("kind", "cover");
    if (demote.error) {
      setCoverState({ busy: false, error: demote.error.message, message: "Failed" });
      return;
    }
    const promote = await supabase.from("user_book_media").update({ kind: "cover" }).eq("id", mediaId);
    if (promote.error) {
      setCoverState({ busy: false, error: promote.error.message, message: "Failed" });
      return;
    }
    await refresh();
    setCoverState({ busy: false, error: null, message: "Updated" });
  }

  async function deleteMedia(mediaId: number, storagePath: string) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    if (!window.confirm("Delete this image?")) return;
    const rm = await supabase.storage.from("user-book-media").remove([storagePath]);
    if (rm.error) {
      setImagesState((s) => ({ ...s, error: rm.error?.message ?? "Delete failed", message: "Delete failed" }));
      return;
    }
    const del = await supabase.from("user_book_media").delete().eq("id", mediaId);
    if (del.error) {
      setImagesState((s) => ({ ...s, error: del.error?.message ?? "Delete failed", message: "Delete failed" }));
      return;
    }
    await refresh();
  }

  function selectPendingImages(files: FileList | null) {
    const picked = Array.from(files ?? []).filter((f) => f.size > 0);
    setPendingImages(picked);
    setImagesState({ busy: false, done: 0, total: picked.length, error: null, message: picked.length ? `${picked.length} selected` : null });
  }

  function clearPendingImages() {
    setPendingImages([]);
    setImagesInputKey((k) => k + 1);
    setImagesState({ busy: false, done: 0, total: 0, error: null, message: null });
  }

  async function uploadImages() {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;
    if (pendingImages.length === 0) return;

    setImagesState({ busy: true, done: 0, total: pendingImages.length, error: null, message: "Uploading…" });

    let done = 0;
    let lastError: string | null = null;

    for (const file of pendingImages) {
      const path = `${userId}/${book.id}/${Date.now()}-${safeFileName(file.name)}`;
      const up = await supabase.storage.from("user-book-media").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "application/octet-stream"
      });
      if (up.error) {
        lastError = up.error.message;
      } else {
        const ins = await supabase.from("user_book_media").insert({ user_book_id: book.id, kind: "image", storage_path: path, caption: null });
        if (ins.error) lastError = ins.error.message;
      }

      done += 1;
      setImagesState({ busy: true, done, total: pendingImages.length, error: lastError, message: `Uploading ${done}/${pendingImages.length}…` });
    }

    await refresh();
    clearPendingImages();
    setImagesState({
      busy: false,
      done: pendingImages.length,
      total: pendingImages.length,
      error: lastError,
      message: lastError ? "Finished with errors" : "Uploaded"
    });
  }

  async function searchMetadata() {
    const title = searchTitle.trim();
    const author = searchAuthor.trim();
    if (!title) return;
    setSearchState({ busy: true, error: null, message: "Searching…" });
    setSearchResults([]);
    try {
      const res = await fetch(`/api/search?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Search failed");
      setSearchResults((json.results ?? []) as MetadataSearchResult[]);
      setSearchState({ busy: false, error: null, message: (json.results ?? []).length ? "Done" : "No results" });
    } catch (e: any) {
      setSearchState({ busy: false, error: e?.message ?? "Search failed", message: "Search failed" });
    }
  }

  async function previewImportFromUrl() {
    const url = importUrl.trim();
    if (!url) return;
    setImportState({ busy: true, error: null, message: "Importing…" });
    setImportPreview(null);
    setImportMeta({ final_url: null, domain: null, domain_kind: null, scraped_sources: [] });
    try {
      const res = await fetch("/api/import-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Import failed");
      const preview = (json.preview ?? null) as ImportPreview | null;
      setImportPreview(preview);
      setImportMeta({
        final_url: typeof json.final_url === "string" ? json.final_url : null,
        domain: typeof json.domain === "string" ? json.domain : null,
        domain_kind: typeof json.domain_kind === "string" ? json.domain_kind : null,
        scraped_sources: Array.isArray(json.scraped?.sources) ? (json.scraped.sources as string[]) : []
      });
      setImportState({ busy: false, error: null, message: preview ? "Preview ready" : "No preview" });
    } catch (e: any) {
      setImportState({ busy: false, error: e?.message ?? "Import failed", message: "Import failed" });
    }
  }

  async function linkEditionByIsbn(isbn: string) {
    if (!supabase || !book || !userId) return;
    if (book.owner_id !== userId) return;

    const value = isbn.trim();
    if (!value) return;

    setLinkState({ busy: true, error: null, message: "Looking up ISBN…" });

    try {
      const res = await fetch(`/api/isbn?isbn=${encodeURIComponent(value)}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "ISBN lookup failed");
      const edition = (json.edition ?? {}) as any;
      const isbn13 = String(edition.isbn13 ?? "").trim();
      if (!isbn13) throw new Error("No ISBN-13 returned by resolver");

      const existing = await supabase.from("editions").select("id").eq("isbn13", isbn13).maybeSingle();
      if (existing.error) throw new Error(existing.error.message);

      let editionId = existing.data?.id as number | undefined;
      if (!editionId) {
        const inserted = await supabase
          .from("editions")
          .insert({
            isbn10: edition.isbn10 ?? null,
            isbn13,
            title: edition.title ?? null,
            authors: edition.authors ?? [],
            publisher: edition.publisher ?? null,
            publish_date: edition.publish_date ?? null,
            description: edition.description ?? null,
            subjects: edition.subjects ?? [],
            cover_url: edition.cover_url ?? null,
            raw: edition.raw ?? null
          })
          .select("id")
          .single();
        if (inserted.error) throw new Error(inserted.error.message);
        editionId = inserted.data.id as number;
      }

      const upd = await supabase.from("user_books").update({ edition_id: editionId }).eq("id", book.id);
      if (upd.error) throw new Error(upd.error.message);

      setLinkIsbn("");
      await refresh();
      setLinkState({ busy: false, error: null, message: "Linked" });
      window.setTimeout(() => setLinkState({ busy: false, error: null, message: null }), 1500);
    } catch (e: any) {
      setLinkState({ busy: false, error: e?.message ?? "Link failed", message: "Link failed" });
    }
  }

  async function mergeFromSource() {
    if (!supabase || !book || !mergeSource || !userId) return;
    if (book.owner_id !== userId) return;
    if (!window.confirm(`Merge missing metadata + images from ${mergeSource.owner_username ? `@${mergeSource.owner_username}` : "another user"}? This will only fill missing fields and add media to your copy.`)) {
      return;
    }

    setMergeState({ busy: true, error: null, message: "Merging…" });
    try {
      const updates: any = {};

      const needsTitle = !book.title_override && !book.edition?.title;
      const needsAuthors = (!book.authors_override || book.authors_override.length === 0) && (!book.edition?.authors || book.edition.authors.length === 0);
      const needsPublisher = !book.publisher_override && !book.edition?.publisher;
      const needsPublishDate = !book.publish_date_override && !book.edition?.publish_date;
      const needsDescription = !book.description_override && !book.edition?.description;
      const needsSubjects = (!book.subjects_override || book.subjects_override.length === 0) && (!book.edition?.subjects || book.edition.subjects.length === 0);

      if (needsTitle && mergeSource.title_override) updates.title_override = mergeSource.title_override;
      if (needsAuthors && mergeSource.authors_override && mergeSource.authors_override.length > 0) updates.authors_override = mergeSource.authors_override;
      if (needsPublisher && mergeSource.publisher_override) updates.publisher_override = mergeSource.publisher_override;
      if (needsPublishDate && mergeSource.publish_date_override) updates.publish_date_override = mergeSource.publish_date_override;
      if (needsDescription && mergeSource.description_override) updates.description_override = mergeSource.description_override;
      if (needsSubjects && mergeSource.subjects_override && mergeSource.subjects_override.length > 0) updates.subjects_override = mergeSource.subjects_override;

      if (Object.keys(updates).length > 0) {
        const upd = await supabase.from("user_books").update(updates).eq("id", book.id);
        if (upd.error) throw new Error(upd.error.message);
      }

      const existingCover = (book.media ?? []).some((m) => m.kind === "cover");
      const existingImages = (book.media ?? []).some((m) => m.kind === "image");
      const toCopy = mergeSource.media.filter((m) => {
        if (m.kind === "cover") return !existingCover && !book.edition?.cover_url;
        return !existingImages;
      });

      for (const m of toCopy) {
        const signed = await supabase.storage.from("user-book-media").createSignedUrl(m.storage_path, 60 * 15);
        if (signed.error || !signed.data?.signedUrl) continue;
        const resp = await fetch(signed.data.signedUrl);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const fileName = safeFileName(String(m.storage_path.split("/").pop() ?? "image"));
        const destPath = `${userId}/${book.id}/merge-${Date.now()}-${fileName}`;
        const up = await supabase.storage.from("user-book-media").upload(destPath, blob, {
          cacheControl: "3600",
          upsert: false,
          contentType: resp.headers.get("content-type") || "application/octet-stream"
        });
        if (up.error) continue;
        const ins = await supabase.from("user_book_media").insert({ user_book_id: book.id, kind: m.kind, storage_path: destPath, caption: null });
        if (ins.error) {
          // ignore; still uploaded
        }
      }

      await refresh();
      setMergeState({ busy: false, error: null, message: "Merged" });
      window.setTimeout(() => setMergeState({ busy: false, error: null, message: null }), 1500);
    } catch (e: any) {
      setMergeState({ busy: false, error: e?.message ?? "Merge failed", message: "Merge failed" });
    }
  }

  if (!supabase) {
    return (
      <main className="container">
        <div className="card">
          <div>Supabase is not configured.</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See <a href="/setup">/setup</a>.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="muted">
          <Link href="/app">Home</Link>
        </div>
        <div className="row">
          <Link href="/app/settings">Settings</Link>
          {session ? <button onClick={() => supabase?.auth.signOut()}>Sign out</button> : null}
        </div>
      </div>

      {!session ? (
        <SignInCard note="Sign in to view and edit this book." />
      ) : !Number.isFinite(bookId) || bookId <= 0 ? (
        <div className="card">
          <div>Invalid book id.</div>
        </div>
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>{effectiveTitle}</div>
            <div className="muted">{busy ? "Loading…" : error ? error : ""}</div>
          </div>

          <div style={{ marginTop: 10 }} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Share public link</div>
              <div className="muted">{isPubliclyVisible ? "public" : "not public"}</div>
            </div>
            {publicBookUrl ? (
              <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                <a href={publicBookUrl} target="_blank" rel="noreferrer">
                  {publicBookUrl}
                </a>
                <button onClick={copyPublicLink}>
                  Copy
                </button>
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 8 }}>
                Loading…
              </div>
            )}
            {!isPubliclyVisible ? (
              <div className="muted" style={{ marginTop: 8 }}>
                To make this link work for anyone, set Visibility to <span>public</span> (in Your fields) and save.
              </div>
            ) : null}
            {shareState.message ? (
              <div className="muted" style={{ marginTop: 6 }}>
                {shareState.error ? `${shareState.message} (${shareState.error})` : shareState.message}
              </div>
            ) : null}
          </div>

          {mergeSource && book?.owner_id === userId ? (
            <div style={{ marginTop: 10 }} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>Merge from community</div>
                <div className="muted">{mergeSource.owner_username ? `@${mergeSource.owner_username}` : "available"}</div>
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                If another user has added a cover, images, or filled-in metadata for this same edition, you can copy it into your copy (fills missing fields only).
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={mergeFromSource} disabled={mergeState.busy}>
                  {mergeState.busy ? "Merging…" : "Merge missing fields + images"}
                </button>
                <div className="muted">{mergeState.message ? (mergeState.error ? `${mergeState.message} (${mergeState.error})` : mergeState.message) : ""}</div>
              </div>
            </div>
          ) : null}

          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "220px 1fr", gap: 14 }}>
            <div>
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={effectiveTitle}
                  src={coverUrl}
                  style={{ width: "100%", height: 280, objectFit: "contain", border: "1px solid var(--border)" }}
                />
              ) : (
                <div style={{ width: "100%", height: 280, border: "1px solid var(--border)" }} />
              )}

              <div style={{ marginTop: 10 }}>
                <div className="muted">Cover override</div>
                <input key={coverInputKey} type="file" accept="image/*" onChange={(ev) => setPendingCover((ev.target.files ?? [])[0] ?? null)} style={{ marginTop: 6 }} />
                {pendingCover ? (
                  <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                    <button onClick={uploadCover} disabled={coverState.busy}>
                      {coverState.busy ? "Uploading…" : "Submit cover"}
                    </button>
                    <button
                      onClick={() => {
                        setPendingCover(null);
                        setCoverInputKey((k) => k + 1);
                      }}
                      disabled={coverState.busy}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
                {coverState.message ? (
                  <div className="muted" style={{ marginTop: 6 }}>
                    {coverState.error ? `${coverState.message} (${coverState.error})` : coverState.message}
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <div className="muted">Authors</div>
              <div style={{ marginTop: 4 }}>
                {effectiveAuthors.length > 0 ? (
                  <>
                    {effectiveAuthors.map((a, idx) => (
                      <span key={a}>
                        <Link href={`/app?author=${encodeURIComponent(a)}`}>{a}</Link>
                        {idx < effectiveAuthors.length - 1 ? <span>, </span> : null}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>

              <div style={{ marginTop: 14 }} className="muted">
                Metadata
              </div>
              <div style={{ marginTop: 6 }}>
                <div className="row">
                  <div style={{ minWidth: 110 }} className="muted">
                    ISBN
                  </div>
                  <div>{book?.edition?.isbn13 ?? book?.edition?.isbn10 ?? "—"}</div>
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Publisher
                  </div>
                  <div>
                    {effectivePublisher ? <Link href={`/app?publisher=${encodeURIComponent(effectivePublisher)}`}>{effectivePublisher}</Link> : "—"}
                  </div>
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Publish date
                  </div>
                  <div>{effectivePublishDate || "—"}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="muted">Subjects</div>
                  <div style={{ marginTop: 6 }}>
                    {effectiveSubjects.length > 0 ? (
                      effectiveSubjects.map((s) => (
                        <span key={s} style={{ marginRight: 10 }}>
                          <Link href={`/app?subject=${encodeURIComponent(s)}`}>{s}</Link>
                        </span>
                      ))
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="muted">Description</div>
                  <div className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                    {effectiveDescription || "—"}
                  </div>
                </div>
                {book?.edition?.cover_url ? (
                  <div style={{ marginTop: 8 }} className="muted">
                    Online cover:{" "}
                    <a href={book.edition.cover_url} target="_blank" rel="noreferrer">
                      open
                    </a>
                  </div>
                ) : null}
                <details style={{ marginTop: 10 }}>
                  <summary className="muted">Raw metadata</summary>
                  <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(book?.edition?.raw ?? {}, null, 2)}</pre>
                </details>
              </div>

              <div style={{ marginTop: 14 }} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>Link edition (ISBN)</div>
                  <div className="muted">{book?.edition ? "linked" : "not linked"}</div>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <input
                    placeholder="ISBN-10 or ISBN-13"
                    value={linkIsbn}
                    onChange={(e) => setLinkIsbn(e.target.value)}
                    onKeyDown={(e) => onEnter(e, () => linkEditionByIsbn(linkIsbn))}
                    style={{ width: 260 }}
                  />
                  <button onClick={() => linkEditionByIsbn(linkIsbn)} disabled={linkState.busy || !linkIsbn.trim()}>
                    {linkState.busy ? "Linking…" : "Link"}
                  </button>
                  <span className="muted" style={{ marginLeft: 10 }}>
                    {linkState.message ? (linkState.error ? `${linkState.message} (${linkState.error})` : linkState.message) : ""}
                  </span>
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  This upgrades a manual entry by attaching global metadata (covers/subjects/etc). Your overrides stay as-is.
                </div>
              </div>

              <div style={{ marginTop: 10 }} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>Find metadata by title/author</div>
                  <div className="muted">free sources</div>
                </div>
                <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                  <input
                    placeholder="Title"
                    value={searchTitle}
                    onChange={(e) => setSearchTitle(e.target.value)}
                    onKeyDown={(e) => onEnter(e, searchMetadata)}
                    style={{ width: 260 }}
                  />
                  <input
                    placeholder="Author (optional)"
                    value={searchAuthor}
                    onChange={(e) => setSearchAuthor(e.target.value)}
                    onKeyDown={(e) => onEnter(e, searchMetadata)}
                    style={{ width: 220 }}
                  />
                  <button onClick={searchMetadata} disabled={searchState.busy || !searchTitle.trim()}>
                    {searchState.busy ? "Searching…" : "Search"}
                  </button>
                  <span className="muted" style={{ marginLeft: 10 }}>
                    {searchState.message ? (searchState.error ? `${searchState.message} (${searchState.error})` : searchState.message) : ""}
                  </span>
                </div>
                {searchResults.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    {searchResults.map((r, idx) => {
                      const bestIsbn = r.isbn13 ?? r.isbn10 ?? "";
                      const title = (r.title ?? "").trim() || "—";
                      const authors = (r.authors ?? []).filter(Boolean).join(", ");
                      const pub = [r.publisher ?? "", r.publish_date ?? (r.publish_year ? String(r.publish_year) : "")]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div key={`${r.source}:${bestIsbn || title}:${idx}`} className="card" style={{ marginTop: 8 }}>
                          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                            <div style={{ width: 62, flex: "0 0 auto" }}>
                              {r.cover_url ? (
                                <img
                                  src={r.cover_url}
                                  alt=""
                                  width={60}
                                  height={90}
                                  style={{ display: "block", objectFit: "cover", border: "1px solid var(--border)" }}
                                />
                              ) : (
                                <div style={{ width: 60, height: 90, border: "1px solid var(--border)" }} />
                              )}
                            </div>
                            <div>
                              <div>{title}</div>
                              <div className="muted" style={{ marginTop: 4 }}>
                                {authors || "—"}
                                {pub ? ` · ${pub}` : ""}
                              </div>
                              <div className="muted" style={{ marginTop: 4 }}>
                                {bestIsbn ? `ISBN: ${bestIsbn}` : "No ISBN found"}
                                {r.cover_url ? (
                                  <>
                                    {" "}
                                    ·{" "}
                                    <a href={r.cover_url} target="_blank" rel="noreferrer">
                                      cover
                                    </a>
                                  </>
                                ) : null}
                                {" "}
                                · {r.source}
                              </div>
                            </div>
                            <div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                                <button onClick={() => linkEditionByIsbn(bestIsbn)} disabled={linkState.busy || !bestIsbn}>
                                  Link ISBN
                                </button>
                                <button
                                  onClick={() => {
                                    if (r.title) setFormTitle(r.title);
                                    setFormAuthors((r.authors ?? []).filter(Boolean).join(", "));
                                    if (r.publisher) setFormPublisher(r.publisher);
                                    if (r.publish_date) setFormPublishDate(r.publish_date);
                                    setSearchState((s) => ({ ...s, message: "Filled fields (not saved)" }));
                                  }}
                                  disabled={!r.title && (!r.authors || r.authors.length === 0) && !r.publisher && !r.publish_date}
                                >
                                  Fill fields
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div style={{ marginTop: 10 }} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>Import metadata from URL</div>
                  <div className="muted">HTML (JSON-LD/OpenGraph)</div>
                </div>
                <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                  <input
                    placeholder="Paste a product/publisher/shop link"
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    onKeyDown={(e) => onEnter(e, previewImportFromUrl)}
                    style={{ width: 520, maxWidth: "100%" }}
                  />
                  <button onClick={previewImportFromUrl} disabled={importState.busy || !importUrl.trim()}>
                    {importState.busy ? "Importing…" : "Preview"}
                  </button>
                  <span className="muted" style={{ marginLeft: 10 }}>
                    {importState.message ? (importState.error ? `${importState.message} (${importState.error})` : importState.message) : ""}
                  </span>
                </div>
                {importPreview ? (
                  <div style={{ marginTop: 10 }} className="card">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ width: 62, flex: "0 0 auto" }}>
                        {importPreview.cover_url ? (
                          <img
                            src={importPreview.cover_url}
                            alt=""
                            width={60}
                            height={90}
                            style={{ display: "block", objectFit: "cover", border: "1px solid var(--border)" }}
                          />
                        ) : (
                          <div style={{ width: 60, height: 90, border: "1px solid var(--border)" }} />
                        )}
                      </div>
                      <div style={{ flex: "1 1 auto" }}>
                        <div>{(importPreview.title ?? "").trim() || "—"}</div>
                        <div className="muted" style={{ marginTop: 4 }}>
                          {(importPreview.authors ?? []).filter(Boolean).join(", ") || "—"}
                        </div>
                        <div className="muted" style={{ marginTop: 4 }}>
                          {[importPreview.publisher ?? "", importPreview.publish_date ?? ""].filter(Boolean).join(" · ") || "—"}
                        </div>
                        <div className="muted" style={{ marginTop: 4 }}>
                          {importPreview.isbn13 || importPreview.isbn10 ? `ISBN: ${importPreview.isbn13 ?? importPreview.isbn10}` : "No ISBN found"}
                          {" "}
                          · sources: {(importPreview.sources ?? []).join(", ") || "—"}
                        </div>
                        <div className="muted" style={{ marginTop: 4 }}>
                          {importMeta.domain ? `${importMeta.domain_kind ?? "generic"} · ${importMeta.domain}` : ""}
                          {importMeta.final_url ? (
                            <>
                              {" "}
                              ·{" "}
                              <a href={importMeta.final_url} target="_blank" rel="noreferrer">
                                open page
                              </a>
                            </>
                          ) : null}
                          {importPreview.cover_url ? (
                            <>
                              {" "}
                              ·{" "}
                              <a href={importPreview.cover_url} target="_blank" rel="noreferrer">
                                open cover
                              </a>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div style={{ flex: "0 0 auto" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                          <button
                            onClick={() => linkEditionByIsbn(importPreview.isbn13 ?? importPreview.isbn10 ?? "")}
                            disabled={linkState.busy || !(importPreview.isbn13 ?? importPreview.isbn10)}
                          >
                            Link ISBN
                          </button>
                          <button
                            onClick={() => {
                              if (importPreview.title) setFormTitle(importPreview.title);
                              setFormAuthors((importPreview.authors ?? []).filter(Boolean).join(", "));
                              if (importPreview.publisher) setFormPublisher(importPreview.publisher);
                              if (importPreview.publish_date) setFormPublishDate(importPreview.publish_date);
                              if (importPreview.description) setFormDescription(importPreview.description);
                              setImportState((s) => ({ ...s, message: "Filled fields (not saved)" }));
                            }}
                            disabled={
                              !importPreview.title &&
                              (!importPreview.authors || importPreview.authors.length === 0) &&
                              !importPreview.publisher &&
                              !importPreview.publish_date &&
                              !importPreview.description
                            }
                          >
                            Fill fields
                          </button>
                        </div>
                      </div>
                    </div>
                    {importPreview.subjects && importPreview.subjects.length > 0 ? (
                      <div className="muted" style={{ marginTop: 10 }}>
                        Subjects found: {importPreview.subjects.slice(0, 12).join(", ")}
                        {importPreview.subjects.length > 12 ? "…" : ""}
                        {" "}
                        (you can add them below)
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Your fields
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <div style={{ minWidth: 110 }} className="muted">
                    Visibility
                  </div>
                  <select value={formVisibility} onChange={(e) => setFormVisibility(e.target.value as any)}>
                    <option value="inherit">inherit</option>
                    <option value="followers_only">followers_only</option>
                    <option value="public">public</option>
                  </select>
                  <div className="muted">Per-book override.</div>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Status
                  </div>
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as any)}>
                    <option value="owned">owned</option>
                    <option value="loaned">loaned</option>
                    <option value="selling">selling</option>
                    <option value="trading">trading</option>
                  </select>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Borrowable
                  </div>
                  <select
                    value={formBorrowable}
                    onChange={(e) => setFormBorrowable(e.target.value as any)}
                    disabled={!book || book.owner_id !== userId}
                  >
                    <option value="inherit">inherit</option>
                    <option value="yes">yes</option>
                    <option value="no">no</option>
                  </select>
                  <div className="muted">
                    Default: {ownerBorrowDefaults ? (ownerBorrowDefaults.borrowable_default ? "yes" : "no") : "…"}
                  </div>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Requests
                  </div>
                  <select
                    value={formBorrowScope}
                    onChange={(e) => setFormBorrowScope(e.target.value as any)}
                    disabled={!book || book.owner_id !== userId}
                  >
                    <option value="inherit">inherit</option>
                    <option value="approved_followers">approved_followers</option>
                    <option value="anyone">anyone</option>
                  </select>
                  <div className="muted">
                    Default: {ownerBorrowDefaults ? ownerBorrowDefaults.borrow_request_scope : "…"}
                  </div>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Catalog
                  </div>
                  {book?.owner_id === userId ? (
                    libraries.length > 1 ? (
                      <select
                        value={formLibraryId ?? ""}
                        onChange={(e) => moveToLibrary(Number(e.target.value))}
                        disabled={libraryMoveState.busy || !formLibraryId}
                      >
                        {libraries.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div>{libraries[0]?.name ?? "Your catalog"}</div>
                    )
                  ) : (
                    <div className="muted">—</div>
                  )}
                  <div className="muted">
                    {libraryMoveState.message ? (libraryMoveState.error ? `${libraryMoveState.message} (${libraryMoveState.error})` : libraryMoveState.message) : ""}
                  </div>
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    {copiesLabel}
                  </div>
                  {book?.owner_id === userId ? (
                    <div className="row" style={{ gap: 8 }}>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={copiesDraft}
                        onChange={(e) => setCopiesDraft(e.target.value)}
                        onKeyDown={(e) => onEnter(e, updateCopies)}
                        style={{ width: 90 }}
                      />
                      <button onClick={updateCopies} disabled={copiesUpdateState.busy || !copiesDraft.trim()}>
                        {copiesUpdateState.busy ? "Updating…" : "Update"}
                      </button>
                      <span className="muted">
                        {copiesCountState.busy ? "…" : copiesCountState.error ? copiesCountState.error : `${copiesCount ?? "—"} current`}
                      </span>
                      <span className="muted">
                        {copiesUpdateState.message ? (copiesUpdateState.error ? `${copiesUpdateState.message} (${copiesUpdateState.error})` : copiesUpdateState.message) : ""}
                      </span>
                    </div>
                  ) : (
                    <div className="muted">{copiesCountState.busy ? "…" : copiesCountState.error ? copiesCountState.error : copiesCount ?? "—"}</div>
                  )}
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Title override
                  </div>
                  <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} onKeyDown={(e) => onEnter(e, saveEdits)} style={{ width: 360 }} />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Authors override
                  </div>
                  <input
                    value={formAuthors}
                    onChange={(e) => setFormAuthors(e.target.value)}
                    onKeyDown={(e) => onEnter(e, saveEdits)}
                    placeholder="Comma-separated"
                    style={{ width: 360 }}
                  />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Publisher
                  </div>
                  <input value={formPublisher} onChange={(e) => setFormPublisher(e.target.value)} onKeyDown={(e) => onEnter(e, saveEdits)} style={{ width: 360 }} />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Publish date
                  </div>
                  <input type="date" value={formPublishDate || ""} onChange={(e) => setFormPublishDate(e.target.value)} onKeyDown={(e) => onEnter(e, saveEdits)} />
                </div>

                <div style={{ marginTop: 8 }}>
                  <div className="muted">Description</div>
                  <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={4} style={{ width: "100%", marginTop: 6 }} />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Location
                  </div>
                  <input
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    onKeyDown={(e) => onEnter(e, saveEdits)}
                    placeholder="Home, Studio…"
                    style={{ width: 360 }}
                  />
                </div>

                <div className="row" style={{ marginTop: 6 }}>
                  <div style={{ minWidth: 110 }} className="muted">
                    Shelf
                  </div>
                  <input value={formShelf} onChange={(e) => setFormShelf(e.target.value)} onKeyDown={(e) => onEnter(e, saveEdits)} placeholder="Shelf #" style={{ width: 360 }} />
                </div>

                <div style={{ marginTop: 8 }}>
                  <div className="muted">Notes</div>
                  <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={4} style={{ width: "100%", marginTop: 6 }} />
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <button onClick={saveEdits} disabled={saveState.busy || !book || book.owner_id !== userId}>
                    {saveState.busy ? "Saving…" : "Save"}
                  </button>
                  <div className="muted">{saveState.message ? (saveState.error ? `${saveState.message} (${saveState.error})` : saveState.message) : ""}</div>
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Subjects
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <input
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    onKeyDown={(e) => onEnter(e, addSubject)}
                    placeholder="Add a subject"
                    style={{ width: 220 }}
                  />
                  <button onClick={addSubject} disabled={subjectState.busy || !newSubject.trim()}>
                    Add
                  </button>
                  <div className="muted">
                    {subjectState.message ? (subjectState.error ? `${subjectState.message} (${subjectState.error})` : subjectState.message) : ""}
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  {effectiveSubjects.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {effectiveSubjects
                        .slice()
                        .sort((a, b) => a.localeCompare(b))
                        .map((s) => (
                          <span
                            key={s}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              border: "1px solid var(--border)",
                              padding: "2px 6px"
                            }}
                          >
                            <Link href={`/app?subject=${encodeURIComponent(s)}`} style={{ textDecoration: "none" }}>
                              {s}
                            </Link>
                            <button onClick={() => removeSubject(s)} disabled={subjectState.busy} aria-label={`Remove subject ${s}`}>
                              ×
                            </button>
                          </span>
                        ))}
                    </div>
                  ) : (
                    <div className="muted">No subjects yet.</div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Categories
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <input
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    onKeyDown={(e) => onEnter(e, addCategory)}
                    placeholder="Add a category"
                    style={{ width: 220 }}
                  />
                  <button onClick={addCategory} disabled={categoryState.busy || !newCategory.trim()}>
                    Add
                  </button>
                  <div className="muted">{categoryState.message ? (categoryState.error ? `${categoryState.message} (${categoryState.error})` : categoryState.message) : ""}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  {categories.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {categories.map((t) => (
                        <span
                          key={t.id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            border: "1px solid var(--border)",
                            padding: "2px 6px"
                          }}
                        >
                          <Link href={`/app?category=${encodeURIComponent(t.name)}`} style={{ textDecoration: "none" }}>
                            {t.name}
                          </Link>
                          <button onClick={() => removeCategory(t.id)} disabled={categoryState.busy} aria-label={`Remove category ${t.name}`}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="muted">No categories yet.</div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Tags
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => onEnter(e, addTag)}
                    placeholder="Add a tag"
                    style={{ width: 220 }}
                  />
                  <button onClick={addTag} disabled={tagState.busy || !newTag.trim()}>
                    Add
                  </button>
                  <div className="muted">{tagState.message ? (tagState.error ? `${tagState.message} (${tagState.error})` : tagState.message) : ""}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  {tags.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {tags.map((t) => (
                        <span
                          key={t.id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            border: "1px solid var(--border)",
                            padding: "2px 6px"
                          }}
                        >
                          <Link href={`/app?tag=${encodeURIComponent(t.name)}`} style={{ textDecoration: "none" }}>
                            {t.name}
                          </Link>
                          <button onClick={() => removeTag(t.id)} disabled={tagState.busy} aria-label={`Remove tag ${t.name}`}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="muted">No tags yet.</div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16 }} className="muted">
                Images
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="muted">Upload additional images</div>
                <input key={imagesInputKey} type="file" accept="image/*" multiple onChange={(ev) => selectPendingImages(ev.target.files)} style={{ marginTop: 6 }} />

                {pendingImages.length > 0 ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    <div>Selected (not uploaded yet):</div>
                    <div style={{ marginTop: 6 }}>
                      {pendingImages.map((f) => (
                        <div key={`${f.name}:${f.size}:${f.lastModified}`}>{f.name}</div>
                      ))}
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button onClick={uploadImages} disabled={imagesState.busy}>
                        {imagesState.busy ? "Uploading…" : "Submit"}
                      </button>
                      <button onClick={clearPendingImages} disabled={imagesState.busy} style={{ marginLeft: 8 }}>
                        Clear
                      </button>
                      <div className="muted" style={{ marginLeft: 10 }}>
                        {imagesState.message ? (imagesState.error ? `${imagesState.message} (${imagesState.error})` : imagesState.message) : ""}
                      </div>
                    </div>
                  </div>
                ) : imagesState.message ? (
                  <div className="muted" style={{ marginTop: 6 }}>
                    {imagesState.error ? `${imagesState.message} (${imagesState.error})` : imagesState.message}
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: 6 }}>
                    Select one or more images, then click Submit.
                  </div>
                )}

                {imageMedia.length > 0 ? (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                    {imageMedia.map((m) => {
                      const url = mediaUrlsByPath[m.storage_path];
                      return (
                        <div key={m.id} className="card">
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt="" src={url} style={{ width: "100%", height: 120, objectFit: "cover", border: "1px solid var(--border)" }} />
                          ) : (
                            <div style={{ width: "100%", height: 120, border: "1px solid var(--border)" }} />
                          )}
                          <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                            <button onClick={() => setAsCover(m.id)} disabled={coverState.busy}>
                              Use as cover
                            </button>
                            <button onClick={() => deleteMedia(m.id, m.storage_path)} disabled={imagesState.busy || coverState.busy}>
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: 8 }}>
                    No images yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            {editionId ? <AlsoOwnedBy editionId={editionId} excludeUserBookId={bookId} excludeOwnerId={userId} /> : null}
          </div>
        </div>
      )}
    </main>
  );
}
