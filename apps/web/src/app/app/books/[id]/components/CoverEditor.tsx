"use client";

import { useRef, useEffect, useLayoutEffect, useState, useCallback } from "react";

export type EditorState = {
  // Store these as absolute values: x/y in natural image pixels, zoom as absolute CSS scale.
  x: number; 
  y: number; 
  zoom: number; // Absolute CSS scale factor (e.g. 0.25)
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

      // baseScale is the scale needed to cover the container slot (cw, ch)
      const scaleW = cw / effectiveNw;
      const scaleH = ch / effectiveNh;
      const baseScale = Math.max(scaleW, scaleH);

      setDims({ cw, ch, bw, bh, iw: nw, ih: nh, baseScale });
      if (onLoad) onLoad({ minZoom: baseScale });
    };

    updateDims();
    const obs = new ResizeObserver(updateDims);
    obs.observe(containerRef.current!);
    
    const img = imgRef.current;
    if (img.complete) updateDims();
    else img.onload = updateDims;

    return () => obs.disconnect();
  }, [src, aspectRatio, rotation, onLoad]);

  // Clamping helper (absolute coordinates)
  const getClampedPos = useCallback((nx: number, ny: number, nz: number, d: typeof dims) => {
    if (!d.baseScale) return { x: nx, y: ny, zoom: nz };

    // nz is the absolute CSS scale. Clamp to fill (baseScale).
    const currentScale = Math.max(d.baseScale, nz);
    
    const isRotated = (rotation / 90) % 2 !== 0;
    const rw = (isRotated ? d.ih : d.iw); // natural width
    const rh = (isRotated ? d.iw : d.ih); // natural height

    // Max translation in natural image pixels
    // (naturalWidth * scale - cropBoxWidth) / 2 = maxScreenOffset
    // maxNaturalOffset = maxScreenOffset / scale
    const maxX = Math.max(0, (rw - d.bw / currentScale) / 2);
    const maxY = Math.max(0, (rh - d.bh / currentScale) / 2);

    return {
      x: Math.min(maxX, Math.max(-maxX, nx)),
      y: Math.min(maxY, Math.max(-maxY, ny)),
      zoom: Math.max(d.baseScale, Math.min(d.baseScale * 4, nz))
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
    
    // dx/dy are screen pixels. zoom is absolute CSS scale factor.
    // translate(x, y) scale(s) means x is in natural pixels.
    // To move dx screen pixels, we move dx / currentScale natural pixels.
    const clamped = getClampedPos(startPos.x + dx / zoom, startPos.y + dy / zoom, zoom, dims);
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

  const currentScale = Math.max(dims.baseScale, zoom);

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
              transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${currentScale})`,
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
