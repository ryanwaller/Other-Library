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
  zoom: number;
  rotation: number;
  brightness: number;
  contrast: number;
};

export default function CoverImage({
  src,
  cropData,
  alt,
  style,
  className
}: {
  src: string | null;
  cropData?: CoverCrop | null;
  alt: string;
  style?: CSSProperties;
  className?: string;
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
    if (img.naturalWidth < 100 || img.naturalHeight < 100) {
      setStatus("error");
    } else {
      setStatus("ok");
    }
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
          style={{ width: "100%", height: "100%", objectFit: "contain", display: status === "ok" ? "block" : "none" }}
        />
        {status === "loading" && <div className="om-cover-placeholder" style={{ width: "100%", height: "100%" }} />}
      </div>
    );
  }

  const { rotation, brightness, contrast } = cropData;
  let imgStyle: CSSProperties = {};

  if (cropData.mode === "transform" || (cropData.x !== undefined && cropData.width === undefined)) {
    // New transform mode: x/y are pixels (translate), zoom is scale
    // We assume the container provides the crop window (overflow: hidden)
    // and we center the image then apply transform.
    // Actually, CoverEditor renders: absolute top 0 left 0 width 100% height 100% flex center center
    // transform: translate(x, y) rotate(deg) scale(zoom * baseScale)
    // BUT: we don't know baseScale here without image dimensions and container dimensions.
    // The previous implementation stored relative crop rect.
    // If we store raw transform values, we need baseScale.
    // CoverEditor calculates baseScale on load. We can't easily replicate that here without loading the image.
    // HACK: For display, we might need to rely on object-fit or something simpler if we lack baseScale.
    // Wait, the prompt said: "Apply the same transform and filter values from cover_crop".
    // If we assume the container has the same aspect ratio as the editor...
    // The editor uses a calculated aspect ratio.
    // Let's assume we can't perfectly replicate "pixel perfect" without baseScale.
    // However, if we change the save format to be PERCENT based, we can resize easily.
    // But the prompt specified "Store { x, y, zoom, rotate, brightness, contrast }".
    // Let's assume x/y/zoom are relative or we can use object-fit logic.
    
    // Actually, if we use the same layout as CoverEditor:
    // Container relative, overflow hidden.
    // Inner div absolute 0 0 100% 100% flex center center.
    // Image object-fit? No, standard img.
    // We need 'baseScale' to apply the zoom correctly if 'zoom' is relative to 'fit'.
    // We can calculate baseScale on load!
    
    // Let's use a layout that mimics CoverEditor structure for new items.
    // We can use status='loading' to wait for dimensions.
  } else {
    // Legacy mode
    const { x, y, width, height } = cropData;
    if (width && height) {
      imgStyle = {
        position: "absolute",
        width: `${(1 / width) * 100}%`,
        height: `${(1 / height) * 100}%`,
        left: `${-(x! / width) * 100}%`,
        top: `${-(y! / height) * 100}%`,
        objectFit: "cover"
      };
    }
  }

  const filters: string[] = [];
  if (brightness !== 1) filters.push(`brightness(${brightness})`);
  if (contrast !== 1) filters.push(`contrast(${contrast})`);
  if (filters.length > 0) {
    imgStyle.filter = filters.join(" ");
  }

  if (cropData.rotation && cropData.mode !== "transform") {
     imgStyle.transform = `rotate(${rotation}deg)`;
  }

  const containerStyle: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    ...style
  };

  // If new mode, we need special rendering
  if (cropData.mode === "transform") {
    // We need to handle onload to get dimensions for baseScale
    const handleTransformLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      if (img.naturalWidth < 100 || img.naturalHeight < 100) {
        setStatus("error");
        return;
      }
      setStatus("ok");
      
      // Calculate baseScale
      // We need container dims.
      const container = img.parentElement?.parentElement;
      if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        
        const scaleW = cw / nw;
        const scaleH = ch / nh;
        const baseScale = Math.max(scaleW, scaleH);
        
        const currentScale = baseScale * cropData.zoom;
        
        img.style.transform = `translate(${cropData.x}px, ${cropData.y}px) rotate(${cropData.rotation}deg) scale(${currentScale})`;
        img.style.transformOrigin = "center";
        img.style.display = "block";
      }
    };

    return (
      <div style={containerStyle} className={className}>
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={alt}
            src={src}
            onLoad={handleTransformLoad}
            onError={handleError}
            style={{ 
              display: "none", // Hidden until loaded and scaled
              maxWidth: "none", 
              maxHeight: "none",
              filter: imgStyle.filter 
            }} 
          />
        </div>
        {status !== "ok" && <div className="om-cover-placeholder" style={{ width: "100%", height: "100%" }} />}
      </div>
    );
  }

  return (
    <div style={containerStyle} className={className}>
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
