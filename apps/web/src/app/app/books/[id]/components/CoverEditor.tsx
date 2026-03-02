"use client";

import { useRef, useEffect, useLayoutEffect, useState } from "react";

export type EditorState = {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  brightness: number;
  contrast: number;
};

type Props = {
  src: string;
  state: EditorState;
  aspectRatio: number; // width / height
  onChange: (state: Partial<EditorState>) => void;
  onLoad?: (info: { minZoom: number }) => void;
  style?: React.CSSProperties;
  className?: string;
};

export default function CoverEditor({ src, state, aspectRatio, onChange, onLoad, style, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const { x, y, zoom, rotation, brightness, contrast } = state;

  // Internal state for dragging
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  // Dimensions
  const [dims, setDims] = useState({ cw: 0, ch: 0, iw: 0, ih: 0, minZoom: 1 });

  // Initialize dimensions
  useLayoutEffect(() => {
    if (!containerRef.current || !imgRef.current) return;
    const updateDims = () => {
      if (!containerRef.current || !imgRef.current) return;
      const cw = containerRef.current.clientWidth;
      const ch = cw / aspectRatio;
      
      const nw = imgRef.current.naturalWidth;
      const nh = imgRef.current.naturalHeight;
      if (!nw || !nh) return;

      // Calculate minZoom (cover scale)
      // Account for rotation swaps
      const isRotated = (rotation / 90) % 2 !== 0;
      const effectiveNw = isRotated ? nh : nw;
      const effectiveNh = isRotated ? nw : nh;

      const scaleW = cw / effectiveNw;
      const scaleH = ch / effectiveNh;
      const minZoom = Math.max(scaleW, scaleH);

      setDims({ cw, ch, iw: nw, ih: nh, minZoom });
      if (onLoad) onLoad({ minZoom });

      // If current zoom is 1 (uninitialized) or below minZoom, reset to minZoom and center
      if (zoom <= 1 || zoom < minZoom) {
        onChange({ zoom: minZoom, x: 0, y: 0 });
      }
    };

    updateDims();
    const obs = new ResizeObserver(updateDims);
    obs.observe(containerRef.current);
    
    const img = imgRef.current;
    if (img.complete) updateDims();
    else img.onload = updateDims;

    return () => obs.disconnect();
  }, [src, aspectRatio, rotation, onLoad]); // Recalculate on rotation as well

  // Clamp position and zoom
  useEffect(() => {
    if (!dims.minZoom) return;
    
    let nextZoom = zoom;
    let nextX = x;
    let nextY = y;
    let changed = false;

    // 1. Clamp Zoom
    const maxZoom = dims.minZoom * 4;
    if (nextZoom < dims.minZoom) {
      nextZoom = dims.minZoom;
      changed = true;
    } else if (nextZoom > maxZoom) {
      nextZoom = maxZoom;
      changed = true;
    }

    // 2. Clamp Translation
    const isRotated = (rotation / 90) % 2 !== 0;
    const rw = (isRotated ? dims.ih : dims.iw) * nextZoom;
    const rh = (isRotated ? dims.iw : dims.ih) * nextZoom;

    // Max offset from center (positive)
    const maxX = Math.max(0, (rw - dims.cw) / 2);
    const maxY = Math.max(0, (rh - dims.ch) / 2);

    if (nextX > maxX) { nextX = maxX; changed = true; }
    if (nextX < -maxX) { nextX = -maxX; changed = true; }
    if (nextY > maxY) { nextY = maxY; changed = true; }
    if (nextY < -maxY) { nextY = -maxY; changed = true; }

    if (changed) {
      onChange({ zoom: nextZoom, x: nextX, y: nextY });
    }
  }, [zoom, x, y, rotation, dims, onChange]);

  // Drag handlers
  const handleDragStart = (cx: number, cy: number) => {
    setIsDragging(true);
    setDragStart({ x: cx, y: cy });
    setStartPos({ x, y });
  };

  const handleDragMove = (cx: number, cy: number) => {
    if (!isDragging) return;
    const dx = cx - dragStart.x;
    const dy = cy - dragStart.y;
    onChange({ x: startPos.x + dx, y: startPos.y + dy });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
    const move = (ev: MouseEvent) => handleDragMove(ev.clientX, ev.clientY);
    const up = () => {
      handleDragEnd();
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const t = e.touches[0]!;
    handleDragStart(t.clientX, t.clientY);
    const move = (ev: TouchEvent) => {
      const t = ev.touches[0]!;
      handleDragMove(t.clientX, t.clientY);
    };
    const up = () => {
      handleDragEnd();
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  };

  return (
    <div className={className} style={style}>
      <div 
        ref={containerRef}
        style={{ 
          width: "100%", 
          paddingBottom: `${(1 / aspectRatio) * 100}%`, 
          position: "relative", 
          overflow: "hidden", 
          background: "#111", 
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none"
        }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
      >
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt="Cover edit"
            style={{
              transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${zoom})`,
              transformOrigin: "center",
              filter: `brightness(${brightness}) contrast(${contrast})`,
              willChange: "transform",
              pointerEvents: "none",
              maxWidth: "none",
              maxHeight: "none"
            }}
          />
        </div>
      </div>
    </div>
  );
}
