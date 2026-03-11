import { NextResponse } from "next/server";
import { getCurrentUser, getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

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

type JobRow = {
  id: string;
  owner_id: string;
  library_id: number;
  status: string;
  apply_overrides: boolean;
  rows: CsvImportRow[];
  total_rows: number;
  processed_rows: number;
  success_rows: number;
  failed_rows: number;
};

function parseStructuredNotes(notes: string | null): {
  data: Record<string, string>;
  remainingNotes: string | null;
} {
  if (!notes) return { data: {}, remainingNotes: null };

  const pairs = notes.split(";");
  const data: Record<string, string> = {};
  const unmapped: string[] = [];
  const mappings: Record<string, string> = {
    objecttype: "object_type",
    "object type": "object_type",
    subject: "subjects_override",
    subjects: "subjects_override",
    decade: "decade",
    design: "designers_override",
    "art direction": "designers_override",
    designer: "designers_override",
    designers: "designers_override",
    production: "materials_override",
    tags: "subjects_override",
    tag: "subjects_override",
    editor: "editors_override",
    editors: "editors_override",
    printer: "printer_override",
    materials: "materials_override",
    material: "materials_override",
    pages: "pages",
    publisher: "publisher_override"
  };

  for (const p of pairs) {
    const trimmedPair = p.trim();
    if (!trimmedPair) continue;
    const colonIdx = trimmedPair.indexOf(":");
    if (colonIdx === -1) {
      unmapped.push(trimmedPair);
      continue;
    }
    const keyRaw = trimmedPair.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmedPair.slice(colonIdx + 1).trim();
    const mapped = mappings[keyRaw];
    if (!mapped || !value) {
      unmapped.push(trimmedPair);
      continue;
    }
    data[mapped] = value;
  }

  const remaining = unmapped.join("; ").trim();
  return { data, remainingNotes: remaining || null };
}

function normalizeList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

async function getOrCreateTagId(admin: ReturnType<typeof getSupabaseAdmin>, ownerId: string, name: string, kind: "tag" | "category"): Promise<number> {
  const normalized = name.trim().replace(/\s+/g, " ");
  const existing = await admin.from("tags").select("id").eq("owner_id", ownerId).eq("name", normalized).eq("kind", kind).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) return existing.data.id as number;
  const inserted = await admin.from("tags").insert({ owner_id: ownerId, name: normalized, kind }).select("id").single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data.id as number;
}

