import { NextResponse } from "next/server";
import { requireAdminClient, requireUser, toApiError } from "../_lib";

function parseCatalogIds(raw: string): number[] {
  return Array.from(
    new Set(
      String(raw ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );
}

export async function GET(req: Request) {
  try {
    const current = await requireUser(req);
    const admin = requireAdminClient();
    const url = new URL(req.url);
    const idsRaw = String(url.searchParams.get("catalog_ids") ?? "").trim();
    const requestedIds = parseCatalogIds(idsRaw);

    const ownedRes = await admin.from("libraries").select("id").eq("owner_id", current.id);
    const ownedIds = Array.from(
      new Set(((ownedRes.error ? [] : ownedRes.data) ?? []).map((l: any) => Number(l.id)).filter((id) => Number.isFinite(id) && id > 0))
    );

    let membershipRows: Array<{ catalog_id: number; role: "owner" | "editor" }> = [];
    if (requestedIds.length === 0) {
      const membershipsRes = await admin
        .from("catalog_members")
        .select("catalog_id,role,accepted_at")
        .eq("user_id", current.id)
        .not("accepted_at", "is", null);

      membershipRows = (((membershipsRes.error ? [] : membershipsRes.data) ?? []) as any[])
        .map((r) => ({
          catalog_id: Number(r.catalog_id),
          role: (String(r.role ?? "").toLowerCase() === "owner" ? "owner" : "editor") as "owner" | "editor"
        }))
        .filter((r) => Number.isFinite(r.catalog_id) && r.catalog_id > 0);
    }

    const membershipIds = Array.from(new Set(membershipRows.map((r) => r.catalog_id)));
    const allowedIds = requestedIds.length > 0 ? requestedIds : Array.from(new Set([...ownedIds, ...membershipIds]));

    const roleByCatalog = new Map<number, "owner" | "editor">();
    for (const r of membershipRows) roleByCatalog.set(r.catalog_id, r.role);
    for (const id of ownedIds) {
      if (!roleByCatalog.has(id)) roleByCatalog.set(id, "owner");
    }

    let catalogs: any[] = [];
    if (allowedIds.length > 0) {
      const libsRes = await admin
        .from("libraries")
        .select("id,name,created_at,sort_order,owner_id")
        .in("id", allowedIds);

      if (!libsRes.error) {
        catalogs = ((libsRes.data ?? []) as any[]).map((l) => {
          const id = Number(l.id);
          return {
            id,
            name: String(l.name ?? `Catalog ${id}`),
            created_at: String(l.created_at ?? new Date(0).toISOString()),
            sort_order: Number.isFinite(Number(l.sort_order)) ? Number(l.sort_order) : null,
            owner_id: l.owner_id ? String(l.owner_id) : null,
            myRole: roleByCatalog.get(id) ?? (ownedIds.includes(id) ? "owner" : "editor")
          };
        });
      } else {
        catalogs = allowedIds.map((id) => ({
          id,
          name: `Catalog ${id}`,
          created_at: new Date(0).toISOString(),
          sort_order: null,
          owner_id: null,
          myRole: roleByCatalog.get(id) ?? (ownedIds.includes(id) ? "owner" : "editor")
        }));
      }
    }

    let books: any[] = [];
    if (allowedIds.length > 0) {
      const fullSelect =
        "id,library_id,created_at,visibility,title_override,authors_override,subjects_override,publisher_override,designers_override,group_label,decade,cover_original_url,cover_crop,edition:editions(id,isbn13,title,authors,subjects,publisher,cover_url,publish_date),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))";
      const basicSelect =
        "id,library_id,created_at,visibility,title_override,authors_override,subjects_override,publisher_override,designers_override,group_label,decade,edition:editions(id,isbn13,title,authors,subjects,publisher,cover_url,publish_date),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind))";
      const minimalSelect =
        "id,library_id,created_at,visibility,title_override,authors_override,subjects_override,publisher_override,designers_override,group_label,decade";

      const fullRes = await admin
        .from("user_books")
        .select(fullSelect)
        .in("library_id", allowedIds)
        .order("created_at", { ascending: false })
        .limit(800);

      if (!fullRes.error) {
        books = (fullRes.data ?? []) as any[];
      } else {
        const basicRes = await admin
          .from("user_books")
          .select(basicSelect)
          .in("library_id", allowedIds)
          .order("created_at", { ascending: false })
          .limit(800);

        if (!basicRes.error) {
          books = (basicRes.data ?? []) as any[];
        } else {
          const minimalRes = await admin
            .from("user_books")
            .select(minimalSelect)
            .in("library_id", allowedIds)
            .order("created_at", { ascending: false })
            .limit(800);
          books = (minimalRes.error ? [] : minimalRes.data) as any[];
        }
      }
    }

    return NextResponse.json({ ok: true, catalogs, books });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
