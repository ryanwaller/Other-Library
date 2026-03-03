"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onResult: (query: string) => void;
}

function isbn10to13(isbn10: string): string | null {
  if (!/^\d{9}[\dX]$/.test(isbn10)) return null;
  const digits = isbn10.slice(0, 9);
  const prefix = "978" + digits;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(prefix[i]!, 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return prefix + check;
}

function extractIsbns(text: string): string[] {
  // Match runs of digits/hyphens/spaces long enough to contain a 10 or 13 digit number
  const candidates: string[] = [];
  const matches = text.match(/[\d][\d\s\-]{8,}[\d]/g) ?? [];
  for (const m of matches) {
    const digits = m.replace(/\D/g, "");
    if (digits.length === 13 && (digits.startsWith("978") || digits.startsWith("979"))) {
      candidates.push(digits);
    } else if (digits.length === 10) {
      const isbn13 = isbn10to13(digits);
      if (isbn13) candidates.push(isbn13);
    }
  }
  return candidates;
}

function extractTitleLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 8 && /[a-zA-Z]{4,}/.test(l))
    .slice(0, 3);
}

// Colors forced for the dark camera background (always black regardless of system theme)
const FG = "#e8e8ea";   // matches --fg dark
const MUTED = "#a8a8ad"; // matches --muted dark

/** Capture a downscaled JPEG frame from the video element, returned as raw base64. */
function captureScaledFrame(video: HTMLVideoElement, maxDim = 640): string {
  const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  tmp.getContext("2d")!.drawImage(video, 0, 0, w, h);
  // strip "data:image/jpeg;base64," prefix
  return tmp.toDataURL("image/jpeg", 0.8).split(",")[1]!;
}

