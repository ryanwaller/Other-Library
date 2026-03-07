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

    const librariesRes = await admin.from("libraries").select("id,name,sort_order").in("id", sharedCatalogIds);
    const libraries = ((librariesRes.error ? [] : librariesRes.data) ?? [])
      .map((l: any) => ({
        id: Number(l.id),
        name: String(l.name ?? `Catalog ${l.id}`),
        sort_order: Number.isFinite(Number(l.sort_order)) ? Number(l.sort_order) : null,
        member_previews: [] as Array<{ user_id: string; username: string; avatar_url: string | null }>
      }))
      .filter((l: any) => Number.isFinite(l.id) && l.id > 0);

    const membersRes = await admin
      .from("catalog_members")
      .select("catalog_id,user_id,accepted_at")
      .in("catalog_id", sharedCatalogIds)
      .not("accepted_at", "is", null);
    const memberRows = ((membersRes.error ? [] : membersRes.data) ?? [])
      .map((r: any) => ({
        catalog_id: Number(r.catalog_id),
        user_id: String(r.user_id),
        accepted_at: String(r.accepted_at ?? "")
      }))
      .filter((r: any) => Number.isFinite(r.catalog_id) && r.catalog_id > 0 && r.user_id && r.user_id !== targetId);

    const memberIds = Array.from(new Set(memberRows.map((r: any) => r.user_id)));
    let profilesById: Record<string, { username: string; avatar_path: string | null }> = {};
    if (memberIds.length > 0) {
      const pr = await admin.from("profiles").select("id,username,avatar_path").in("id", memberIds);
      if (!pr.error) {
        profilesById = Object.fromEntries(
          ((pr.data ?? []) as any[])
            .filter((p) => p?.id && p?.username)
            .map((p) => [String(p.id), { username: String(p.username), avatar_path: p.avatar_path ? String(p.avatar_path) : null }])
        );
      }
    }

    const avatarByPath: Record<string, string> = {};
    const avatarPaths = Array.from(
      new Set(
        Object.values(profilesById)
          .map((p) => (p.avatar_path ?? "").trim())
          .filter(Boolean)
      )
    );
    const directUrls = avatarPaths.filter((p) => /^https?:\/\//i.test(p));
    for (const p of directUrls) avatarByPath[p] = p;
    const storagePaths = avatarPaths.filter((p) => !/^https?:\/\//i.test(p));
    if (storagePaths.length > 0) {
      const signed = await admin.storage.from("avatars").createSignedUrls(storagePaths, 60 * 30);
      if (!signed.error && Array.isArray(signed.data)) {
        for (const row of signed.data) {
          if (row.path && row.signedUrl) avatarByPath[row.path] = row.signedUrl;
        }
      }
      for (const path of storagePaths) {
        if (avatarByPath[path]) continue;
        const pub = admin.storage.from("avatars").getPublicUrl(path);
        const fallback = String(pub.data?.publicUrl ?? "").trim();
        if (fallback) avatarByPath[path] = fallback;
      }
    }

    const previewsByCatalog: Record<number, Array<{ user_id: string; username: string; avatar_url: string | null; accepted_at: string }>> = {};
    for (const row of memberRows) {
      const profile = profilesById[row.user_id];
      if (!profile?.username) continue;
      if (!previewsByCatalog[row.catalog_id]) previewsByCatalog[row.catalog_id] = [];
      previewsByCatalog[row.catalog_id].push({
        user_id: row.user_id,
        username: profile.username,
        avatar_url: profile.avatar_path ? avatarByPath[profile.avatar_path] ?? null : null,
        accepted_at: row.accepted_at
      });
    }
    for (const lib of libraries) {
      lib.member_previews = (previewsByCatalog[lib.id] ?? [])
        .sort((a, b) => Date.parse(a.accepted_at) - Date.parse(b.accepted_at))
        .slice(0, 10)
        .map((m) => ({ user_id: m.user_id, username: m.username, avatar_url: m.avatar_url }));
    }

    const booksRes = await admin
      .from("user_books")
      .select("*,edition:editions(id,isbn13,title,authors,cover_url,subjects,publisher,publish_date,description),media:user_book_media(kind,storage_path),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,entity:entities(id,name,slug))")
      .in("library_id", sharedCatalogIds)
      .order("created_at", { ascending: false })
      .limit(1200);
    if (booksRes.error) throw new Error(booksRes.error.message);
    const books = ((booksRes.data ?? []) as any[]).map((b) => ({
      ...b,
      media: Array.isArray(b?.media) ? b.media : [],
      book_tags: Array.isArray(b?.book_tags) ? b.book_tags : [],
      book_entities: Array.isArray(b?.book_entities) ? b.book_entities : [],
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
