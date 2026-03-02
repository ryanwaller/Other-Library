"use client";

import { useState, useEffect } from "react";

type ImageMedia = {
  id: number;
  storage_path: string;
};

type Props = {
  images: ImageMedia[];
  signedMap: Record<string, string>;
};

export default function PublicImageGrid({ images, signedMap }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const update = () => setIsNarrow(!!mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowLeft") setLightboxIndex(prev => (prev !== null && prev > 0 ? prev - 1 : images.length - 1));
      if (e.key === "ArrowRight") setLightboxIndex(prev => (prev !== null && prev < images.length - 1 ? prev + 1 : 0));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxIndex, images.length]);

  return (
    <>
      <div className="om-images-grid" style={{ marginTop: 10 }}>
        {images.map((m, idx) => {
          const url = signedMap[m.storage_path];
          return (
            <div key={m.id} onClick={() => setLightboxIndex(idx)} style={{ cursor: "pointer" }}>
              {url ? (
                <div className="om-cover-slot" style={{ width: "100%", height: isNarrow ? 140 : 180, padding: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" src={url} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                </div>
              ) : (
                <div className="om-cover-slot" style={{ width: "100%", height: isNarrow ? 140 : 180, padding: 0 }} />
              )}
            </div>
          );
        })}
      </div>

      {lightboxIndex !== null && images[lightboxIndex] && (
        <div 
          style={{ 
            position: "fixed", top: 0, left: 0, width: "100%", height: "100%", 
            background: "rgba(0,0,0,0.85)", zIndex: 2000, 
            display: "flex", alignItems: "center", justifyContent: "center"
          }}
          onClick={() => setLightboxIndex(null)}
        >
          <div 
            style={{ 
              position: "absolute", top: 24, right: 24, 
              color: "#fff", cursor: "pointer", 
              fontSize: 14, textDecoration: "underline" 
            }}
            onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
          >
            Close
          </div>

          {images.length > 1 && (
            <>
              <div 
                style={{ 
                  position: "absolute", left: 0, top: 0, bottom: 0, width: "25%", 
                  cursor: "pointer"
                }}
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setLightboxIndex(prev => (prev !== null && prev > 0 ? prev - 1 : images.length - 1));
                }}
              />
              <div 
                style={{ 
                  position: "absolute", right: 0, top: 0, bottom: 0, width: "25%", 
                  cursor: "pointer"
                }}
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setLightboxIndex(prev => (prev !== null && prev < images.length - 1 ? prev + 1 : 0));
                }}
              />
            </>
          )}

          <div 
            style={{ 
              position: "relative", width: "calc(100% - 64px)", height: "calc(100% - 64px)", 
              display: "flex", alignItems: "center", justifyContent: "center" 
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={signedMap[images[lightboxIndex]!.storage_path]} 
              alt="" 
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} 
            />
          </div>
        </div>
      )}
    </>
  );
}