export default function BookScannerModal({ open, onClose, onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const firedRef = useRef(false);

  const [status, setStatus] = useState("Starting camera…");
  const [camError, setCamError] = useState<string | null>(null);
  const [titleSuggestion, setTitleSuggestion] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);

  const handleResult = useCallback(
    (query: string) => {
      if (firedRef.current) return;
      firedRef.current = true;
      activeRef.current = false;
      onResult(query);
      onClose();
    },
    [onResult, onClose]
  );

  const handleBarcode = useCallback(
    (raw: string): boolean => {
      const digits = raw.replace(/\D/g, "");
      if (digits.length === 13 && (digits.startsWith("978") || digits.startsWith("979"))) {
        handleResult(digits);
        return true;
      }
      if (digits.length >= 8) {
        setStatus("Not a book barcode. Try again.");
      }
      return false;
    },
    [handleResult]
  );

  useEffect(() => {
    if (!open) {
      activeRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return;
    }

    activeRef.current = true;
    firedRef.current = false;
    setStatus("Starting camera…");
    setCamError(null);
    setTitleSuggestion(null);
    setShowHint(false);

    let rafId: number;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tesseractWorker: any = null;

    function cleanup() {
      activeRef.current = false;
      cancelAnimationFrame(rafId);
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
      tesseractWorker?.terminate().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (!activeRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        video.play().catch(() => {});
        setStatus("Point at barcode or cover");

        const hasBarcodeDetector = "BarcodeDetector" in window;
        let detector: { detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } | null = null;
        let zxingReader: { decodeFromCanvas: (canvas: HTMLCanvasElement) => { getText: () => string } } | null = null;

        // Layer 1: barcode scanning loop (every frame)
        const scanFrame = async () => {
          if (!activeRef.current) return;
          const canvas = canvasRef.current!;
          if (video.readyState >= 2 && video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(video, 0, 0);

            try {
              if (detector) {
                const codes = await detector.detect(video);
                for (const code of codes) {
                  if (handleBarcode(code.rawValue)) return;
                }
              } else if (zxingReader) {
                try {
                  const result = zxingReader.decodeFromCanvas(canvas);
                  if (result && handleBarcode(result.getText())) return;
                } catch {
                  // NotFoundException — no barcode in frame
                }
              }
            } catch {
              // detection error, keep going
            }
          }
          if (activeRef.current) rafId = requestAnimationFrame(scanFrame);
        };

        if (hasBarcodeDetector) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          detector = new (window as any).BarcodeDetector({ formats: ["ean_13", "ean_8"] });
          rafId = requestAnimationFrame(scanFrame);
        } else {
          import("@zxing/browser")
            .then((m) => {
              if (!activeRef.current) return;
              zxingReader = new m.BrowserMultiFormatReader() as typeof zxingReader;
              rafId = requestAnimationFrame(scanFrame);
            })
            .catch(() => {
              // ZXing unavailable — run loop anyway (will just do nothing without detector)
              rafId = requestAnimationFrame(scanFrame);
            });
        }

        // Start loading Tesseract immediately so it's ready by the time OCR phases begin
        const tesseractLoadPromise = import("tesseract.js")
          .then(async (m) => {
            if (!activeRef.current) return null;
            const worker = await m.createWorker(["eng"]);
            if (!activeRef.current) {
              worker.terminate().catch(() => {});
              return null;
            }
            tesseractWorker = worker;
            return worker;
          })
          .catch(() => null);

        // Layer 1.5: Google Vision WEB_DETECTION — start after 2 s, every 4 s
        timers.push(
          setTimeout(() => {
            if (!activeRef.current) return;
            const id = setInterval(async () => {
              if (!activeRef.current) { clearInterval(id); return; }
              const vid = videoRef.current;
              if (!vid || !vid.videoWidth) return;
              try {
                const image = captureScaledFrame(vid);
                const res = await fetch("/api/vision-scan", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ image }),
                });
                if (!res.ok || !activeRef.current) return;
                const data = await res.json() as { ok: boolean; isbn?: string; query?: string; confidence?: number };
                if (!data.ok || !activeRef.current) return;
                if (data.isbn) {
                  clearInterval(id);
                  handleResult(data.isbn);
                } else if (data.query && !firedRef.current) {
                  setTitleSuggestion((prev) => prev ?? data.query!);
                }
              } catch { /* network error, ignore */ }
            }, 4000);
            intervals.push(id);
          }, 2000)
        );

        // Layer 2: OCR ISBN text — start after 3 s
        timers.push(
          setTimeout(async () => {
            if (!activeRef.current) return;
            const worker = await tesseractLoadPromise;
            if (!worker || !activeRef.current) return;

            const id = setInterval(async () => {
              if (!activeRef.current) { clearInterval(id); return; }
              const canvas = canvasRef.current;
              if (!canvas || !video.videoWidth) return;
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              canvas.getContext("2d")!.drawImage(video, 0, 0);
              try {
                const { data: { text } } = await worker.recognize(canvas);
                const isbns = extractIsbns(text);
                if (isbns.length > 0) {
                  clearInterval(id);
                  handleResult(isbns[0]!);
                }
              } catch { /* ignore */ }
            }, 2000);
            intervals.push(id);
          }, 3000)
        );

        // Layer 3: OCR title/author text — start after 6 s
        timers.push(
          setTimeout(async () => {
            if (!activeRef.current) return;
            const worker = await tesseractLoadPromise;
            if (!worker || !activeRef.current) return;

            const id = setInterval(async () => {
              if (!activeRef.current) { clearInterval(id); return; }
              const canvas = canvasRef.current;
              if (!canvas || !video.videoWidth) return;
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              canvas.getContext("2d")!.drawImage(video, 0, 0);
              try {
                const { data: { text } } = await worker.recognize(canvas);
                const lines = extractTitleLines(text);
                if (lines.length > 0 && !titleSuggestion) {
                  setTitleSuggestion(lines[0]!);
                }
              } catch { /* ignore */ }
            }, 2000);
            intervals.push(id);
          }, 6000)
        );

        // Hint after 10 s
        timers.push(
          setTimeout(() => {
            if (activeRef.current && !firedRef.current) setShowHint(true);
          }, 10000)
        );
      })
      .catch(() => {
        setCamError("Camera unavailable — type instead.");
      });

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Camera feed */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />

      {/* Hidden canvas for OCR / ZXing frame capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Header bar — gradient fade, status + close */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 2,
          padding: "16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
        }}
      >
        <span style={{ color: camError ? MUTED : FG }}>
          {camError ?? status}
        </span>
        <button onClick={onClose} style={{ color: FG }}>
          Cancel
        </button>
      </div>

      {/* Title suggestion prompt (Layer 3) */}
      {titleSuggestion && !firedRef.current && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 3,
            padding: "52px 16px 16px",
            background: "linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)",
          }}
        >
          <div style={{ color: FG }}>
            Found: <em>&ldquo;{titleSuggestion}&rdquo;</em> — search this?
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 12 }}>
            <button onClick={() => handleResult(titleSuggestion)} style={{ color: FG }}>
              Yes
            </button>
            <button onClick={() => setTitleSuggestion(null)} style={{ color: MUTED }}>
              Try again
            </button>
          </div>
        </div>
      )}

      {/* 10-second hint */}
      {showHint && !titleSuggestion && !firedRef.current && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 3,
            padding: "16px 16px 32px",
            background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
            textAlign: "center",
          }}
        >
          <div style={{ color: MUTED }}>Try better light or move closer</div>
          <div style={{ marginTop: 6 }}>
            <button onClick={onClose} style={{ color: MUTED }}>
              Type instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
