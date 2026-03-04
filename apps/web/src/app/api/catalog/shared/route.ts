import { NextResponse } from "next/server";
import { requireAdminClient, requireUser, toApiError } from "../_lib";

type MembershipRow = {
  id: string;
  catalog_id: number;
  user_id: string;
  role: "owner" | "editor";
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
};

export async function GET(req: Request) {
  try {
    const current = await requireUser(req);
    const admin = requireAdminClient();

    const memberships = await admin
      .from("catalog_members")
      .select("id,catalog_id,user_id,role,invited_by,invited_at,accepted_at")
      .eq("user_id", current.id)
      .neq("role", "owner")
      .order("invited_at", { ascending: true });
    if (memberships.error) throw new Error(memberships.error.message);

    const rows = ((memberships.data ?? []) as any[]).map((r) => ({
      id: String(r.id),
      catalog_id: Number(r.catalog_id),
      user_id: String(r.user_id),
      role: (String(r.role) === "viewer" ? "editor" : String(r.role)) as MembershipRow["role"],
      invited_by: r.invited_by ? String(r.invited_by) : null,
      invited_at: String(r.invited_at),
      accepted_at: r.accepted_at ? String(r.accepted_at) : null
    }));

    const catalogIds = Array.from(new Set(rows.map((r) => r.catalog_id)));
    const inviterIds = Array.from(new Set(rows.map((r) => r.invited_by).filter(Boolean))) as string[];

    const catalogsById: Record<number, { id: number; name: string }> = {};
    if (catalogIds.length > 0) {
      const libs = await admin.from("libraries").select("id,name").in("id", catalogIds);
      if (!libs.error) {
        for (const l of (libs.data as any[]) ?? []) {
          catalogsById[Number(l.id)] = { id: Number(l.id), name: String(l.name ?? "Catalog") };
        }
      }
    }

    const invitersById: Record<string, { id: string; username: string | null }> = {};
    if (inviterIds.length > 0) {
      const pr = await admin.from("profiles").select("id,username").in("id", inviterIds);
      if (!pr.error) {
        for (const p of (pr.data as any[]) ?? []) {
          invitersById[String(p.id)] = { id: String(p.id), username: p.username ? String(p.username) : null };
        }
      }
    }

    const withDetails = rows.map((r) => ({
      ...r,
      catalog: catalogsById[r.catalog_id] ?? null,
      inviter: r.invited_by ? invitersById[r.invited_by] ?? null : null
    }));

    const ownedLibsRes = await admin.from("libraries").select("id,name").eq("owner_id", current.id).order("created_at", { ascending: true });
    const ownedLibs = ((ownedLibsRes.data ?? []) as any[]).map((l) => ({ id: Number(l.id), name: String(l.name ?? "Catalog") }));
    const ownedCatalogIds = ownedLibs.map((l) => l.id).filter((id) => Number.isFinite(id) && id > 0);

    const ownedMembersByCatalog: Record<number, Array<{ user_id: string; username: string | null; accepted_at: string | null }>> = {};
    if (ownedCatalogIds.length > 0) {
      const ownedMembersRes = await admin
        .from("catalog_members")
        .select("catalog_id,user_id,accepted_at")
        .in("catalog_id", ownedCatalogIds)
        .neq("user_id", current.id)
        .order("invited_at", { ascending: true });
      const ownedRows = (ownedMembersRes.error ? [] : ((ownedMembersRes.data ?? []) as any[])).map((r) => ({
        catalog_id: Number(r.catalog_id),
        user_id: String(r.user_id),
        accepted_at: r.accepted_at ? String(r.accepted_at) : null
      }));
      const ownedMemberIds = Array.from(new Set(ownedRows.map((r) => r.user_id)));
      let usernameById: Record<string, string | null> = {};
      if (ownedMemberIds.length > 0) {
        const pr = await admin.from("profiles").select("id,username").in("id", ownedMemberIds);
        if (!pr.error) {
          usernameById = Object.fromEntries(((pr.data ?? []) as any[]).map((p) => [String(p.id), p.username ? String(p.username) : null]));
        }
      }
      for (const r of ownedRows) {
        if (!ownedMembersByCatalog[r.catalog_id]) ownedMembersByCatalog[r.catalog_id] = [];
        ownedMembersByCatalog[r.catalog_id].push({
          user_id: r.user_id,
          username: usernameById[r.user_id] ?? null,
          accepted_at: r.accepted_at
        });
      }
    }

    const ownedShared = ownedLibs
      .map((l) => ({
        catalog: { id: l.id, name: l.name },
        members: ownedMembersByCatalog[l.id] ?? []
      }))
      .filter((l) => l.members.length > 0);

    return NextResponse.json({
      ok: true,
      pending: withDetails.filter((r) => !r.accepted_at),
      shared: withDetails.filter((r) => Boolean(r.accepted_at)),
      owned_shared: ownedShared
    });
  } catch (err) {
    const e = toApiError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
