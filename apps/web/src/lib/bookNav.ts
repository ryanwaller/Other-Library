"use client";

export type BookNavContext = {
  bookIds: number[];
  libraryId: number;
  source: string;
  ts: number;
};

const BOOK_NAV_CONTEXT_KEY = "om_book_nav_context_v1";

export function saveBookNavContext(context: BookNavContext) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(BOOK_NAV_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // ignore storage failures
  }
}

export function loadBookNavContext(): BookNavContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(BOOK_NAV_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookNavContext;
    if (!parsed || !Array.isArray(parsed.bookIds) || !Number.isFinite(Number(parsed.libraryId))) return null;
    const bookIds = parsed.bookIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
    if (bookIds.length === 0) return null;
    return {
      bookIds,
      libraryId: Number(parsed.libraryId),
      source: String(parsed.source ?? "unknown"),
      ts: Number(parsed.ts ?? Date.now())
    };
  } catch {
    return null;
  }
}
