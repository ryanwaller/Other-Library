import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin, getCurrentUser } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";

type FeedbackCategory = "bug" | "feels_wrong" | "feature_idea" | "other";

function normalizeCategory(input: string): FeedbackCategory | null {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "bug") return "bug";
  if (raw === "feels_wrong") return "feels_wrong";
  if (raw === "feature_idea") return "feature_idea";
  if (raw === "other") return "other";
  return null;
}

export async function POST(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const form = await req.formData();
    const pageUrl = String(form.get("page_url") ?? "").trim();
    const pageTitle = String(form.get("page_title") ?? "").trim();
    const elementContext = String(form.get("element_context") ?? "").trim() || null;
    const category = normalizeCategory(String(form.get("category") ?? ""));
    const message = String(form.get("message") ?? "").trim();

    if (!pageUrl || !pageTitle || !category || !message) {
      return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
    }

    let screenshotPath: string | null = null;
    const maybeFile = form.get("screenshot");
    if (maybeFile && typeof maybeFile === "object" && "arrayBuffer" in maybeFile) {
      const file = maybeFile as File;
      if (file.size > 0) {
        if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "screenshot_too_large" }, { status: 400 });
        if (!String(file.type ?? "").toLowerCase().startsWith("image/")) {
          return NextResponse.json({ error: "invalid_screenshot_type" }, { status: 400 });
        }
        screenshotPath = `${current.id}/${crypto.randomUUID()}.jpg`;
        const bytes = Buffer.from(await file.arrayBuffer());
        const up = await admin.storage.from("feedback-screenshots").upload(screenshotPath, bytes, {
          upsert: false,
          contentType: file.type || "application/octet-stream",
          cacheControl: "3600"
        });
        if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
      }
    }

    const ins = await admin
      .from("feedback")
      .insert({
        user_id: current.id,
        page_url: pageUrl,
        page_title: pageTitle,
        element_context: elementContext,
        category,
        message,
        screenshot_path: screenshotPath
      })
      .select("id")
      .maybeSingle();

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: ins.data?.id ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "feedback_submit_failed" }, { status: 500 });
  }
}
