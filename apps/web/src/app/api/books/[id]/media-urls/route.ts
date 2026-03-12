import { NextResponse } from "next/server";
import { requireAdminClient, requireUser, toApiError } from "../../../catalog/_lib";

function isRemoteUrl(input: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(input ?? "").trim());
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const current = await requireUser(req);
    const admin = requireAdminClient();
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

    const origStoragePath =
      typeof book.cover_original_url === "string" && book.cover_original_url && !isRemoteUrl(book.cover_original_url)
        ? book.cover_original_url
        : null;

    const paths = Array.from(
      new Set([
        ...(book.media ?? []).map((m) => m.storage_path).filter(Boolean),
        ...(origStoragePath ? [origStoragePath] : []),
      ])
    );

    const signedMap: Record<string, string> = {};
    if (paths.length > 0) {
      const signed = await admin.storage.from("user-book-media").createSignedUrls(paths, 60 * 60);
      for (const s of signed.data ?? []) {
        if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
      }
    }

    return NextResponse.json({ ok: true, paths: signedMap });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
