import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

function normStatus(input: string | null): "all" | "new" | "reviewing" | "resolved" | "wont_fix" {
  const v = String(input ?? "").trim().toLowerCase();
  if (v === "new" || v === "reviewing" || v === "resolved" || v === "wont_fix") return v;
  return "all";
}

function normCategory(input: string | null): "all" | "bug" | "feels_wrong" | "feature_idea" | "other" {
  const v = String(input ?? "").trim().toLowerCase();
  if (v === "bug" || v === "feels_wrong" || v === "feature_idea" || v === "other") return v;
  return "all";
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "admin_not_configured" }, { status: 500 });

    const url = new URL(req.url);
    const status = normStatus(url.searchParams.get("status"));
    const category = normCategory(url.searchParams.get("category"));

    let query = admin
      .from("feedback")
      .select("id,user_id,page_url,page_title,element_context,category,message,screenshot_path,status,admin_notes,created_at,updated_at,profile:profiles!feedback_user_id_fkey(id,username,display_name,avatar_path)")
      .order("created_at", { ascending: false });
    if (status !== "all") query = query.eq("status", status);
    if (category !== "all") query = query.eq("category", category);

    const res = await query;
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });

    const rows = (res.data ?? []) as any[];
    const avatarPaths = Array.from(
      new Set(
        rows
          .map((r) => String(r?.profile?.avatar_path ?? "").trim())
          .filter(Boolean)
      )
    );
    const avatarUrlByPath: Record<string, string> = {};
    if (avatarPaths.length > 0) {
      const direct = avatarPaths.filter((p) => /^https?:\/\//i.test(p));
      for (const p of direct) avatarUrlByPath[p] = p;
      const storagePaths = avatarPaths.filter((p) => !/^https?:\/\//i.test(p));
      if (storagePaths.length > 0) {
        const signed = await admin.storage.from("avatars").createSignedUrls(storagePaths, 60 * 30);
        if (!signed.error) {
          for (const s of signed.data ?? []) {
            if (s.path && s.signedUrl) avatarUrlByPath[s.path] = s.signedUrl;
          }
        }
      }
    }

    const screenshotPaths = Array.from(
      new Set(
        rows
          .map((r) => String(r?.screenshot_path ?? "").trim())
          .filter(Boolean)
      )
    );
    const screenshotUrlByPath: Record<string, string> = {};
    if (screenshotPaths.length > 0) {
      const signed = await admin.storage.from("feedback-screenshots").createSignedUrls(screenshotPaths, 60 * 30);
      if (!signed.error) {
        for (const s of signed.data ?? []) {
          if (s.path && s.signedUrl) screenshotUrlByPath[s.path] = s.signedUrl;
        }
      }
    }

    const feedback = rows.map((r) => {
      const avatarPath = String(r?.profile?.avatar_path ?? "").trim();
      const screenshotPath = String(r?.screenshot_path ?? "").trim();
      return {
        ...r,
        avatar_url: avatarPath ? avatarUrlByPath[avatarPath] ?? null : null,
        screenshot_url: screenshotPath ? screenshotUrlByPath[screenshotPath] ?? null : null
      };
    });

    return NextResponse.json({ feedback, total: feedback.length });
  } catch (e: any) {
    const msg = e?.message ?? "forbidden";
    const status = msg === "not_authenticated" ? 401 : msg === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

