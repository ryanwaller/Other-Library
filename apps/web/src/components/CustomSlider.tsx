"use client";

import { useRef, type CSSProperties, type MouseEvent, type TouchEvent } from "react";

export default function CustomSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  style
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (val: number) => void;
  style?: CSSProperties;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pos = (clientX - rect.left) / rect.width;
    const raw = min + pos * (max - min);
    const clamped = Math.min(max, Math.max(min, raw));
    const stepped = Math.round(clamped / step) * step;
    onChange(Number(stepped.toFixed(4)));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    handleMove(e.clientX);
    const move = (me: MouseEvent) => handleMove(me.clientX);
    const up = () => {
      window.removeEventListener("mousemove", move as any);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move as any);
    window.addEventListener("mouseup", up);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    handleMove(e.touches[0]!.clientX);
    const move = (te: TouchEvent) => handleMove(te.touches[0]!.clientX);
    const up = () => {
      window.removeEventListener("touchmove", move as any);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("touchmove", move as any, { passive: false });
    window.addEventListener("touchend", up);
  };

  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return (
    <div
      ref={trackRef}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      style={{
        height: 24,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        position: "relative",
        userSelect: "none",
        touchAction: "none",
        ...style
      }}
    >
      <div style={{ height: 1, width: "100%", background: "var(--border)", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: `${percent}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "var(--fg)",
            border: "none",
            boxShadow: "none"
          }}
        />
      </div>
    </div>
  );
}
