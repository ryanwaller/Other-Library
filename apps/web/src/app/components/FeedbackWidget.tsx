"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabaseClient";

type FeedbackCategory = "bug" | "feels_wrong" | "feature_idea" | "other";

function routeTitle(pathname: string): string {
  const p = String(pathname ?? "").trim();
  if (p === "/app") return "Homepage";
  if (p.startsWith("/app/books/")) return "Book detail page";
  if (p.startsWith("/u/") && p.includes("/b/")) return "Public book detail page";
  if (p.startsWith("/u/")) return "Public profile";
  if (p.startsWith("/admin")) return "Admin page";
  if (p.startsWith("/app/settings")) return "Settings page";
  if (p.startsWith("/app/messages")) return "Messages page";
  if (p.startsWith("/app/borrow-requests")) return "Borrow requests page";
  if (p.startsWith("/facet/")) return "Facet page";
  return "Page";
}

export default function FeedbackWidget() {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elementContext, setElementContext] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);

  const pageTitle = useMemo(() => routeTitle(pathname ?? ""), [pathname]);
  const pageUrl = useMemo(() => {
    if (typeof window === "undefined") return pathname ?? "/";
    return window.location.href;
  }, [pathname]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  if (!supabase || !session) return null;

  async function submitFeedback() {
    if (busy) return;
    const accessToken = session?.access_token ?? "";
    if (!accessToken) return;
    if (!message.trim()) {
      setStatusText("Couldn't send — try again");
      setStatusError(true);
      return;
    }
    if (screenshot && screenshot.size > 5 * 1024 * 1024) {
      setStatusText("Couldn't send — try again");
      setStatusError(true);
      return;
    }
    setBusy(true);
    setStatusText(null);
    setStatusError(false);
    try {
      const form = new FormData();
      form.set("page_url", pageUrl);
      form.set("page_title", pageTitle);
      form.set("element_context", elementContext.trim());
      form.set("category", category);
      form.set("message", message.trim());
      if (screenshot) form.set("screenshot", screenshot);

      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        body: form
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as any)?.error ?? "feedback_failed"));

      setStatusText("Sent — thanks");
      setStatusError(false);
      window.setTimeout(() => {
        setOpen(false);
        setElementContext("");
        setCategory("bug");
        setMessage("");
        setScreenshot(null);
        setPreviewUrl(null);
        setStatusText(null);
      }, 2000);
    } catch {
      setStatusText("Couldn't send — try again");
      setStatusError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", left: 20, bottom: 20, zIndex: 1200 }}>
      {open ? (
        <div style={{ width: 320, marginBottom: 10, padding: "var(--space-md)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 0 }}>
          <div className="text-muted" style={{ marginBottom: "var(--space-8)" }}>
            {pageTitle}
          </div>
          <div className="text-muted" style={{ marginBottom: "var(--space-md)", wordBreak: "break-all" }}>
            {pageUrl}
          </div>

          <input
            value={elementContext}
            onChange={(e) => setElementContext(e.target.value)}
            placeholder="What part of the page is this about?"
            style={{ width: "100%" }}
          />
          <select
            className="om-filter-control"
            value={category}
            onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
            style={{ marginTop: "var(--space-8)", width: "100%" }}
          >
            <option value="bug">Bug</option>
            <option value="feels_wrong">Feels wrong</option>
            <option value="feature_idea">Feature idea</option>
            <option value="other">Other</option>
          </select>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe what you noticed"
            style={{ width: "100%", minHeight: 90, marginTop: "var(--space-8)" }}
          />
          <div style={{ marginTop: "var(--space-8)" }}>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setScreenshot((e.target.files ?? [])[0] ?? null)}
            />
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" style={{ marginTop: "var(--space-8)", maxWidth: 96, maxHeight: 96, objectFit: "cover" }} />
            ) : null}
          </div>

          <div className="row" style={{ justifyContent: "space-between", marginTop: "var(--space-md)" }}>
            <button className="om-inline-link-muted" onClick={() => setOpen(false)} disabled={busy}>
              Close
            </button>
            <button className="om-inline-link-muted" onClick={() => void submitFeedback()} disabled={busy || !message.trim()}>
              Send
            </button>
          </div>
          {statusText ? (
            <div className="text-muted" style={{ marginTop: "var(--space-8)", color: statusError ? "var(--danger)" : undefined }}>
              {statusText}
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        aria-label="Send feedback"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text-muted)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--fg)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        💬
      </button>
    </div>
  );
}
