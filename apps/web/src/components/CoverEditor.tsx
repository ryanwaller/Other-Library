"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import CustomSlider from "./CustomSlider";

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
  initialState?: Partial<EditorState> | null;
  aspectRatio: number; // width / height
  onChange: (state: EditorState) => void;
  style?: React.CSSProperties;
  className?: string;
};

export default function CoverEditor({ src, initialState, aspectRatio, onChange, style, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Editor state
  // Zoom: 1.0 = fit to container (min), 4.0 = max
  const [zoom, setZoom] = useState(initialState?.zoom ?? 1);
  const [x, setX] = useState(initialState?.x ?? 0);
  const [y, setY] = useState(initialState?.y ?? 0);
  const [rotation, setRotation] = useState(initialState?.rotation ?? 0);
  const [brightness, setBrightness] = useState(initialState?.brightness ?? 1);
  const [contrast, setContrast] = useState(initialState?.contrast ?? 1);

  // Internal state for dragging
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  // Dimensions
  const [dims, setDims] = useState({ cw: 0, ch: 0, iw: 0, ih: 0, baseScale: 1 });

  // Update parent on change
  useEffect(() => {
    onChange({ x, y, zoom, rotation, brightness, contrast });
  }, [x, y, zoom, rotation, brightness, contrast, onChange]);

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

      // Calculate base scale (cover)
      const scaleW = cw / nw;
      const scaleH = ch / nh;
      const baseScale = Math.max(scaleW, scaleH);

      setDims({ cw, ch, iw: nw, ih: nh, baseScale });
    };

    updateDims();
    const obs = new ResizeObserver(updateDims);
    obs.observe(containerRef.current);
    
    // Also listen to image load
    const img = imgRef.current;
    if (img.complete) updateDims();
    else img.onload = updateDims;

    return () => obs.disconnect();
  }, [src, aspectRatio]);

  // Clamp position to keep image covering the container
  useEffect(() => {
    if (!dims.baseScale) return;
    
    // Current rendered dimensions
    const currentScale = dims.baseScale * zoom;
    const rw = dims.iw * currentScale;
    const rh = dims.ih * currentScale;

    // Max offset (positive)
    const maxX = Math.max(0, (rw - dims.cw) / 2);
    const maxY = Math.max(0, (rh - dims.ch) / 2);

    let nextX = x;
    let nextY = y;
    let clamped = false;

    if (nextX > maxX) { nextX = maxX; clamped = true; }
    if (nextX < -maxX) { nextX = -maxX; clamped = true; }
    if (nextY > maxY) { nextY = maxY; clamped = true; }
    if (nextY < -maxY) { nextY = -maxY; clamped = true; }

    if (clamped) {
      setX(nextX);
      setY(nextY);
    }
  }, [zoom, dims, aspectRatio, x, y]); // Depend on x,y to catch updates but logic should stabilize

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
    setX(startPos.x + dx);
    setY(startPos.y + dy);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Mouse
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

  // Touch
  const onTouchStart = (e: React.TouchEvent) => {
    e.preventDefault(); // Prevent scroll
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
    <div className={className} style={style}>
      {/* Viewport */}
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
              pointerEvents: "none", // Let container handle events
              maxWidth: "none", // Allow scaling beyond container
              maxHeight: "none"
            }}
          />
        </div>
      </div>

      {/* Controls */}
      <div style={{ marginTop: 12 }}>
        <div className="row no-wrap" style={{ marginTop: 8, alignItems: "center" }}>
          <div className="muted" style={{ minWidth: 110 }}>Zoom</div>
          <CustomSlider
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={setZoom}
            style={{ flex: "1 1 auto" }}
          />
        </div>
        <div className="row no-wrap" style={{ marginTop: 8, alignItems: "center" }}>
          <div className="muted" style={{ minWidth: 110 }}>Rotate</div>
          <CustomSlider
            min={-180}
            max={180}
            step={1}
            value={rotation}
            onChange={setRotation}
            style={{ flex: "1 1 auto" }}
          />
        </div>
        <div className="row no-wrap" style={{ marginTop: 8, alignItems: "center" }}>
          <div className="muted" style={{ minWidth: 110 }}>Bright</div>
          <CustomSlider
            min={0.5}
            max={1.5}
            step={0.01}
            value={brightness}
            onChange={setBrightness}
            style={{ flex: "1 1 auto" }}
          />
        </div>
        <div className="row no-wrap" style={{ marginTop: 8, alignItems: "center" }}>
          <div className="muted" style={{ minWidth: 110 }}>Contrast</div>
          <CustomSlider
            min={0.5}
            max={1.5}
            step={0.01}
            value={contrast}
            onChange={setContrast}
            style={{ flex: "1 1 auto" }}
          />
        </div>
      </div>
    </div>
  );
}
