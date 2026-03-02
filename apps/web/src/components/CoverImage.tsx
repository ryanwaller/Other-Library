import { useState, type CSSProperties } from "react";

export type CoverCrop = {
  // Display crop (ratios 0-1) — from react-easy-crop onCropComplete, divided by 100
  x: number;
  y: number;
  width: number;
  height: number;
  // Editor state for restoration
  zoom: number;
  cropX: number;
  cropY: number;
  rotation: number;
  // Adjustments
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
    return <div style={style} className={`${className || ""} om-cover-placeholder`.trim()} />;
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

  const { x, y, width, height, rotation, brightness, contrast } = cropData;

  const imgStyle: CSSProperties = {
    position: "absolute",
    width: `${(1 / width) * 100}%`,
    height: `${(1 / height) * 100}%`,
    left: `${-(x / width) * 100}%`,
    top: `${-(y / height) * 100}%`,
    objectFit: "cover"
  };

  if (rotation !== 0) {
    imgStyle.transform = `rotate(${rotation}deg)`;
  }

  const filters: string[] = [];
  if (brightness !== 1) filters.push(`brightness(${brightness})`);
  if (contrast !== 1) filters.push(`contrast(${contrast})`);
  if (filters.length > 0) {
    imgStyle.filter = filters.join(" ");
  }

  const containerStyle: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    ...style
  };

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
