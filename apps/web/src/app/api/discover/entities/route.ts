import { NextResponse } from "next/server";
import { getCurrentUser, getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type DiscoverRow = {
  user_book_id: number;
  owner_id: string;
  owner_username: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  publisher: string | null;
  relationship: "you" | "following" | "2nd_degree" | "public";
};

export async function GET(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });
    }

    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") ?? "").trim();
    const maxResults = Math.min(Math.max(Number(url.searchParams.get("max") ?? 40) || 40, 1), 120);
    if (!q) return NextResponse.json({ rows: [] satisfies DiscoverRow[] });

    const followeesRes = await admin
      .from("follows")
      .select("followee_id")
      .eq("follower_id", current.id)
      .eq("status", "approved");
    if (followeesRes.error) {
      return NextResponse.json({ error: followeesRes.error.message }, { status: 500 });
    }

    const followeeIds = Array.from(
      new Set(((followeesRes.data ?? []) as any[]).map((row) => String(row.followee_id ?? "").trim()).filter(Boolean))
    );
    const followeeSet = new Set(followeeIds);

    let secondDegreeSet = new Set<string>();
    if (followeeIds.length > 0) {
      const secondRes = await admin
        .from("follows")
        .select("followee_id")
        .in("follower_id", followeeIds)
        .eq("status", "approved");
      if (!secondRes.error) {
        secondDegreeSet = new Set(
          ((secondRes.data ?? []) as any[])
            .map((row) => String(row.followee_id ?? "").trim())
            .filter((id) => Boolean(id) && id !== current.id && !followeeSet.has(id))
        );
      }
    }

    const entityMatchesRes = await admin
      .from("book_entities")
      .select("user_book_id,role,entity:entities(name)")
      .ilike("entity.name", `%${q}%`)
      .limit(400);
    if (entityMatchesRes.error) {
      return NextResponse.json({ error: entityMatchesRes.error.message }, { status: 500 });
    }

    const userBookIds = Array.from(
      new Set(
        ((entityMatchesRes.data ?? []) as any[])
          .map((row) => Number(row.user_book_id))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );
    if (userBookIds.length === 0) return NextResponse.json({ rows: [] satisfies DiscoverRow[] });

    const booksRes = await admin
      .from("user_books")
      .select(
        "id,owner_id,visibility,title_override,authors_override,publisher_override,music_metadata,edition:editions(isbn13,title,authors,publisher),profile:profiles!user_books_owner_id_fkey(username,visibility)"
      )
      .in("id", userBookIds)
      .limit(400);
    if (booksRes.error) {
      return NextResponse.json({ error: booksRes.error.message }, { status: 500 });
    }

    const rows: DiscoverRow[] = [];
    for (const row of (booksRes.data ?? []) as any[]) {
      const ownerId = String(row.owner_id ?? "").trim();
      if (!ownerId) continue;
      const visibility = String(row.visibility ?? "inherit").trim();
      const profileVisibility = String(row.profile?.visibility ?? "").trim();
      const visible =
        ownerId === current.id ||
        visibility === "public" ||
        (visibility === "followers_only" && followeeSet.has(ownerId)) ||
        (visibility === "inherit" && (profileVisibility === "public" || followeeSet.has(ownerId)));
      if (!visible) continue;

      const title = String(row.title_override ?? "").trim() || String(row.edition?.title ?? "").trim() || "(untitled)";
      const authors =
        Array.isArray(row.authors_override) && row.authors_override.length > 0
          ? row.authors_override.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
          : Array.isArray(row.edition?.authors)
            ? row.edition.authors.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
            : [];
      const publisher = String(row.publisher_override ?? "").trim() || String(row.edition?.publisher ?? "").trim() || null;
      const relationship: DiscoverRow["relationship"] =
        ownerId === current.id ? "you" : followeeSet.has(ownerId) ? "following" : secondDegreeSet.has(ownerId) ? "2nd_degree" : "public";

      rows.push({
        user_book_id: Number(row.id),
        owner_id: ownerId,
        owner_username: String(row.profile?.username ?? "").trim(),
        title,
        authors,
        isbn13: String(row.edition?.isbn13 ?? "").trim() || null,
        publisher,
        relationship
      });
    }

    rows.sort((a, b) => {
      const score = (row: DiscoverRow) => (row.relationship === "you" ? 0 : row.relationship === "following" ? 1 : row.relationship === "2nd_degree" ? 2 : 3);
      return score(a) - score(b) || b.user_book_id - a.user_book_id;
    });

    return NextResponse.json({ rows: rows.slice(0, maxResults) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "unexpected_error" }, { status: 500 });
  }
}
