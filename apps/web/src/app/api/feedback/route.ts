import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin, getCurrentUser } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";

type FeedbackCategory = "bug" | "feels_wrong" | "feature_idea" | "spacing_issue" | "other";
type FeedbackDeviceType = "desktop" | "mobile" | "tablet" | "unknown";

function normalizeCategory(input: string): FeedbackCategory | null {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "bug") return "bug";
  if (raw === "feels_wrong") return "feels_wrong";
  if (raw === "feature_idea") return "feature_idea";
  if (raw === "spacing_issue") return "spacing_issue";
  if (raw === "other") return "other";
  return null;
}

function detectDeviceType(userAgent: string): FeedbackDeviceType {
  const ua = String(userAgent ?? "").toLowerCase();
  if (!ua) return "unknown";
  if (/(ipad|tablet|playbook|silk)|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/(mobi|iphone|ipod|android.*mobile|blackberry|iemobile|opera mini)/i.test(ua)) return "mobile";
  return "desktop";
}

export async function POST(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const form = await req.formData();
    const deviceType = detectDeviceType(req.headers.get("user-agent") ?? "");
    const pageUrl = String(form.get("page_url") ?? "").trim();
    const pageTitle = String(form.get("page_title") ?? "").trim();
    const elementContext = String(form.get("element_context") ?? "").trim() || null;
    const category = normalizeCategory(String(form.get("category") ?? ""));
    const message = String(form.get("message") ?? "").trim();

    if (!pageUrl || !pageTitle || !category || !message) {
      return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
    }

    let screenshotPath: string | null = null;
    let screenshotUploadFailed = false;
    let screenshotOmitted = false;
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
        if (up.error) {
          screenshotPath = null;
          screenshotUploadFailed = true;
        }
      }
    }

    const basePayload = {
      user_id: current.id,
      page_url: pageUrl,
      page_title: pageTitle,
      element_context: elementContext,
      message,
      device_type: deviceType
    };

    const insertFeedback = async (opts: { useScreenshotPath: boolean; useDeviceType: boolean; categoryValue: FeedbackCategory | "other" }) =>
      admin
        .from("feedback")
        .insert({
          user_id: basePayload.user_id,
          page_url: basePayload.page_url,
          page_title: basePayload.page_title,
          element_context: basePayload.element_context,
          message: basePayload.message,
          category: opts.categoryValue,
          ...(opts.useDeviceType ? { device_type: basePayload.device_type } : {}),
          ...(opts.useScreenshotPath && screenshotPath ? { screenshot_path: screenshotPath } : {})
        })
        .select("id")
        .maybeSingle();

    let includeScreenshotPath = true;
    let includeDeviceType = true;
    let ins = await insertFeedback({ useScreenshotPath: includeScreenshotPath, useDeviceType: includeDeviceType, categoryValue: category });

    if (ins.error && /screenshot_path/i.test(String(ins.error.message ?? ""))) {
      includeScreenshotPath = false;
      screenshotOmitted = true;
      ins = await insertFeedback({ useScreenshotPath: includeScreenshotPath, useDeviceType: includeDeviceType, categoryValue: category });
    }
    if (ins.error && /device_type/i.test(String(ins.error.message ?? ""))) {
      includeDeviceType = false;
      ins = await insertFeedback({ useScreenshotPath: includeScreenshotPath, useDeviceType: includeDeviceType, categoryValue: category });
    }

    if (ins.error && category === "spacing_issue") {
      // Backward-compatible fallback while DB migrations catch up.
      ins = await insertFeedback({ useScreenshotPath: includeScreenshotPath, useDeviceType: includeDeviceType, categoryValue: "other" });
      if (ins.error && /screenshot_path/i.test(String(ins.error.message ?? ""))) {
        includeScreenshotPath = false;
        screenshotOmitted = true;
        ins = await insertFeedback({ useScreenshotPath: includeScreenshotPath, useDeviceType: includeDeviceType, categoryValue: "other" });
      }
      if (ins.error && /device_type/i.test(String(ins.error.message ?? ""))) {
        includeDeviceType = false;
        ins = await insertFeedback({ useScreenshotPath: includeScreenshotPath, useDeviceType: includeDeviceType, categoryValue: "other" });
      }
    }

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      id: ins.data?.id ?? null,
      screenshot_upload_failed: screenshotUploadFailed,
      screenshot_omitted: screenshotOmitted,
      device_type: includeDeviceType ? deviceType : "unknown"
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "feedback_submit_failed" }, { status: 500 });
  }
}
