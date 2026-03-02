"use client";

import { useState } from "react";
import Link from "next/link";

export function ExpandableSubjects({ subjects, username }: { subjects: string[]; username: string }) {
  const [expanded, setExpanded] = useState(false);
  const limit = 15;
  const visible = expanded ? subjects : subjects.slice(0, limit);
  const hasMore = subjects.length > limit;
  return (
    <>
      <div>
        {visible.map((s, idx) => (
          <span key={s}>
            <Link href={`/u/${username}/s/${encodeURIComponent(s)}`}>{s}</Link>
            {idx < visible.length - 1 ? <span>, </span> : null}
          </span>
        ))}
        {!expanded && hasMore ? " …" : ""}
      </div>
      {hasMore && (
        <div className="row" style={{ marginTop: 12, justifyContent: "center" }}>
          <button onClick={() => setExpanded((v) => !v)} className="muted">
            {expanded ? "See less" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}

export function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const words = text.trim().split(/\s+/);
  const limit = 100;
  const hasMore = words.length > limit;
  return (
    <>
      <div style={{ whiteSpace: "pre-wrap" }}>
        {expanded ? text : words.slice(0, limit).join(" ") + (hasMore ? "…" : "")}
      </div>
      {hasMore && (
        <div className="row" style={{ marginTop: 12, justifyContent: "center" }}>
          <button onClick={() => setExpanded((v) => !v)} className="muted">
            {expanded ? "See less" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
