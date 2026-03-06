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
    const lite = String(url.searchParams.get("lite") ?? "") === "1";
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
            myRole: roleByCatalog.get(id) ?? (ownedIds.includes(id) ? "owner" : "editor"),
            memberPreviews: [] as Array<{ userId: string; username: string; avatarUrl: string | null }>
          };
        });
      } else {
        catalogs = allowedIds.map((id) => ({
          id,
          name: `Catalog ${id}`,
          created_at: new Date(0).toISOString(),
          sort_order: null,
          owner_id: null,
          myRole: roleByCatalog.get(id) ?? (ownedIds.includes(id) ? "owner" : "editor"),
          memberPreviews: [] as Array<{ userId: string; username: string; avatarUrl: string | null }>
        }));
      }
    }

    catalogs = catalogs
      .slice()
      .sort((a, b) => {
        const aOrder = a.sort_order != null ? Number(a.sort_order) : null;
        const bOrder = b.sort_order != null ? Number(b.sort_order) : null;
        if (aOrder !== null && bOrder !== null) return aOrder - bOrder;
        if (aOrder !== null) return -1;
        if (bOrder !== null) return 1;
        const aTs = Date.parse(String(a.created_at ?? ""));
        const bTs = Date.parse(String(b.created_at ?? ""));
        if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return aTs - bTs;
        return Number(a.id) - Number(b.id);
      });

    if (allowedIds.length > 0) {
      const membersRes = await admin
        .from("catalog_members")
        .select("catalog_id,user_id,accepted_at")
        .in("catalog_id", allowedIds)
        .not("accepted_at", "is", null);
      const memberRows = (membersRes.error ? [] : ((membersRes.data ?? []) as any[])).filter((r) => String(r.user_id) !== current.id);
      const memberIds = Array.from(new Set(memberRows.map((r) => String(r.user_id)).filter(Boolean)));
      let profileById: Record<string, { username: string; avatar_path: string | null }> = {};
      if (memberIds.length > 0) {
        const pr = await admin.from("profiles").select("id,username,avatar_path").in("id", memberIds);
        if (!pr.error) {
          profileById = Object.fromEntries(
            ((pr.data ?? []) as any[]).map((p) => [String(p.id), { username: String(p.username ?? ""), avatar_path: p.avatar_path ? String(p.avatar_path) : null }])
          );
        }
      }

      const byCatalog: Record<number, Array<{ userId: string; username: string; avatarUrl: string | null; acceptedAt: string }>> = {};
      for (const r of memberRows) {
        const cid = Number(r.catalog_id);
        const uid = String(r.user_id);
        const p = profileById[uid];
        if (!p?.username) continue;
        if (!byCatalog[cid]) byCatalog[cid] = [];
        byCatalog[cid].push({
          userId: uid,
          username: p.username,
          avatarUrl: null,
          acceptedAt: String(r.accepted_at ?? "")
        });
      }

      for (const c of catalogs) {
        c.memberPreviews = (byCatalog[c.id] ?? [])
          .sort((a, b) => Date.parse(a.acceptedAt) - Date.parse(b.acceptedAt))
          .slice(0, 10)
          .map((m) => ({ userId: m.userId, username: m.username, avatarUrl: m.avatarUrl }));
      }
    }

    let books: any[] = [];
    if (allowedIds.length > 0) {
      const liteSelect =
        "id,library_id,created_at,visibility,title_override,authors_override,editors_override,subjects_override,publisher_override,designers_override,group_label,decade,cover_original_url,cover_crop,edition:editions(id,isbn13,title,authors,subjects,publisher,cover_url,publish_date),media:user_book_media(kind,storage_path),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,entity:entities(id,name,slug))";
      const fullSelect =
        "id,library_id,created_at,visibility,title_override,authors_override,editors_override,subjects_override,publisher_override,designers_override,group_label,decade,cover_original_url,cover_crop,edition:editions(id,isbn13,title,authors,subjects,publisher,cover_url,publish_date),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,entity:entities(id,name,slug))";
      const basicSelect =
        "id,library_id,created_at,visibility,title_override,authors_override,editors_override,subjects_override,publisher_override,designers_override,group_label,decade,edition:editions(id,isbn13,title,authors,subjects,publisher,cover_url,publish_date),media:user_book_media(id,kind,storage_path,caption,created_at),book_tags:user_book_tags(tag:tags(id,name,kind)),book_entities:book_entities(role,position,entity:entities(id,name,slug))";
    const minimalSelect =
      "id,library_id,created_at,visibility,title_override,authors_override,editors_override,subjects_override,publisher_override,designers_override,group_label,decade";

    const fetchBooks = async (select: string): Promise<{ rows: any[]; error: unknown }> => {
      const res = await admin
        .from("user_books")
        .select(select)
        .in("library_id", allowedIds)
        .order("created_at", { ascending: false })
        .limit(800);
      return { rows: (res.error ? [] : (res.data as any[])) ?? [], error: res.error ?? null };
    };

    if (lite) {
      const liteRes = await fetchBooks(liteSelect);
      if (liteRes.error) {
        const fullRes = await fetchBooks(fullSelect);
        if (!fullRes.error) {
          books = fullRes.rows;
        } else {
          const basicRes = await fetchBooks(basicSelect);
          if (!basicRes.error) {
            books = basicRes.rows;
          } else {
            const minimalRes = await fetchBooks(minimalSelect);
            books = minimalRes.rows;
          }
        }
      } else {
        books = liteRes.rows;
      }

      return NextResponse.json({ ok: true, catalogs, books });
    }

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
