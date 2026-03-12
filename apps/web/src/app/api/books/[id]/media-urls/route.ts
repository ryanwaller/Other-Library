import { NextResponse } from "next/server";
import { requireAdminClient, requireUser, toApiError } from "../../../catalog/_lib";

function isRemoteUrl(input: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(input ?? "").trim());
}

function isStoragePath(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return !/^https?:\/\//i.test(v) && !/^data:/i.test(v);
}

function normalizeStoragePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutLeadingSlash = trimmed.replace(/^\/+/, "");
  return isStoragePath(withoutLeadingSlash) ? withoutLeadingSlash : null;
}

function withoutStoragePathPrefix(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const marker = "user-book-media/";
  if (trimmed.startsWith("public/") && trimmed.includes(marker)) {
    const idx = trimmed.indexOf(marker);
    return normalizeStoragePath(trimmed.slice(idx + marker.length));
  }
  if (trimmed.includes(`/${marker}`)) {
    const idx = trimmed.indexOf(`/${marker}`);
    return normalizeStoragePath(trimmed.slice(idx + `/${marker}`.length));
  }
  if (trimmed.includes(marker)) {
    const idx = trimmed.indexOf(marker);
    return normalizeStoragePath(trimmed.slice(idx + marker.length));
  }
  try {
    const url = new URL(trimmed);
    const { pathname } = url;
    if (pathname.includes(marker)) {
      const idx = pathname.indexOf(marker);
      return normalizeStoragePath(pathname.slice(idx + marker.length));
    }
  } catch {
    // ignore URL parse failures
  }
  return null;
}

function toStoragePathCandidate(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const normalizedInput = trimmed.startsWith("/") ? trimmed.replace(/^\/+/, "") : trimmed;
  const bucketPath = withoutStoragePathPrefix(normalizedInput);
  if (bucketPath) return bucketPath;
  if (isStoragePath(normalizedInput)) return normalizeStoragePath(normalizedInput);
  return null;
}

function toResolvedExternalUrl(value: string, origin: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^http:\/\//i.test(trimmed)) {
    return `${origin}/api/image-proxy?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const current = await requireUser(req);
    const admin = requireAdminClient();
    const origin = new URL(req.url).origin;
    const { id } = await ctx.params;
    const bookId = Number(id);
    if (!Number.isFinite(bookId) || bookId <= 0) {
      return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    }

    // Fetch book — only owner can request signed URLs via this route
    const bookRes = await admin
      .from("user_books")
      .select("id,owner_id,cover_original_url,media:user_book_media(kind,storage_path)")
      .eq("id", bookId)
      .maybeSingle();
    if (bookRes.error) throw new Error(bookRes.error.message);
    const book = bookRes.data as {
      id: number;
      owner_id: string;
      cover_original_url: string | null;
      media: Array<{ kind: string; storage_path: string }>;
    } | null;

    if (!book) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (String(book.owner_id) !== String(current.id)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const rawRefs = Array.from(
      new Set([
        ...(book.media ?? []).map((m) => String(m.storage_path ?? "").trim()).filter(Boolean),
        ...(typeof book.cover_original_url === "string" && book.cover_original_url.trim() ? [book.cover_original_url.trim()] : []),
      ])
    );

    const rawToStorage = new Map<string, string>();
    const storagePaths = Array.from(
      new Set(
        rawRefs
          .map((raw) => {
            const storagePath = toStoragePathCandidate(raw);
            if (storagePath) rawToStorage.set(raw, storagePath);
            return storagePath;
          })
          .filter(Boolean) as string[]
      )
    );

    const signedMap: Record<string, string> = {};
    if (storagePaths.length > 0) {
      const signed = await admin.storage.from("user-book-media").createSignedUrls(storagePaths, 60 * 60);
      for (const s of signed.data ?? []) {
        if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
      }
      console.log(`[mu] ${Object.keys(signedMap).length}/${storagePaths.length} book=${bookId} err=${signed.error?.message ?? "none"}`);
    }

    const resolvedMap: Record<string, string> = {};
    for (const raw of rawRefs) {
      const storagePath = rawToStorage.get(raw);
      if (storagePath && signedMap[storagePath]) {
        resolvedMap[raw] = signedMap[storagePath];
        resolvedMap[storagePath] = signedMap[storagePath];
        continue;
      }
      if (isRemoteUrl(raw)) {
        resolvedMap[raw] = toResolvedExternalUrl(raw, origin);
      }
    }
    return NextResponse.json({ ok: true, paths: resolvedMap });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
