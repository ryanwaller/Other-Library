import { NextResponse } from "next/server";
import { requireAdminClient, requireUser, toApiError } from "../_lib";

export async function GET(req: Request) {
  try {
    const current = await requireUser(req);
    const admin = requireAdminClient();

    const ownedRes = await admin
      .from("libraries")
      .select("id,name,created_at,sort_order,owner_id")
      .eq("owner_id", current.id)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (ownedRes.error) throw new Error(ownedRes.error.message);

    const membershipsRes = await admin
      .from("catalog_members")
      .select("catalog_id,role,accepted_at")
      .eq("user_id", current.id)
      .not("accepted_at", "is", null);
    if (membershipsRes.error) throw new Error(membershipsRes.error.message);

    const acceptedMemberships = ((membershipsRes.data ?? []) as any[])
      .map((r) => ({
        catalog_id: Number(r.catalog_id),
        role: (String(r.role ?? "").toLowerCase() === "owner" ? "owner" : "editor") as "owner" | "editor"
      }))
      .filter((r) => Number.isFinite(r.catalog_id) && r.catalog_id > 0);

    const roleByCatalog = new Map<number, "owner" | "editor">();
    for (const m of acceptedMemberships) roleByCatalog.set(m.catalog_id, m.role);

    const membershipCatalogIds = Array.from(new Set(acceptedMemberships.map((m) => m.catalog_id)));
    const sharedIds = membershipCatalogIds.filter((id) => !((ownedRes.data ?? []) as any[]).some((l) => Number(l.id) === id));

    let sharedLibs: any[] = [];
    if (sharedIds.length > 0) {
      const libsRes = await admin.from("libraries").select("id,name,created_at,owner_id").in("id", sharedIds);
      if (!libsRes.error) sharedLibs = (libsRes.data ?? []) as any[];
    }

    const all = [...((ownedRes.data ?? []) as any[]), ...sharedLibs];
    const byId = new Map<number, any>();
    for (const l of all) byId.set(Number(l.id), l);

    const catalogs = Array.from(byId.values())
      .sort((a, b) => {
        const aOrder = a.sort_order != null ? Number(a.sort_order) : null;
        const bOrder = b.sort_order != null ? Number(b.sort_order) : null;
        if (aOrder !== null && bOrder !== null) return aOrder - bOrder;
        if (aOrder !== null) return -1;
        if (bOrder !== null) return 1;
        return Date.parse(String(a.created_at ?? "")) - Date.parse(String(b.created_at ?? ""));
      })
      .map((l) => {
      const id = Number(l.id);
      const role = roleByCatalog.get(id) ?? (String(l.owner_id ?? "") === current.id ? "owner" : "editor");
      return {
        id,
        name: String(l.name ?? `Catalog ${id}`),
        created_at: String(l.created_at ?? new Date(0).toISOString()),
        sort_order: l.sort_order != null ? Number(l.sort_order) : null,
        owner_id: l.owner_id ? String(l.owner_id) : null,
        myRole: role,
        memberPreviews: [] as Array<{ userId: string; username: string; avatarUrl: string | null }>
      };
    });

    const catalogIds = catalogs.map((c) => c.id).filter((id) => Number.isFinite(id) && id > 0);
    if (catalogIds.length > 0) {
      const membersRes = await admin
        .from("catalog_members")
        .select("catalog_id,user_id,accepted_at")
        .in("catalog_id", catalogIds)
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

      const avatarByPath: Record<string, string> = {};
      const avatarPaths = Array.from(
        new Set(
          Object.values(profileById)
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
          avatarUrl: p.avatar_path ? avatarByPath[p.avatar_path] ?? null : null,
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

    return NextResponse.json({ ok: true, catalogs });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
