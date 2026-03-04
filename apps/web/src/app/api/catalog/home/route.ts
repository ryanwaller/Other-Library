import { NextResponse } from "next/server";
import { requireAdminClient, requireUser, toApiError } from "../_lib";

export async function GET(req: Request) {
  try {
    const current = await requireUser(req);
    const admin = requireAdminClient();
    const url = new URL(req.url);
    const idsRaw = String(url.searchParams.get("catalog_ids") ?? "").trim();

    const ownedRes = await admin.from("libraries").select("id").eq("owner_id", current.id);
    if (ownedRes.error) throw new Error(ownedRes.error.message);
    const ownedIds = Array.from(
      new Set(((ownedRes.data ?? []) as any[]).map((l) => Number(l.id)).filter((id) => Number.isFinite(id) && id > 0))
    );

    const membershipsRes = await admin
      .from("catalog_members")
      .select("catalog_id,role,accepted_at")
      .eq("user_id", current.id)
      .not("accepted_at", "is", null);
    if (membershipsRes.error) throw new Error(membershipsRes.error.message);

    const membershipRows = ((membershipsRes.data ?? []) as any[]).map((r) => ({
      catalog_id: Number(r.catalog_id),
      role: (String(r.role ?? "").toLowerCase() === "owner" ? "owner" : "editor") as "owner" | "editor"
    }));
    const membershipIds = Array.from(
      new Set(membershipRows.map((r) => r.catalog_id).filter((id) => Number.isFinite(id) && id > 0))
    );

    let catalogIds = Array.from(new Set([...ownedIds, ...membershipIds]));
    if (idsRaw) {
      const requested = Array.from(
        new Set(
          idsRaw
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0)
        )
      );
      if (requested.length > 0) {
        const allowed = new Set(catalogIds);
        catalogIds = requested.filter((id) => allowed.has(id));
      }
    }

    const roleByCatalog = new Map<number, "owner" | "editor">();
    for (const r of membershipRows) roleByCatalog.set(r.catalog_id, r.role);

    let catalogs: any[] = [];
    if (catalogIds.length > 0) {
      const libsRes = await admin
        .from("libraries")
        .select("id,name,created_at,sort_order,owner_id")
        .in("id", catalogIds);
      if (libsRes.error) throw new Error(libsRes.error.message);
      catalogs = ((libsRes.data ?? []) as any[]).map((l) => {
        const id = Number(l.id);
        return {
          id,
          name: String(l.name ?? `Catalog ${id}`),
          created_at: String(l.created_at ?? new Date(0).toISOString()),
          sort_order: Number.isFinite(Number(l.sort_order)) ? Number(l.sort_order) : null,
          owner_id: l.owner_id ? String(l.owner_id) : null,
          myRole: roleByCatalog.get(id) ?? "editor"
        };
      });
    }

    let books: any[] = [];
    if (catalogIds.length > 0) {
      const fullSelect =
        "id,library_id,created_at,visibility,title_override,authors_override,subjects_override,publisher_override,designers_override,group_label,decade,cover_original_url,cover_crop,edition:editions(id,isbn13,title,authors,subjects,publisher,cover_url,publish_date),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))";
      const basicSelect =
        "id,library_id,created_at,visibility,title_override,authors_override,subjects_override,publisher_override,designers_override,group_label,decade,edition:editions(id,isbn13,title,authors,subjects,publisher,cover_url,publish_date),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))";

      const booksRes = await admin.from("user_books").select(fullSelect).in("library_id", catalogIds).order("created_at", { ascending: false }).limit(800);
      if (!booksRes.error) {
        books = (booksRes.data ?? []) as any[];
      } else {
        const fallback = await admin.from("user_books").select(basicSelect).in("library_id", catalogIds).order("created_at", { ascending: false }).limit(800);
        if (!fallback.error) books = (fallback.data ?? []) as any[];
      }
    }

    return NextResponse.json({ ok: true, catalogs, books });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
