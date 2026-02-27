"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type Suggestion = { id: string; name: string; slug: string; uses?: number };

function normalizeTokenName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed;
}

export default function EntityTokenField(props: {
  role: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  maxSuggestions?: number;
}) {
  const { role, value, onChange, placeholder, disabled, maxSuggestions = 8 } = props;
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const blurTimerRef = useRef<number | null>(null);

  const normalizedValue = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of value ?? []) {
      const n = normalizeTokenName(String(v ?? ""));
      if (!n) continue;
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out;
  }, [value]);

  useEffect(() => {
    onChange(normalizedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) {
        setSuggestions([]);
        return;
      }
      const q = normalizeTokenName(draft);
      if (!q) {
        setSuggestions([]);
        return;
      }
      const res = await supabase.rpc("search_entities", { p_role: role, p_q: q, p_limit: maxSuggestions });
      if (!alive) return;
      if (res.error) {
        setSuggestions([]);
        return;
      }
      const rows = (res.data ?? []) as any[];
      const next = rows
        .map((r) => ({ id: String(r.id), name: String(r.name), slug: String(r.slug), uses: Number(r.uses ?? 0) }))
        .filter((r) => r.name && r.slug);
      setSuggestions(next);
    })();
    return () => {
      alive = false;
    };
  }, [draft, role, maxSuggestions]);

  function addToken(raw: string) {
    const name = normalizeTokenName(raw);
    if (!name) return;
    const key = name.toLowerCase();
    if (normalizedValue.some((v) => v.toLowerCase() === key)) return;
    onChange([...normalizedValue, name]);
  }

  function removeToken(name: string) {
    const key = normalizeTokenName(name).toLowerCase();
    onChange(normalizedValue.filter((v) => v.toLowerCase() !== key));
  }

  function commitDraftAsToken() {
    const parts = draft
      .split(",")
      .map((p) => normalizeTokenName(p))
      .filter(Boolean);
    if (parts.length === 0) return;
    let next = normalizedValue.slice();
    for (const p of parts) {
      const key = p.toLowerCase();
      if (!next.some((v) => v.toLowerCase() === key)) next.push(p);
    }
    onChange(next);
    setDraft("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraftAsToken();
      return;
    }
    if (e.key === ",") {
      e.preventDefault();
      commitDraftAsToken();
      return;
    }
    if (e.key === "Backspace" && !draft) {
      const last = normalizedValue[normalizedValue.length - 1];
      if (last) removeToken(last);
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function scheduleClose() {
    if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
    blurTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }

  function cancelClose() {
    if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
    blurTimerRef.current = null;
  }

  return (
    <div className="om-token-field" onFocus={cancelClose} onBlur={scheduleClose}>
      <div className="om-token-row">
        {normalizedValue.map((t, idx) => (
          <span key={t} className="om-token">
            <span className="om-token-text">{t}</span>
            <button type="button" className="om-token-x" onClick={() => removeToken(t)} aria-label={`Remove ${t}`} disabled={disabled}>
              ×
            </button>
            {idx < normalizedValue.length - 1 ? ", " : " "}
          </span>
        ))}
        <input
          className="om-token-input"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>

      {open && suggestions.length > 0 ? (
        <div className="om-token-suggestions" role="listbox" aria-label="Suggestions">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="om-token-suggestion"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                addToken(s.name);
                setDraft("");
                setOpen(false);
              }}
              disabled={disabled}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
