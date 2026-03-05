import { NextResponse } from "next/server";
import { requireAdminClient, requireUser, toApiError } from "../../../catalog/_lib";

export async function GET(req: Request, ctx: { params: Promise<{ username: string }> }) {
  try {
    const current = await requireUser(req);
    const admin = requireAdminClient();
    const { username } = await ctx.params;
    const usernameNorm = String(username ?? "").trim().toLowerCase();
    if (!usernameNorm) return NextResponse.json({ ok: true, books: [], libraries: [], signed_map: {} });

    const targetRes = await admin
      .from("profiles")
      .select("id,username")
      .eq("username", usernameNorm)
      .maybeSingle();
    if (targetRes.error) throw new Error(targetRes.error.message);
    const targetId = String((targetRes.data as any)?.id ?? "");
    if (!targetId) return NextResponse.json({ ok: true, books: [], libraries: [], signed_map: {} });

    const currentMembershipsRes = await admin
      .from("catalog_members")
      .select("catalog_id")
      .eq("user_id", current.id)
      .not("accepted_at", "is", null);
    if (currentMembershipsRes.error) throw new Error(currentMembershipsRes.error.message);
    const currentCatalogIds = Array.from(
      new Set(((currentMembershipsRes.data ?? []) as any[]).map((r) => Number(r.catalog_id)).filter((n) => Number.isFinite(n) && n > 0))
    );
    if (currentCatalogIds.length === 0) return NextResponse.json({ ok: true, books: [], libraries: [], signed_map: {} });

    const targetMembershipsRes = await admin
      .from("catalog_members")
      .select("catalog_id")
      .eq("user_id", targetId)
      .in("catalog_id", currentCatalogIds)
      .not("accepted_at", "is", null);
    if (targetMembershipsRes.error) throw new Error(targetMembershipsRes.error.message);

    const sharedCatalogIds = Array.from(
      new Set(((targetMembershipsRes.data ?? []) as any[]).map((r) => Number(r.catalog_id)).filter((n) => Number.isFinite(n) && n > 0))
    );
    if (sharedCatalogIds.length === 0) return NextResponse.json({ ok: true, books: [], libraries: [], signed_map: {} });

    const librariesRes = await admin.from("libraries").select("id,name").in("id", sharedCatalogIds);
    const libraries = ((librariesRes.error ? [] : librariesRes.data) ?? [])
      .map((l: any) => ({ id: Number(l.id), name: String(l.name ?? `Catalog ${l.id}`) }))
      .filter((l: any) => Number.isFinite(l.id) && l.id > 0);

    const booksRes = await admin
      .from("user_books")
      .select("*,edition:editions(id,isbn13,title,authors,cover_url,subjects,publisher,publish_date,description),media:user_book_media(kind,storage_path),book_tags:user_book_tags(tag:tags(id,name,kind))")
      .in("library_id", sharedCatalogIds)
      .order("created_at", { ascending: false })
      .limit(1200);
    if (booksRes.error) throw new Error(booksRes.error.message);
    const books = ((booksRes.data ?? []) as any[]).map((b) => ({
      ...b,
      media: Array.isArray(b?.media) ? b.media : [],
      book_tags: Array.isArray(b?.book_tags) ? b.book_tags : [],
      edition: b?.edition ?? null
    }));

    const mediaPaths = Array.from(
      new Set(
        books
          .flatMap((b) => (Array.isArray(b.media) ? b.media : []))
          .map((m: any) => (typeof m?.storage_path === "string" ? m.storage_path : ""))
          .filter(Boolean)
      )
    );
    const signedMap: Record<string, string> = {};
    if (mediaPaths.length > 0) {
      const signed = await admin.storage.from("user-book-media").createSignedUrls(mediaPaths, 60 * 60);
      if (!signed.error && Array.isArray(signed.data)) {
        for (const row of signed.data) {
          if (row.path && row.signedUrl) signedMap[row.path] = row.signedUrl;
        }
      }
    }

    return NextResponse.json({ ok: true, books, libraries, signed_map: signedMap });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
