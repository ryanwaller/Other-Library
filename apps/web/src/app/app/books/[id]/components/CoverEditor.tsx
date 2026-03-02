"use client";

import { useRef, useEffect, useLayoutEffect, useState, useCallback } from "react";

export type EditorState = {
  // Store these as ratios: x/y in 0-1 range (offset from center / natural dimension)
  // zoom as multiplier (1.0 = fit-to-fill)
  x: number; 
  y: number; 
  zoom: number; // 1.0 to 4.0 (multiplier of the 'fit' scale)
  rotation: number;
  brightness: number;
  contrast: number;
};

type Props = {
  src: string;
  state: EditorState;
  aspectRatio: number; // The target crop ratio (W/H)
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
  const [dims, setDims] = useState({ 
    cw: 0, ch: 0, // Container (viewport) dims
    bw: 0, bh: 0, // Box (crop area) dims
    iw: 0, ih: 0, // Image natural dims
    baseScale: 0 
  });

  // Calculate crop box and baseScale
  useLayoutEffect(() => {
    if (!imgRef.current) return;
    
    const updateDims = () => {
      if (!containerRef.current || !imgRef.current) return;
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight;
      
      const nw = imgRef.current.naturalWidth;
      const nh = imgRef.current.naturalHeight;
      if (!nw || !nh) return;

      // Outer viewport is 2:3 fixed in BookDetailPage (usually).
      // We calculate the inner crop box (bw, bh) based on target aspectRatio.
      const viewportRatio = cw / ch;
      let bw, bh;
      if (aspectRatio > viewportRatio) {
        bw = cw;
        bh = bw / aspectRatio;
      } else {
        bh = ch;
        bw = bh * aspectRatio;
      }

      const isRotated = (rotation / 90) % 2 !== 0;
      const effectiveNw = isRotated ? nh : nw;
      const effectiveNh = isRotated ? nw : nh;

      // baseScale: zoom=1 means image at natural width (matches CoverImage contain/natural display)
      const baseScale = cw / effectiveNw;

      setDims({ cw, ch, bw, bh, iw: nw, ih: nh, baseScale });
      if (onLoad) onLoad({ minZoom: 1 }); // Relative zoom min is now 1.0
    };

    updateDims();
    const obs = new ResizeObserver(updateDims);
    obs.observe(containerRef.current!);
    
    const img = imgRef.current;
    if (img.complete) updateDims();
    else img.onload = updateDims;

    return () => obs.disconnect();
  }, [src, aspectRatio, rotation, onLoad]);

  // Clamping helper (relative coordinates)
  const getClampedPos = useCallback((nx: number, ny: number, nz: number, d: typeof dims) => {
    if (!d.baseScale) return { x: nx, y: ny, zoom: nz };

    // nz is the zoom multiplier (e.g. 1.2 for 120% zoom)
    const currentZoom = Math.max(1, nz);
    const currentScale = d.baseScale * currentZoom;
    
    const isRotated = (rotation / 90) % 2 !== 0;
    const rw = (isRotated ? d.ih : d.iw); // natural width
    const rh = (isRotated ? d.iw : d.ih); // natural height

    // Max translation in natural image pixels
    const maxX = Math.max(0, (rw - d.bw / currentScale) / 2);
    const maxY = Math.max(0, (rh - d.bh / currentScale) / 2);

    // Natural pixel offsets
    const px = nx * d.iw;
    const py = ny * d.ih;
    
    // Clamp in natural pixel space
    const clampedPx = Math.min(maxX, Math.max(-maxX, px));
    const clampedPy = Math.min(maxY, Math.max(-maxY, py));

    return {
      x: clampedPx / d.iw,
      y: clampedPy / d.ih,
      zoom: Math.max(1, Math.min(4, nz))
    };
  }, [rotation]);

  // Effect-based clamping (handles slider changes)
  useEffect(() => {
    if (!dims.baseScale || isDragging) return;

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
    
    // dx/dy are screen pixels. 
    // currentScale = baseScale * zoom
    // translate(x_natural, y_natural) scale(currentScale) means visual offset = x_natural * currentScale.
    // So x_natural = dx / (baseScale * zoom).
    // dx_ratio = x_natural / nw = dx / (baseScale * zoom * nw).
    const currentScale = dims.baseScale * zoom;
    const dx_ratio = dx / (currentScale * dims.iw);
    const dy_ratio = dy / (currentScale * dims.ih);

    const clamped = getClampedPos(startPos.x + dx_ratio, startPos.y + dy_ratio, zoom, dims);
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

  const currentScale = dims.baseScale * zoom;

  return (
    <div className={className} style={{ ...style, position: "relative", overflow: "hidden" }}>
      <div 
        ref={containerRef}
        style={{ 
          width: "100%", 
          height: "100%",
          position: "relative", 
          overflow: "hidden", 
          background: "#000", 
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
              transform: `translate(${x * dims.iw}px, ${y * dims.ih}px) rotate(${rotation}deg) scale(${currentScale})`,
              transformOrigin: "center",
              filter: `brightness(${brightness}) contrast(${contrast})`,
              willChange: "transform",
              pointerEvents: "none",
              maxWidth: "none",
              maxHeight: "none",
              display: dims.baseScale ? "block" : "none"
            }}
          />
        </div>

        {/* Dimmed overlays for areas outside the crop box */}
        {dims.baseScale > 0 && (
          <div style={{ pointerEvents: "none", position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: Math.max(0, (dims.ch - dims.bh) / 2), background: "rgba(0,0,0,0.5)" }} />
            <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: Math.max(0, (dims.ch - dims.bh) / 2), background: "rgba(0,0,0,0.5)" }} />
            <div style={{ position: "absolute", top: (dims.ch - dims.bh) / 2, left: 0, width: Math.max(0, (dims.cw - dims.bw) / 2), height: dims.bh, background: "rgba(0,0,0,0.5)" }} />
            <div style={{ position: "absolute", top: (dims.ch - dims.bh) / 2, right: 0, width: Math.max(0, (dims.cw - dims.bw) / 2), height: dims.bh, background: "rgba(0,0,0,0.5)" }} />
            <div style={{ 
              position: "absolute", 
              top: (dims.ch - dims.bh) / 2, 
              left: (dims.cw - dims.bw) / 2, 
              width: dims.bw, 
              height: dims.bh, 
              border: "1px solid rgba(255,255,255,0.3)" 
            }} />
          </div>
        )}
      </div>
    </div>
  );
}