async function createUserBookByIsbn(admin: ReturnType<typeof getSupabaseAdmin>, req: Request, ownerId: string, libraryId: number, isbnValue: string): Promise<{ id: number; editionAuthors: string[]; editionPublisher: string | null }> {
  const isbn = isbnValue.trim();
  if (!isbn) throw new Error("Provide an ISBN");
  const res = await fetch(new URL(`/api/isbn?isbn=${encodeURIComponent(isbn)}`, req.url));
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? "ISBN lookup failed");
  const edition = (json.edition ?? {}) as any;
  const isbn13 = String(edition.isbn13 ?? "").trim();
  if (!isbn13) throw new Error("No ISBN-13 returned by resolver");

  const existing = await admin.from("editions").select("id,authors,publisher").eq("isbn13", isbn13).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  let editionId = existing.data?.id as number | undefined;
  let editionAuthors: string[] = (existing.data?.authors as string[] | null) ?? [];
  let editionPublisher: string | null = (existing.data?.publisher as string | null) ?? null;

  if (!editionId) {
    editionAuthors = (edition.authors as string[] | null) ?? [];
    editionPublisher = (edition.publisher as string | null) ?? null;
    const inserted = await admin
      .from("editions")
      .insert({
        isbn10: edition.isbn10 ?? null,
        isbn13,
        title: edition.title ?? null,
        authors: editionAuthors,
        publisher: editionPublisher,
        publish_date: edition.publish_date ?? null,
        description: edition.description ?? null,
        subjects: edition.subjects ?? [],
        cover_url: edition.cover_url ?? null,
        raw: edition.raw ?? null
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    editionId = inserted.data.id;
  }

  const created = await admin
    .from("user_books")
    .insert({ owner_id: ownerId, library_id: libraryId, edition_id: editionId })
    .select("id")
    .single();
  if (created.error) throw new Error(created.error.message);
  return { id: created.data.id as number, editionAuthors, editionPublisher };
}

async function createManualUserBook(admin: ReturnType<typeof getSupabaseAdmin>, ownerId: string, libraryId: number, row: CsvImportRow): Promise<number> {
  const title = row.title.trim();
  if (!title) throw new Error("Provide a title");
  const created = await admin
    .from("user_books")
    .insert({
      owner_id: ownerId,
      library_id: libraryId,
      edition_id: null,
      title_override: title,
      authors_override: row.authors.length > 0 ? row.authors : null,
      publisher_override: row.publisher ?? null,
      publish_date_override: row.publish_date ?? null,
      description_override: row.description ?? null
    })
    .select("id")
    .single();
  if (created.error) throw new Error(created.error.message);
  return created.data.id as number;
}

async function adminSetBookEntities(admin: ReturnType<typeof getSupabaseAdmin>, userBookId: number, role: string, names: string[]) {
  const cleaned = normalizeList(names);
  if (!cleaned.length) return;
  // Delete existing rows for this role then re-insert
  await admin.from("book_entities").delete().eq("user_book_id", userBookId).eq("role", role);
  for (let i = 0; i < cleaned.length; i++) {
    const res = await admin.rpc("ensure_entity", { name: cleaned[i] });
    if (res.error) continue;
    await admin.from("book_entities").insert({ user_book_id: userBookId, entity_id: res.data, role, position: i + 1 }).select();
  }
}

async function processSingleRow(admin: ReturnType<typeof getSupabaseAdmin>, req: Request, job: JobRow, row: CsvImportRow) {
  const tagIdCache = new Map<string, number>();
  const getTagIdCached = async (name: string, kind: "tag" | "category") => {
    const key = `${kind}:${name.trim().toLowerCase()}`;
    const cached = tagIdCache.get(key);
    if (cached) return cached;
    const id = await getOrCreateTagId(admin, job.owner_id, name, kind);
    tagIdCache.set(key, id);
    return id;
  };

  const copies = Math.max(1, Math.floor(Number(row.copies) || 1));
  for (let c = 0; c < copies; c += 1) {
    let id: number;
    let editionAuthors: string[] = [];
    let editionPublisher: string | null = null;
    if (row.isbn) {
      const result = await createUserBookByIsbn(admin, req, job.owner_id, job.library_id, row.isbn);
      id = result.id;
      editionAuthors = result.editionAuthors;
      editionPublisher = result.editionPublisher;
    } else {
      id = await createManualUserBook(admin, job.owner_id, job.library_id, row);
    }
    const { data: parsed, remainingNotes } = parseStructuredNotes(row.notes);
    const updatePayload: Record<string, any> = { notes: remainingNotes };
    if (!remainingNotes && row.notes) updatePayload.notes = null;
    if (row.group_label) updatePayload.group_label = row.group_label;
    updatePayload.object_type = row.object_type || parsed.object_type || null;
    if (parsed.subjects_override) updatePayload.subjects_override = normalizeList(parsed.subjects_override.split(","));
    if (parsed.designers_override) updatePayload.designers_override = normalizeList(parsed.designers_override.split(","));
    if (parsed.editors_override) updatePayload.editors_override = normalizeList(parsed.editors_override.split(","));
    if (parsed.publisher_override && !row.publisher) updatePayload.publisher_override = parsed.publisher_override;
    if (parsed.printer_override) updatePayload.printer_override = parsed.printer_override;
    if (parsed.materials_override) updatePayload.materials_override = parsed.materials_override;
    if (parsed.decade) updatePayload.decade = parsed.decade;
    if (parsed.pages) {
      const p = Number(parsed.pages);
      if (Number.isFinite(p)) updatePayload.pages = Math.max(1, Math.floor(p));
    }
    if (job.apply_overrides && row.isbn) {
      if (row.title) updatePayload.title_override = row.title;
      if (row.authors.length > 0) updatePayload.authors_override = row.authors;
      if (row.publisher) updatePayload.publisher_override = row.publisher;
      if (row.publish_date) updatePayload.publish_date_override = row.publish_date;
      if (row.description) updatePayload.description_override = row.description;
    }

    if (Object.keys(updatePayload).length > 0) {
      let up = await admin.from("user_books").update(updatePayload).eq("id", id);
      if (up.error) {
        const msg = String(up.error.message ?? "").toLowerCase();
        if (msg.includes("trim_width") || msg.includes("group_label")) {
          delete updatePayload.decade;
          delete updatePayload.pages;
          delete updatePayload.group_label;
          delete updatePayload.object_type;
          up = await admin.from("user_books").update(updatePayload).eq("id", id);
        }
      }
      if (up?.error) throw new Error(up.error.message);
    }

    try {
      const syncRoles: Array<[string, string[]]> = [];
      const authorsToSync = (updatePayload.authors_override as string[] | undefined)
        ?? (row.authors.length > 0 ? row.authors : null)
        ?? (editionAuthors.length > 0 ? editionAuthors : null);
      if (authorsToSync && authorsToSync.length > 0) syncRoles.push(["author", authorsToSync]);
      if (updatePayload.designers_override) syncRoles.push(["designer", updatePayload.designers_override as string[]]);
      if (updatePayload.editors_override) syncRoles.push(["editor", updatePayload.editors_override as string[]]);
      const publisherToSync = (updatePayload.publisher_override as string | undefined) ?? row.publisher ?? editionPublisher ?? null;
      if (publisherToSync) syncRoles.push(["publisher", publisherToSync.split(",").map((s) => s.trim()).filter(Boolean)]);
      if (updatePayload.printer_override) syncRoles.push(["printer", String(updatePayload.printer_override).split(",").map((s) => s.trim()).filter(Boolean)]);
      for (const [role, names] of syncRoles) {
        await adminSetBookEntities(admin, id, role, names);
      }
    } catch {
      // best effort
    }

    const rows: Array<{ user_book_id: number; tag_id: number }> = [];
    if (row.category) rows.push({ user_book_id: id, tag_id: await getTagIdCached(row.category, "category") });
    for (const t of row.tags) rows.push({ user_book_id: id, tag_id: await getTagIdCached(t, "tag") });
    if (rows.length > 0) {
      const upTags = await admin.from("user_book_tags").upsert(rows as any, { onConflict: "user_book_id,tag_id" });
      if (upTags.error) throw new Error(upTags.error.message);
    }
  }
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

export async function POST(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const jobId = String(body?.job_id ?? "").trim();
    if (!jobId) return NextResponse.json({ error: "missing_job_id" }, { status: 400 });

    const jobRes = await admin.from("csv_import_jobs").select("*").eq("id", jobId).eq("owner_id", current.id).maybeSingle();
    if (jobRes.error) return NextResponse.json({ error: jobRes.error.message }, { status: 500 });
    const job = jobRes.data as unknown as JobRow | null;
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return NextResponse.json({ ok: true, job: serializeJob(job), processed: 0 });
    }

    const batchSize = 25;
    const startIndex = Number(job.processed_rows ?? 0);
    const rows = Array.isArray(job.rows) ? job.rows : [];
    const batch = rows.slice(startIndex, startIndex + batchSize);
    if (batch.length === 0) {
      const doneRes = await admin
        .from("csv_import_jobs")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", job.id)
        .select("*")
        .single();
      if (doneRes.error) return NextResponse.json({ error: doneRes.error.message }, { status: 500 });
      return NextResponse.json({ ok: true, job: serializeJob(doneRes.data), processed: 0 });
    }

    if (job.status === "pending") {
      await admin.from("csv_import_jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", job.id);
    }

    let processed = 0;
    let success = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (const row of batch) {
      try {
        await processSingleRow(admin, req, job, row);
        success += 1;
      } catch (e: any) {
        failed += 1;
        lastError = e?.message ?? "Row import failed";
      }
      processed += 1;
    }

    const nextProcessed = startIndex + processed;
    const nextStatus = nextProcessed >= Number(job.total_rows ?? rows.length) ? "completed" : "running";
    const updateRes = await admin
      .from("csv_import_jobs")
      .update({
        processed_rows: Number(job.processed_rows ?? 0) + processed,
        success_rows: Number(job.success_rows ?? 0) + success,
        failed_rows: Number(job.failed_rows ?? 0) + failed,
        last_error: lastError,
        status: nextStatus,
        finished_at: nextStatus === "completed" ? new Date().toISOString() : null
      })
      .eq("id", job.id)
      .select("*")
      .single();
    if (updateRes.error) return NextResponse.json({ error: updateRes.error.message }, { status: 500 });

    return NextResponse.json({ ok: true, job: serializeJob(updateRes.data), processed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "csv_import_process_failed" }, { status: 500 });
  }
}
