import { NextResponse } from "next/server";
import { getSupabaseAdmin, requireAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

function normStatus(input: string | null): "all" | "new" | "reviewing" | "resolved" | "wont_fix" {
  const v = String(input ?? "").trim().toLowerCase();
  if (v === "new" || v === "reviewing" || v === "resolved" || v === "wont_fix") return v;
  return "all";
}

function normCategory(input: string | null): "all" | "bug" | "feels_wrong" | "feature_idea" | "spacing_issue" | "design_issue" | "other" {
  const v = String(input ?? "").trim().toLowerCase();
  if (v === "bug" || v === "feels_wrong" || v === "feature_idea" || v === "spacing_issue" || v === "design_issue" || v === "other") return v;
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

    const runQuery = async (withScreenshotPath: boolean, withDeviceType: boolean): Promise<any> => {
      const selectCols = [
        "id",
        "user_id",
        "page_url",
        "page_title",
        "element_context",
        "category",
        "message",
        withScreenshotPath ? "screenshot_path" : "",
        withDeviceType ? "device_type" : "",
        "status",
        "admin_notes",
        "created_at",
        "updated_at"
      ]
        .filter(Boolean)
        .join(",");
      let query: any = admin
        .from("feedback")
        .select(selectCols)
        .order("created_at", { ascending: false });
      if (status !== "all") query = query.eq("status", status);
      if (category !== "all") query = query.eq("category", category);
      return await query;
    };

    let res: any = await runQuery(true, true);
    if (res.error && /screenshot_path/i.test(String(res.error.message ?? ""))) {
      res = await runQuery(false, true);
    }
    if (res.error && /device_type/i.test(String(res.error.message ?? ""))) {
      res = await runQuery(false, false);
    }
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });

    const rows = (res.data ?? []) as any[];
    const profileIds = Array.from(new Set(rows.map((r) => String(r?.user_id ?? "").trim()).filter(Boolean)));
    const profileById: Record<string, { id: string; username: string | null; display_name: string | null; avatar_path: string | null }> = {};
    if (profileIds.length > 0) {
      const pr = await admin.from("profiles").select("id,username,display_name,avatar_path").in("id", profileIds);
      if (!pr.error) {
        for (const p of (pr.data ?? []) as any[]) {
          const id = String(p?.id ?? "").trim();
          if (!id) continue;
          profileById[id] = {
            id,
            username: p?.username ?? null,
            display_name: p?.display_name ?? null,
            avatar_path: p?.avatar_path ?? null
          };
        }
      }
    }
    const avatarPaths = Array.from(
      new Set(
        rows
          .map((r) => String(profileById[String(r?.user_id ?? "").trim()]?.avatar_path ?? "").trim())
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
      const profile = profileById[String(r?.user_id ?? "").trim()] ?? null;
      const avatarPath = String(profile?.avatar_path ?? "").trim();
      const screenshotPath = String(r?.screenshot_path ?? "").trim();
      return {
        ...r,
        profile,
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
