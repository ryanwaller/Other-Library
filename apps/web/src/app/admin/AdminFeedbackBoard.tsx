"use client";

import { useEffect, useMemo, useState } from "react";

type FeedbackStatus = "new" | "reviewing" | "resolved" | "wont_fix";
type FeedbackCategory = "bug" | "feels_wrong" | "feature_idea" | "other";

type FeedbackRow = {
  id: string;
  user_id: string;
  page_url: string;
  page_title: string;
  element_context: string | null;
  category: FeedbackCategory;
  message: string;
  screenshot_path: string | null;
  screenshot_url: string | null;
  status: FeedbackStatus;
  admin_notes: string | null;
  created_at: string;
  profile: {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_path: string | null;
  } | null;
  avatar_url: string | null;
};

const STATUSES: Array<{ key: FeedbackStatus; label: string }> = [
  { key: "new", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "resolved", label: "Resolved" },
  { key: "wont_fix", label: "Won't fix" }
];

const CATEGORIES: Array<{ key: FeedbackCategory; label: string }> = [
  { key: "bug", label: "Bug" },
  { key: "feels_wrong", label: "Feels wrong" },
  { key: "feature_idea", label: "Feature idea" },
  { key: "other", label: "Other" }
];

function relTime(iso: string): string {
  const ts = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ts)) return "just now";
  const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function categoryLabel(category: FeedbackCategory): string {
  const found = CATEGORIES.find((c) => c.key === category);
  return found ? found.label : "Other";
}

export default function AdminFeedbackBoard({ token }: { token: string }) {
  const [statusFilter, setStatusFilter] = useState<"all" | FeedbackStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | FeedbackCategory>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("category", categoryFilter);
      const res = await fetch(`/api/admin/feedback?${params.toString()}`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as any)?.error ?? "feedback_load_failed"));
      const data = Array.isArray((json as any)?.feedback) ? ((json as any).feedback as FeedbackRow[]) : [];
      setRows(data);
      setNotesDraft(Object.fromEntries(data.map((r) => [r.id, String(r.admin_notes ?? "")])));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load feedback");
      setRows([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, statusFilter, categoryFilter]);

  async function patchRow(id: string, patch: Partial<Pick<FeedbackRow, "status" | "admin_notes">>) {
    const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String((json as any)?.error ?? "feedback_patch_failed"));
  }

  const grouped = useMemo(() => {
    const map: Record<FeedbackStatus, FeedbackRow[]> = { new: [], reviewing: [], resolved: [], wont_fix: [] };
    for (const row of rows) map[row.status].push(row);
    return map;
  }, [rows]);

  return (
    <div style={{ marginTop: "var(--space-lg)", width: "calc(100vw - 48px)", marginLeft: "calc(50% - 50vw + 24px)" }}>
      <div className="row" style={{ gap: "var(--space-8)", alignItems: "center", flexWrap: "wrap" }}>
        <select className="om-filter-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="om-filter-control" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as any)}>
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="text-muted">Total {rows.length}</span>
        <button className="om-inline-link-muted" onClick={() => void load()} disabled={busy}>
          Refresh
        </button>
      </div>

      {error ? (
        <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
          {error}
        </div>
      ) : null}

      <div style={{ marginTop: "var(--space-lg)", width: "100%", overflowX: "auto" }}>
        <div style={{ minWidth: 1320, display: "grid", gridTemplateColumns: "repeat(4, minmax(300px, 1fr))", gap: "var(--space-md)" }}>
          {STATUSES.map((col) => (
            <div key={col.key} className="card" style={{ minHeight: 220 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <div>{col.label}</div>
                <span className="text-muted">{grouped[col.key].length}</span>
              </div>
              <div style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                {grouped[col.key].map((row) => (
                  <div key={row.id} style={{ border: "1px solid var(--border)", padding: "var(--space-sm)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-8)" }}>
                      <div className="om-avatar-lockup" style={{ minWidth: 0 }}>
                        {row.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt="" src={row.avatar_url} style={{ width: 20, height: 20, borderRadius: 999, objectFit: "cover", border: "1px solid var(--border-avatar)" }} />
                        ) : (
                          <span style={{ width: 20, height: 20, borderRadius: 999, display: "inline-block", background: "var(--placeholder-bg)" }} />
                        )}
                        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{row.profile?.username || row.user_id.slice(0, 8)}</span>
                      </div>
                      <span className="text-muted" style={{ whiteSpace: "nowrap" }}>
                        {relTime(row.created_at)}
                      </span>
                    </div>

                    <div className="row" style={{ gap: "var(--space-8)", alignItems: "center", flexWrap: "wrap" }}>
                      <a href={row.page_url} target="_blank" rel="noreferrer" className="text-muted">
                        {row.page_title}
                      </a>
                      <span className="om-category-pill">{categoryLabel(row.category)}</span>
                    </div>
                    {row.element_context ? <div className="text-muted">{row.element_context}</div> : null}
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.message}</div>
                    {row.screenshot_url ? (
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(row.screenshot_url || null)}
                        style={{ border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={row.screenshot_url} alt="" style={{ width: 88, height: 88, objectFit: "cover", border: "1px solid var(--border)" }} />
                      </button>
                    ) : null}

                    <div className="row" style={{ gap: "var(--space-8)", alignItems: "baseline", flexWrap: "nowrap" }}>
                      <select
                        className="om-filter-control"
                        value={row.status}
                        onChange={async (e) => {
                          const next = e.target.value as FeedbackStatus;
                          setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, status: next } : x)));
                          try {
                            await patchRow(row.id, { status: next });
                          } catch {
                            void load();
                          }
                        }}
                      >
                        {STATUSES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      value={notesDraft[row.id] ?? ""}
                      onChange={(e) => setNotesDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      onBlur={async () => {
                        const value = String(notesDraft[row.id] ?? "");
                        if (value === String(row.admin_notes ?? "")) return;
                        setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, admin_notes: value } : x)));
                        try {
                          await patchRow(row.id, { admin_notes: value });
                        } catch {
                          void load();
                        }
                      }}
                      placeholder="Admin notes"
                      style={{ width: "100%" }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {lightboxUrl ? (
        <button
          type="button"
          onClick={() => setLightboxUrl(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.84)",
            border: "none",
            padding: 0,
            margin: 0,
            zIndex: 3000,
            cursor: "zoom-out"
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="" style={{ maxWidth: "92vw", maxHeight: "92vh", objectFit: "contain" }} />
        </button>
      ) : null}
    </div>
  );
}
