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

/**
 * Preprocess a video frame for OCR: scale to 800px max, convert to greyscale,
 * boost contrast (factor 1.5), then apply a 3×3 sharpening kernel.
 */
function preprocessForOcr(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const maxDim = 800;
  const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, w, h);

  // Greyscale + contrast boost
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    const c = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
    d[i] = d[i + 1] = d[i + 2] = c;
  }
  ctx.putImageData(imgData, 0, 0);

  // Sharpening kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0]
  const src = ctx.getImageData(0, 0, w, h).data;
  const dst = ctx.createImageData(w, h);
  const dd = dst.data;
  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        dd[idx] = src[idx]!;
        dd[idx + 1] = src[idx + 1]!;
        dd[idx + 2] = src[idx + 2]!;
        dd[idx + 3] = 255;
        continue;
      }
      let v = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          v += src[((y + ky) * w + (x + kx)) * 4]! * k[(ky + 1) * 3 + (kx + 1)]!;
        }
      }
      const cv = Math.min(255, Math.max(0, v));
      dd[idx] = dd[idx + 1] = dd[idx + 2] = cv;
      dd[idx + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
  return canvas;
}

/**
 * Extract a search query from Tesseract word-level output.
 * Only uses words with confidence ≥ 70 and length ≥ 4.
 * Requires at least 2 words and 8 total characters; strips garbage chars.
 */
function extractOcrQuery(words: Array<{ text: string; confidence: number }>): string | null {
  const clean = words
    .filter((w) => w.confidence >= 70 && w.text.length >= 4)
    .map((w) => w.text.replace(/[^a-zA-Z0-9 '\-]/g, "").trim())
    .filter((t) => t.length >= 4);
  if (clean.length < 2) return null;
  const result = clean.join(" ");
  return result.length >= 8 ? result : null;
}

// Colors forced for the dark camera background (always black regardless of system theme)
const FG = "#e8e8ea";   // matches --fg dark
const MUTED = "#a8a8ad"; // matches --muted dark

export default function BookScannerModal({ open, onClose, onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const firedRef = useRef(false);
  // Tracks consecutive identical OCR reads for 2-frame confirmation
  const lastOcrRef = useRef<{ text: string; count: number } | null>(null);

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
    lastOcrRef.current = null;
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

        // Layer 1: barcode scanning (every frame via rAF)
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
              // ZXing unavailable — run loop anyway
              rafId = requestAnimationFrame(scanFrame);
            });
        }

        // Load Tesseract in the background so it's ready when the OCR phase begins
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

        // Layer 2: OCR — starts after 8 s, runs every 2 s
        // Uses preprocessing + confidence gates + 2-frame confirmation
        timers.push(
          setTimeout(async () => {
            if (!activeRef.current) return;
            const worker = await tesseractLoadPromise;
            if (!worker || !activeRef.current) return;

            const id = setInterval(async () => {
              if (!activeRef.current) { clearInterval(id); return; }
              const processedCanvas = preprocessForOcr(video);
              if (!processedCanvas) return;

              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data } = await worker.recognize(processedCanvas) as any;

                // ISBN path — checksum validation is sufficient, fire immediately
                const isbns = extractIsbns((data.text as string | undefined) ?? "");
                if (isbns.length > 0) {
                  clearInterval(id);
                  handleResult(isbns[0]!);
                  return;
                }

                // Title/author path — confidence-filtered, requires 2 matching frames
                const query = extractOcrQuery((data.words as Array<{ text: string; confidence: number }> | undefined) ?? []);
                if (query) {
                  const normalized = query.toLowerCase().trim();
                  const last = lastOcrRef.current;
                  if (last && last.text === normalized) {
                    last.count++;
                    if (last.count >= 2 && !firedRef.current) {
                      clearInterval(id);
                      setTitleSuggestion(query);
                    }
                  } else {
                    lastOcrRef.current = { text: normalized, count: 1 };
                  }
                } else {
                  // This frame produced nothing useful — reset confirmation counter
                  lastOcrRef.current = null;
                }
              } catch { /* ignore */ }
            }, 2000);
            intervals.push(id);
          }, 8000)
        );

        // Hint after 15 s
        timers.push(
          setTimeout(() => {
            if (activeRef.current && !firedRef.current) setShowHint(true);
          }, 15000)
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

      {/* Hidden canvas for ZXing frame capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Header bar */}
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

      {/* OCR suggestion — shown after 2-frame confirmation */}
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
          <div style={{ marginTop: "var(--space-sm)", display: "flex", gap: "var(--space-md)" }}>
            <button onClick={() => handleResult(titleSuggestion)} style={{ color: FG }}>
              Yes
            </button>
            <button
              onClick={() => {
                setTitleSuggestion(null);
                lastOcrRef.current = null;
              }}
              style={{ color: MUTED }}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* 15-second hint */}
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
          <div style={{ color: MUTED }}>Try the barcode on the back cover</div>
          <div style={{ marginTop: "var(--space-sm)" }}>
            <button onClick={onClose} style={{ color: MUTED }}>
              Type instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
