import { NextResponse } from "next/server";
import { requireAdminClient, requireUser, toApiError } from "../../../catalog/_lib";
import { MUSIC_CONTRIBUTOR_ROLES, parseMusicMetadata, type MusicMetadata } from "../../../../../lib/music";

type BookLike = {
  id: number;
  owner_id: string;
  library_id: number | null;
  visibility: "inherit" | "followers_only" | "public";
  object_type: string | null;
  title_override: string | null;
  authors_override: string[] | null;
  designers_override: string[] | null;
  music_metadata?: MusicMetadata | null;
  cover_original_url: string | null;
  cover_crop: unknown;
  edition: {
    id?: number | null;
    title: string | null;
    authors: string[] | null;
    cover_url: string | null;
  } | null;
  media: Array<{ kind: "cover" | "image"; storage_path: string }>;
  book_entities?: Array<{ role: string; entity: { id?: string | null; name?: string | null; slug?: string | null } | null }> | null;
};

type Candidate = {
  role: string;
  name: string;
  heading: string;
  mediaScope: "book" | "music" | "all";
};

function normalizeName(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueNames(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = String(value ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function isRemoteUrl(input: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(input ?? "").trim());
}

function coverStoragePath(row: BookLike): string | null {
  const coverMedia = (row.media ?? []).find((entry) => entry.kind === "cover")?.storage_path ?? null;
  if (coverMedia) return coverMedia;
  const firstMedia = (row.media ?? [])[0]?.storage_path ?? null;
  if (firstMedia) return firstMedia;
  const original = String(row.cover_original_url ?? "").trim();
  return original && !isRemoteUrl(original) ? original : null;
}

function matchesMediaScope(row: BookLike, mediaScope: Candidate["mediaScope"]): boolean {
  const objectType = String(row.object_type ?? "").trim().toLowerCase();
  if (mediaScope === "book") return objectType !== "music";
  if (mediaScope === "music") return objectType === "music";
  return true;
}

function rowMatchesCandidate(row: BookLike, candidate: Candidate): boolean {
  if (!matchesMediaScope(row, candidate.mediaScope)) return false;
  const target = normalizeName(candidate.name);
  if (!target) return false;

  if (candidate.role === "author") {
    return uniqueNames([...(row.authors_override ?? []), ...((row.edition?.authors ?? []) as string[])]).some((name) => normalizeName(name) === target);
  }

  if (candidate.role === "designer") {
    const entityNames = (row.book_entities ?? [])
      .filter((entry) => {
        const role = String(entry?.role ?? "").trim().toLowerCase();
        return role === "designer" || role === "design";
      })
      .map((entry) => entry.entity?.name ?? null);
    return uniqueNames([...(row.designers_override ?? []), ...entityNames]).some((name) => normalizeName(name) === target);
  }

  const music = parseMusicMetadata(row.music_metadata);
  if (candidate.role === "performer" && normalizeName(music?.primary_artist) === target) return true;
  return (row.book_entities ?? []).some((entry) => {
    const role = String(entry?.role ?? "").trim().toLowerCase();
    return role === candidate.role && normalizeName(entry?.entity?.name) === target;
  });
}

function deriveCandidates(book: BookLike): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: Candidate) => {
    const key = `${candidate.role}:${candidate.name.toLowerCase()}`;
    if (!candidate.name.trim() || seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const authorEntityNames = (book.book_entities ?? [])
    .filter((entry) => String(entry?.role ?? "").trim().toLowerCase() === "author")
    .map((entry) => String(entry?.entity?.name ?? "").trim())
    .filter(Boolean);
  const authorNames = authorEntityNames.length > 0 ? authorEntityNames : uniqueNames([...(book.authors_override ?? []), ...((book.edition?.authors ?? []) as string[])]);
  for (const name of authorNames) {
    push({ role: "author", name, heading: `Other books by ${name}`, mediaScope: "book" });
  }

  const music = parseMusicMetadata(book.music_metadata);
  const primaryArtist = String(music?.primary_artist ?? "").trim();
  if (primaryArtist) {
    push({ role: "performer", name: primaryArtist, heading: `Other records by ${primaryArtist}`, mediaScope: "music" });
  }
  for (const role of MUSIC_CONTRIBUTOR_ROLES.filter((role) => !["designer", "art direction", "artwork", "photography"].includes(role))) {
    const names = (book.book_entities ?? [])
      .filter((entry) => String(entry?.role ?? "").trim().toLowerCase() === role)
      .map((entry) => String(entry?.entity?.name ?? "").trim())
      .filter(Boolean);
    for (const name of names) {
      push({ role, name, heading: `Other records by ${name}`, mediaScope: "music" });
    }
  }

  const designerEntityNames = (book.book_entities ?? [])
    .filter((entry) => {
      const role = String(entry?.role ?? "").trim().toLowerCase();
      return role === "designer" || role === "design";
    })
    .map((entry) => String(entry?.entity?.name ?? "").trim())
    .filter(Boolean);
  const designerNames = designerEntityNames.length > 0 ? designerEntityNames : uniqueNames(book.designers_override ?? []);
  for (const name of designerNames) {
    push({ role: "designer", name, heading: `Other items designed by ${name}`, mediaScope: "all" });
  }

  return candidates;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const current = await requireUser(req);
    const admin = requireAdminClient();
    const { id } = await ctx.params;
    const bookId = Number(id);
    if (!Number.isFinite(bookId) || bookId <= 0) {
      return NextResponse.json({ ok: true, heading: null, rows: [] });
    }

    const [ownedRes, membershipsRes] = await Promise.all([
      admin.from("libraries").select("id").eq("owner_id", current.id),
      admin.from("catalog_members").select("catalog_id,accepted_at").eq("user_id", current.id).not("accepted_at", "is", null)
    ]);

    const allowedCatalogIds = Array.from(
      new Set([
        ...((ownedRes.data ?? []) as Array<{ id?: number | null }>).map((row) => Number(row?.id)).filter((n) => Number.isFinite(n) && n > 0),
        ...((membershipsRes.data ?? []) as Array<{ catalog_id?: number | null }>).map((row) => Number(row?.catalog_id)).filter((n) => Number.isFinite(n) && n > 0)
      ])
    );
    if (allowedCatalogIds.length === 0) {
      return NextResponse.json({ ok: true, heading: null, rows: [] });
    }

    const currentRes = await admin
      .from("user_books")
      .select("id,owner_id,library_id,visibility,object_type,title_override,authors_override,designers_override,music_metadata,cover_original_url,cover_crop,edition:editions(id,title,authors,cover_url),media:user_book_media(kind,storage_path),book_entities:book_entities(role,entity:entities(id,name,slug))")
      .eq("id", bookId)
      .maybeSingle();
    if (currentRes.error) throw new Error(currentRes.error.message);
    const currentBook = (currentRes.data ?? null) as BookLike | null;
    if (!currentBook || !allowedCatalogIds.includes(Number(currentBook.library_id))) {
      return NextResponse.json({ ok: true, heading: null, rows: [] });
    }

    const candidates = deriveCandidates(currentBook);
    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, heading: null, rows: [] });
    }

    const booksRes = await admin
      .from("user_books")
      .select("id,owner_id,library_id,visibility,object_type,title_override,authors_override,designers_override,music_metadata,cover_original_url,cover_crop,edition:editions(id,title,authors,cover_url),media:user_book_media(kind,storage_path),book_entities:book_entities(role,entity:entities(id,name,slug))")
      .in("library_id", allowedCatalogIds)
      .neq("id", bookId)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (booksRes.error) throw new Error(booksRes.error.message);
    const allBooks = (booksRes.data ?? []) as unknown as BookLike[];

    let heading: string | null = null;
    let matchedRows: BookLike[] = [];
    for (const candidate of candidates) {
      const matches = allBooks.filter((row) => rowMatchesCandidate(row, candidate));
      if (matches.length < 1) continue;
      heading = candidate.heading;
      matchedRows = matches;
      break;
    }

    if (!heading || matchedRows.length < 1) {
      return NextResponse.json({ ok: true, heading: null, rows: [] });
    }

    const mediaPaths = Array.from(
      new Set(
        matchedRows
          .map((row) => coverStoragePath(row))
          .filter((value): value is string => Boolean(value))
      )
    );
    const signedMap: Record<string, string> = {};
    if (mediaPaths.length > 0) {
      const signed = await admin.storage.from("user-book-media").createSignedUrls(mediaPaths, 60 * 30);
      for (const row of signed.data ?? []) {
        if (row.path && row.signedUrl) signedMap[row.path] = row.signedUrl;
      }
    }

    const rows = matchedRows.map((row) => ({
      ...row,
      resolved_cover_url: (() => {
        const original = String(row.cover_original_url ?? "").trim();
        if (original && /^https?:\/\//i.test(original)) return original;
        const path = coverStoragePath(row);
        if (path && signedMap[path]) return signedMap[path];
        return String(row.edition?.cover_url ?? "").trim() || null;
      })()
    }));

    return NextResponse.json({ ok: true, heading, rows });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
