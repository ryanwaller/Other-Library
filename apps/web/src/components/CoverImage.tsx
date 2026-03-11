"use client";

import { useState, useRef, useEffect, type CSSProperties } from "react";

export type CoverCrop = {
  // Legacy fields (react-easy-crop)
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cropX?: number;
  cropY?: number;
  
  // New fields (transform-based)
  mode?: "transform";
  
  // Shared
  zoom: number; // For mode="transform", this is 1.0 (fit) to 4.0
  rotation: number;
  brightness: number;
  contrast: number;
};

export default function CoverImage({
  src,
  cropData,
  alt,
  style,
  className,
  objectFit = "cover"
}: {
  src: string | null;
  cropData: CoverCrop | null | undefined;
  alt: string;
  style?: CSSProperties;
  className?: string;
  objectFit?: "cover" | "contain";
}) {

  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const imgRef = useRef<HTMLImageElement>(null);
  const slotClassName = [className, src && status !== "error" ? "om-cover-slot-has-image" : null].filter(Boolean).join(" ");

  if (!src || status === "error") {
    return (
      <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center" }} className={className}>
        <div className="om-cover-placeholder" style={{ width: "100%", aspectRatio: "3/4" }} />
      </div>
    );
  }

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth < 10 && img.naturalHeight < 10) {
      setStatus("error");
      return;
    }
    
    if (cropData?.mode === "transform" && objectFit === "contain") {
      // Contain mode with saved transform: apply width-fit scale + pan/rotate
      // This matches CoverEditor's rendering (baseScale = cw/nw, so zoom=1 = natural width)
      img.style.width = "100%";
      img.style.height = "auto";
      img.style.transformOrigin = "center";
      const tx = (cropData.x || 0) * img.naturalWidth;
      const ty = (cropData.y || 0) * img.naturalHeight;
      img.style.transform = `translate(${tx}px, ${ty}px) rotate(${cropData.rotation || 0}deg) scale(${cropData.zoom || 1})`;
      img.style.filter = `brightness(${cropData.brightness ?? 1}) contrast(${cropData.contrast ?? 1})`;
    } else if (objectFit === "cover" && cropData?.mode === "transform") {
      const container = img.parentElement?.parentElement;
      if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (!nw || !nh || !cw || !ch) return;
        
        const isRotated = (cropData.rotation / 90) % 2 !== 0;
        const effectiveNw = isRotated ? nh : nw;
        const effectiveNh = isRotated ? nw : nh;

        const scaleW = cw / effectiveNw;
        const scaleH = ch / effectiveNh;
        const baseScale = Math.max(scaleW, scaleH);
        
        // cropData.zoom is now a multiplier (e.g. 1.0 = fit-to-fill, 1.2 = 20% zoom)
        const currentScale = baseScale * (cropData.zoom || 1);
        
        // x and y are ratios relative to natural image dimensions (-0.5 to 0.5)
        const tx = (cropData.x || 0) * nw;
        const ty = (cropData.y || 0) * nh;
        
        // Apply transform: translate in natural pixels, then scale
        img.style.transform = `translate(${tx}px, ${ty}px) rotate(${cropData.rotation || 0}deg) scale(${currentScale})`;
        img.style.transformOrigin = "center";
        img.style.objectFit = "cover";
      }
    } else {
      // Natural mode: width 100%, height auto. 
      // Apply filters and rotation if they exist.
      img.style.width = "100%";
      img.style.height = "auto";
      img.style.transform = cropData?.rotation ? `rotate(${cropData.rotation}deg)` : "none";
      img.style.filter = `brightness(${cropData?.brightness ?? 1}) contrast(${cropData?.contrast ?? 1})`;
    }
    
    setStatus("ok");
  };

  const handleError = () => {
    setStatus("error");
  };

  // If the image loaded from cache before React hydrated, onLoad already fired
  // and was missed. Check img.complete after mount to catch this race.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || status !== "loading") return;
    if (img.complete) {
      if (img.naturalWidth >= 10) {
        handleLoad({ currentTarget: img } as React.SyntheticEvent<HTMLImageElement>);
      } else {
        setStatus("error");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isNatural = objectFit === "contain";

  return (
    <div 
      className={slotClassName} 
      style={{ 
        ...style, 
        position: "relative", 
        overflow: "hidden",
        height: isNatural ? "auto" : (style?.height ?? "100%")
      }}
    >
      <div style={{ 
        position: isNatural ? "relative" : "absolute", 
        top: 0, left: 0, width: "100%", 
        height: isNatural ? "auto" : "100%", 
        display: "flex", alignItems: "center", justifyContent: "center" 
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          alt={alt}
          src={src}
          onLoad={handleLoad}
          onError={handleError}
          style={{
            width: "100%",
            height: isNatural ? "auto" : "100%",
            objectFit: isNatural ? "contain" : "cover",
            display: status === "ok" ? "block" : "none"
          }}
        />
        {status === "loading" && <div className="om-cover-placeholder" style={{ width: "100%", aspectRatio: "3/4" }} />}
      </div>
    </div>
  );
}
