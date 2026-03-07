"use client";

import { useEffect, useMemo, useState } from "react";

type FeedbackStatus = "new" | "reviewing" | "resolved" | "wont_fix";
type FeedbackStatusAction = FeedbackStatus | "delete";
type FeedbackCategory = "bug" | "feels_wrong" | "feature_idea" | "spacing_issue" | "other";
type FeedbackDeviceType = "desktop" | "mobile" | "tablet" | "unknown";
export type FeedbackMetrics = Record<FeedbackStatus, number>;

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
  device_type?: FeedbackDeviceType | null;
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
  { key: "spacing_issue", label: "Spacing issue" },
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

function deviceLabel(deviceType: FeedbackRow["device_type"]): string {
  if (deviceType === "mobile") return "Mobile";
  if (deviceType === "tablet") return "Tablet";
  if (deviceType === "desktop") return "Desktop";
  return "Unknown";
}

function countMetrics(rows: FeedbackRow[]): FeedbackMetrics {
  return rows.reduce<FeedbackMetrics>(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { new: 0, reviewing: 0, resolved: 0, wont_fix: 0 }
  );
}

export default function AdminFeedbackBoard({
  token,
  refreshToken = 0,
  onMetricsChange
}: {
  token: string;
  refreshToken?: number;
  onMetricsChange?: (metrics: FeedbackMetrics) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | FeedbackStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | FeedbackCategory>("all");
  const [pageFilter, setPageFilter] = useState<string>("all");
  const [deviceFilter, setDeviceFilter] = useState<"all" | FeedbackDeviceType>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  async function loadMetrics() {
    if (!token) return;
    const params = new URLSearchParams();
    params.set("status", "all");
    params.set("category", "all");
    const res = await fetch(`/api/admin/feedback?${params.toString()}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String((json as any)?.error ?? "feedback_metrics_failed"));
    const data = Array.isArray((json as any)?.feedback) ? ((json as any).feedback as FeedbackRow[]) : [];
    onMetricsChange?.(countMetrics(data));
  }

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
      await loadMetrics();
    } catch (e: any) {
      setError(e?.message ?? "Failed to load feedback");
      setRows([]);
      onMetricsChange?.({ new: 0, reviewing: 0, resolved: 0, wont_fix: 0 });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, statusFilter, categoryFilter, refreshToken]);

  async function patchRow(id: string, patch: Partial<Pick<FeedbackRow, "status" | "admin_notes">>) {
    const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String((json as any)?.error ?? "feedback_patch_failed"));
  }

  async function deleteRow(id: string) {
    const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String((json as any)?.error ?? "feedback_delete_failed"));
  }

  const grouped = useMemo(() => {
    const rowsByPage = pageFilter === "all" ? rows : rows.filter((row) => String(row.page_title ?? "").trim() === pageFilter);
    const rowsByDevice = deviceFilter === "all" ? rowsByPage : rowsByPage.filter((row) => (row.device_type ?? "unknown") === deviceFilter);
    const map: Record<FeedbackStatus, FeedbackRow[]> = { new: [], reviewing: [], resolved: [], wont_fix: [] };
    for (const row of rowsByDevice) map[row.status].push(row);
    return map;
  }, [rows, pageFilter, deviceFilter]);
  const focusedRows = statusFilter === "all"
    ? (pageFilter === "all" ? rows : rows.filter((row) => String(row.page_title ?? "").trim() === pageFilter))
        .filter((row) => (deviceFilter === "all" ? true : (row.device_type ?? "unknown") === deviceFilter)
        )
    : grouped[statusFilter];
  const pageOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      const title = String(row.page_title ?? "").trim();
      if (title) set.add(title);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  return (
    <div style={{ marginTop: "var(--space-lg)", width: isMobile ? "100%" : "calc(100vw - 48px)", marginLeft: isMobile ? 0 : "calc(50% - 50vw + 24px)" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--space-8)", flexWrap: "wrap" }}>
        <div className="row" style={{ gap: "var(--space-8)", alignItems: "center", flexWrap: "wrap" }}>
          <select className="om-filter-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ width: 180 }}>
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <select className="om-filter-control" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as any)} style={{ width: 180 }}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select className="om-filter-control" value={pageFilter} onChange={(e) => setPageFilter(e.target.value)} style={{ width: 200 }}>
            <option value="all">All pages</option>
            {pageOptions.map((page) => (
              <option key={page} value={page}>
                {page}
              </option>
            ))}
          </select>
          <select className="om-filter-control" value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value as "all" | FeedbackDeviceType)} style={{ width: 170 }}>
            <option value="all">All devices</option>
            <option value="desktop">Desktop</option>
            <option value="mobile">Mobile</option>
            <option value="tablet">Tablet</option>
            <option value="unknown">Unknown</option>
          </select>
          <button className="om-inline-link-muted" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
        </div>
        <span className="text-muted" style={{ marginLeft: "auto", whiteSpace: "nowrap", minWidth: 72, textAlign: "right" }}>
          {statusFilter === "all" ? `Total ${focusedRows.length}` : ""}
        </span>
      </div>

      {error ? (
        <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
          {error}
        </div>
      ) : null}

      <div style={{ marginTop: "var(--space-lg)", width: "100%", overflowX: isMobile ? "visible" : "auto" }}>
        <div style={{ minWidth: isMobile ? "100%" : 1320, position: "relative", paddingTop: 28 }}>
          <div className="row" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 24, justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ visibility: statusFilter === "all" ? "hidden" : "visible" }}>
              {STATUSES.find((s) => s.key === statusFilter)?.label ?? "Status"}
            </div>
            <span className="text-muted" style={{ whiteSpace: "nowrap", visibility: statusFilter === "all" ? "hidden" : "visible" }}>
              {String(focusedRows.length)}
            </span>
          </div>
        {statusFilter === "all" ? (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(300px, 1fr))", gap: "var(--space-md)" }}>
              {STATUSES.map((col) => (
                <div key={col.key} className="card om-feedback-card om-feedback-column" data-status={col.key} style={{ minHeight: isMobile ? "auto" : 220 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                    <div>{col.label}</div>
                    <span className="text-muted">{grouped[col.key].length}</span>
                  </div>
                  <div style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                    {grouped[col.key].map((row) => (
                      <div key={row.id} className="om-feedback-card" data-status={row.status} style={{ padding: "var(--space-sm)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
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

                        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--space-8)" }}>
                          <div className="row" style={{ gap: "var(--space-8)", alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                            <a href={row.page_url} target="_blank" rel="noreferrer" className="text-muted">
                              {row.page_title}
                            </a>
                            <span className="om-category-pill">{categoryLabel(row.category)}</span>
                          </div>
                          <span className="text-muted" style={{ whiteSpace: "nowrap", marginLeft: "auto" }}>
                            {deviceLabel(row.device_type)}
                          </span>
                        </div>
                        <div className="om-feedback-divider" style={{ marginTop: "var(--space-8)" }} />
                        {row.element_context ? <div className="text-muted">{row.element_context}</div> : null}
                        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.message}</div>
                        {row.screenshot_url ? (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(row.screenshot_url || null)}
                            style={{ border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer" }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={row.screenshot_url} alt="" className="om-feedback-thumb" style={{ width: 88, height: 88, objectFit: "cover" }} />
                          </button>
                        ) : null}

                        <div className="om-feedback-divider" style={{ marginTop: "var(--space-8)" }} />
                        <input
                          value={notesDraft[row.id] ?? ""}
                          onChange={(e) => setNotesDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          onBlur={async () => {
                            const value = String(notesDraft[row.id] ?? "");
                            if (value === String(row.admin_notes ?? "")) return;
                            setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, admin_notes: value } : x)));
                            try {
                              await patchRow(row.id, { admin_notes: value });
                              await loadMetrics();
                            } catch {
                              void load();
                            }
                          }}
                          placeholder="Admin notes"
                          style={{ width: "100%", marginTop: "var(--space-8)", border: "none", borderBottom: "none", boxShadow: "none", background: "transparent", paddingLeft: 0, paddingRight: 0 }}
                        />
                        <select
                          className="om-filter-control"
                          value={row.status}
                          onChange={async (e) => {
                            const next = e.target.value as FeedbackStatusAction;
                            if (next === "delete") {
                              const ok = window.confirm("Delete this report?");
                              if (!ok) return;
                              const prev = rows;
                              setRows((curr) => curr.filter((x) => x.id !== row.id));
                              try {
                                await deleteRow(row.id);
                                await loadMetrics();
                              } catch {
                                setRows(prev);
                                void load();
                              }
                              return;
                            }
                            setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, status: next } : x)));
                            try {
                              await patchRow(row.id, { status: next });
                              await loadMetrics();
                            } catch {
                              void load();
                            }
                          }}
                          style={{ width: "100%" }}
                        >
                          {STATUSES.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                          <option value="delete">Delete</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
        ) : (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(300px, 1fr))", gap: "var(--space-md)" }}>
            {focusedRows.map((row) => (
              <div key={row.id} className="om-feedback-card" data-status={row.status} style={{ padding: "var(--space-sm)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
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

                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--space-8)" }}>
                  <div className="row" style={{ gap: "var(--space-8)", alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                    <a href={row.page_url} target="_blank" rel="noreferrer" className="text-muted">
                      {row.page_title}
                    </a>
                    <span className="om-category-pill">{categoryLabel(row.category)}</span>
                  </div>
                  <span className="text-muted" style={{ whiteSpace: "nowrap", marginLeft: "auto" }}>
                    {deviceLabel(row.device_type)}
                  </span>
                </div>
                <div className="om-feedback-divider" style={{ marginTop: "var(--space-8)" }} />
                {row.element_context ? <div className="text-muted">{row.element_context}</div> : null}
                <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.message}</div>
                {row.screenshot_url ? (
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(row.screenshot_url || null)}
                    style={{ border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={row.screenshot_url} alt="" className="om-feedback-thumb" style={{ width: 88, height: 88, objectFit: "cover" }} />
                  </button>
                ) : null}

                <div className="om-feedback-divider" style={{ marginTop: "var(--space-8)" }} />
                <input
                  value={notesDraft[row.id] ?? ""}
                  onChange={(e) => setNotesDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  onBlur={async () => {
                    const value = String(notesDraft[row.id] ?? "");
                    if (value === String(row.admin_notes ?? "")) return;
                    setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, admin_notes: value } : x)));
                    try {
                      await patchRow(row.id, { admin_notes: value });
                      await loadMetrics();
                    } catch {
                      void load();
                    }
                  }}
                  placeholder="Admin notes"
                  style={{ width: "100%", marginTop: "var(--space-8)", border: "none", borderBottom: "none", boxShadow: "none", background: "transparent", paddingLeft: 0, paddingRight: 0 }}
                />
                <select
                  className="om-filter-control"
                  value={row.status}
                  onChange={async (e) => {
                    const next = e.target.value as FeedbackStatusAction;
                    if (next === "delete") {
                      const ok = window.confirm("Delete this report?");
                      if (!ok) return;
                      const prev = rows;
                      setRows((curr) => curr.filter((x) => x.id !== row.id));
                      try {
                        await deleteRow(row.id);
                        await loadMetrics();
                      } catch {
                        setRows(prev);
                        void load();
                      }
                      return;
                    }
                    setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, status: next } : x)));
                    try {
                      await patchRow(row.id, { status: next });
                      await loadMetrics();
                    } catch {
                      void load();
                    }
                  }}
                  style={{ width: "100%" }}
                >
                  {STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                  <option value="delete">Delete</option>
                </select>
              </div>
            ))}
            </div>
        )}
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
