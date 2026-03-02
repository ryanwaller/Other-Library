"use client";

import { useState, type CSSProperties } from "react";

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

  if (!src || status === "error") {
    return (
      <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center" }} className={className}>
        <div className="om-cover-placeholder" style={{ height: "100%", width: "auto" }} />
      </div>
    );
  }

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth < 10 && img.naturalHeight < 10) {
      setStatus("error");
      return;
    }
    
    if (cropData?.mode === "transform") {
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
        const baseScale = objectFit === "cover" ? Math.max(scaleW, scaleH) : Math.min(scaleW, scaleH);
        
        // cropData.zoom is now a multiplier (e.g. 1.0 = fit-to-fill, 1.2 = 20% zoom)
        const currentScale = baseScale * (cropData.zoom || 1);
        
        // x and y are ratios relative to natural image dimensions (-0.5 to 0.5)
        const tx = (cropData.x || 0) * nw;
        const ty = (cropData.y || 0) * nh;
        
        // Apply transform: translate in natural pixels, then scale
        img.style.transform = `translate(${tx}px, ${ty}px) rotate(${cropData.rotation || 0}deg) scale(${currentScale})`;
        img.style.transformOrigin = "center";
        img.style.objectFit = objectFit;
      }
    }
    
    setStatus("ok");
  };

  const handleError = () => {
    setStatus("error");
  };

  if (!cropData) {
    return (
      <div style={style} className={className}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={alt}
          src={src}
          onLoad={handleLoad}
          onError={handleError}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: status === "ok" ? "block" : "none" }}
        />
        {status === "loading" && <div className="om-cover-placeholder" style={{ width: "100%", height: "100%" }} />}
      </div>
    );
  }

  const { rotation, brightness, contrast } = cropData;
  let imgStyle: CSSProperties = {
    filter: `brightness(${brightness ?? 1}) contrast(${contrast ?? 1})`
  };

  if (cropData.mode === "transform") {
    // Hidden until handleLoad applies the correct transform
    imgStyle.display = status === "ok" ? "block" : "none";
    imgStyle.maxWidth = "none";
    imgStyle.maxHeight = "none";
    
    return (
      <div style={{ ...style, position: "relative", overflow: "hidden" }} className={className}>
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={alt}
            src={src}
            onLoad={handleLoad}
            onError={handleError}
            style={imgStyle}
          />
        </div>
        {status !== "ok" && <div className="om-cover-placeholder" style={{ width: "100%", height: "100%" }} />}
      </div>
    );
  }

  // Legacy mode
  const { x, y, width, height } = cropData;
  if (width && height) {
    imgStyle = {
      ...imgStyle,
      position: "absolute",
      width: `${(1 / width) * 100}%`,
      height: `${(1 / height) * 100}%`,
      left: `${-(x! / width) * 100}%`,
      top: `${-(y! / height) * 100}%`,
      objectFit: "cover"
    };
  }
  if (rotation) {
    imgStyle.transform = `rotate(${rotation}deg)`;
  }

  return (
    <div style={{ ...style, position: "relative", overflow: "hidden" }} className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt}
        src={src}
        onLoad={handleLoad}
        onError={handleError}
        style={{ ...imgStyle, display: status === "ok" ? "block" : "none" }}
      />
      {status === "loading" && <div className="om-cover-placeholder" style={{ width: "100%", height: "100%" }} />}
    </div>
  );
}
