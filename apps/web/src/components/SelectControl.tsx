"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Option = { value: string; label: string };

export default function SelectControl({
  value,
  onChange,
  options,
  className = "om-filter-control"
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  function openPanel() {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const panelHeight = options.length * 40 + 8;
    const above = spaceBelow < panelHeight && rect.top > panelHeight;
    setPanelStyle({
      position: "fixed",
      left: rect.left,
      width: Math.max(rect.width, 120),
      zIndex: 10000,
      ...(above
        ? { bottom: window.innerHeight - rect.top }
        : { top: rect.bottom + 2 })
    });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        className={`${className}${open ? " is-open" : ""}`}
        onClick={() => (open ? setOpen(false) : openPanel())}
        style={{ cursor: "pointer", userSelect: "none" }}
        type="button"
      >
        <span style={{ flex: 1, textAlign: "left" }}>{selected?.label ?? value}</span>
        <svg
          className="om-filter-caret"
          viewBox="0 0 10 6"
          style={{ flexShrink: 0, marginLeft: 8 }}
        >
          <path d="M0 0h10L5 6z" fill="currentColor" fillOpacity={0.5} />
        </svg>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              style={{
                ...panelStyle,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "4px 0",
                boxShadow: "0 4px 16px rgba(0,0,0,0.25)"
              }}
            >
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 14px",
                    background: opt.value === value ? "rgba(128,128,128,0.12)" : "transparent",
                    color: "var(--fg)",
                    border: 0,
                    cursor: "pointer",
                    fontFamily: "var(--font-family)",
                    fontSize: "var(--text-size-1)",
                    lineHeight: "var(--text-line)"
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
