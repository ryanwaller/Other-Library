import { NextResponse } from "next/server";
import { getCurrentUser, getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";

type CsvImportRow = {
  title: string;
  isbn: string | null;
  authors: string[];
  publisher: string | null;
  publish_date: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  notes: string | null;
  group_label: string | null;
  object_type: string | null;
  copies: number;
};

function normalizeRow(input: any): CsvImportRow | null {
  const title = String(input?.title ?? "").trim();
  const isbn = String(input?.isbn ?? "").trim() || null;
  const authors = Array.isArray(input?.authors)
    ? input.authors.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const tags = Array.isArray(input?.tags)
    ? input.tags.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const copiesNum = Number(input?.copies ?? 1);
  const copies = Number.isFinite(copiesNum) && copiesNum > 1 ? Math.floor(copiesNum) : 1;
  if (!title && !isbn) return null;
  return {
    title,
    isbn,
    authors,
    publisher: String(input?.publisher ?? "").trim() || null,
    publish_date: String(input?.publish_date ?? "").trim() || null,
    description: String(input?.description ?? "").trim() || null,
    category: String(input?.category ?? "").trim() || null,
    tags,
    notes: String(input?.notes ?? "").trim() || null,
    group_label: String(input?.group_label ?? "").trim() || null,
    object_type: String(input?.object_type ?? "").trim() || null,
    copies
  };
}

function serializeJob(job: any) {
  return {
    id: String(job.id),
    library_id: Number(job.library_id),
    status: String(job.status),
    total_rows: Number(job.total_rows ?? 0),
    processed_rows: Number(job.processed_rows ?? 0),
    success_rows: Number(job.success_rows ?? 0),
    failed_rows: Number(job.failed_rows ?? 0),
    last_error: typeof job.last_error === "string" ? job.last_error : null,
    apply_overrides: Boolean(job.apply_overrides),
    created_at: String(job.created_at ?? ""),
    updated_at: String(job.updated_at ?? ""),
    started_at: job.started_at ? String(job.started_at) : null,
    finished_at: job.finished_at ? String(job.finished_at) : null
  };
}

export async function GET(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const url = new URL(req.url);
    const jobId = String(url.searchParams.get("job_id") ?? "").trim();
    const active = String(url.searchParams.get("active") ?? "") === "1";

    let query = admin.from("csv_import_jobs").select("*").eq("owner_id", current.id);
    if (jobId) {
      query = query.eq("id", jobId);
    } else if (active) {
      query = query.in("status", ["pending", "running"]).order("created_at", { ascending: false }).limit(1);
    } else {
      query = query.order("created_at", { ascending: false }).limit(1);
    }

    const res = jobId ? await query.maybeSingle() : await query;
    if ((res as any).error) return NextResponse.json({ error: (res as any).error.message }, { status: 500 });

    const row = jobId
      ? (res as any).data
      : Array.isArray((res as any).data)
        ? ((res as any).data[0] ?? null)
        : null;

    return NextResponse.json({ ok: true, job: row ? serializeJob(row) : null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "csv_import_status_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const libraryId = Number(body?.library_id);
    const applyOverrides = Boolean(body?.apply_overrides);
    const rows = Array.isArray(body?.rows) ? body.rows.map(normalizeRow).filter(Boolean) as CsvImportRow[] : [];

    if (!Number.isFinite(libraryId) || libraryId <= 0) {
      return NextResponse.json({ error: "invalid_library_id" }, { status: 400 });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "no_rows" }, { status: 400 });
    }

    const [ownedLibRes, memberLibRes] = await Promise.all([
      admin.from("libraries").select("id").eq("id", libraryId).eq("owner_id", current.id).maybeSingle(),
      admin
        .from("catalog_members")
        .select("catalog_id,role,accepted_at")
        .eq("catalog_id", libraryId)
        .eq("user_id", current.id)
        .not("accepted_at", "is", null)
        .maybeSingle()
    ]);

    const allowedAsOwner = Boolean(ownedLibRes.data?.id);
    const memberRole = String((memberLibRes.data as any)?.role ?? "").trim().toLowerCase();
    const allowedAsMember = memberRole === "owner" || memberRole === "editor";
    if (!allowedAsOwner && !allowedAsMember) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const existingActive = await admin
      .from("csv_import_jobs")
      .select("*")
      .eq("owner_id", current.id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (existingActive.error) {
      return NextResponse.json({ error: existingActive.error.message }, { status: 500 });
    }
    const activeJob = Array.isArray(existingActive.data) ? existingActive.data[0] : null;
    if (activeJob?.id) {
      return NextResponse.json({ ok: true, job: serializeJob(activeJob), reused: true });
    }

    const insertRes = await admin
      .from("csv_import_jobs")
      .insert({
        owner_id: current.id,
        library_id: libraryId,
        apply_overrides: applyOverrides,
        rows,
        total_rows: rows.length,
        processed_rows: 0,
        success_rows: 0,
        failed_rows: 0,
        status: "pending"
      })
      .select("*")
      .single();
    if (insertRes.error) return NextResponse.json({ error: insertRes.error.message }, { status: 500 });

    return NextResponse.json({ ok: true, job: serializeJob(insertRes.data) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "csv_import_create_failed" }, { status: 500 });
  }
}
