"use client";

import { useRef, useEffect, useLayoutEffect, useState, useCallback } from "react";

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

  // Track the current callback to avoid dependency cycles
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Internal state for dragging
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  // Dimensions
  const [dims, setDims] = useState({ cw: 0, ch: 0, iw: 0, ih: 0, minZoom: 0 });

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

      const isRotated = (rotation / 90) % 2 !== 0;
      const effectiveNw = isRotated ? nh : nw;
      const effectiveNh = isRotated ? nw : nh;

      const scaleW = cw / effectiveNw;
      const scaleH = ch / effectiveNh;
      const minZoom = Math.max(scaleW, scaleH);

      setDims({ cw, ch, iw: nw, ih: nh, minZoom });
      if (onLoad) onLoad({ minZoom });

      // Only force update if uninitialized or critically invalid
      if (zoom <= 0.01 || zoom < minZoom) {
        onChangeRef.current({ zoom: minZoom, x: 0, y: 0 });
      }
    };

    updateDims();
    const obs = new ResizeObserver(updateDims);
    obs.observe(containerRef.current);
    
    const img = imgRef.current;
    if (img.complete) updateDims();
    else img.onload = updateDims;

    return () => obs.disconnect();
  }, [src, aspectRatio, rotation, onLoad]); // zoom is NOT a dependency here to avoid loops

  // Clamping helper
  const getClampedPos = useCallback((nx: number, ny: number, nz: number, d: typeof dims) => {
    if (!d.minZoom) return { x: nx, y: ny, zoom: nz };

    const isRotated = (rotation / 90) % 2 !== 0;
    const rw = (isRotated ? d.ih : d.iw) * nz;
    const rh = (isRotated ? d.iw : d.ih) * nz;

    const maxX = Math.max(0, (rw - d.cw) / 2);
    const maxY = Math.max(0, (rh - d.ch) / 2);

    return {
      x: Math.min(maxX, Math.max(-maxX, nx)),
      y: Math.min(maxY, Math.max(-maxY, ny)),
      zoom: nz
    };
  }, [rotation]);

  // Effect-based clamping (handles slider changes)
  useEffect(() => {
    if (!dims.minZoom || isDragging) return;

    const clamped = getClampedPos(x, y, zoom, dims);
    if (clamped.x !== x || clamped.y !== y || clamped.zoom !== zoom) {
      onChangeRef.current(clamped);
    }
  }, [x, y, zoom, dims, isDragging, getClampedPos]);

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
    
    // We clamp during drag for immediate feedback
    const clamped = getClampedPos(startPos.x + dx, startPos.y + dy, zoom, dims);
    onChangeRef.current({ x: clamped.x, y: clamped.y });
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
    // Note: preventDefault can cause issues on some mobile browsers if not passive:false
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

  const isRotated = (rotation / 90) % 2 !== 0;
  const currentScale = dims.minZoom ? zoom : 1;

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
              transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${currentScale})`,
              transformOrigin: "center",
              filter: `brightness(${brightness}) contrast(${contrast})`,
              willChange: "transform",
              pointerEvents: "none",
              maxWidth: "none",
              maxHeight: "none",
              display: dims.minZoom ? "block" : "none"
            }}
          />
        </div>
      </div>
    </div>
  );
}
