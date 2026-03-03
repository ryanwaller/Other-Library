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
      {/* Header bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 2,
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)",
        }}
      >
        <span style={{ color: "#fff", fontSize: "0.9em" }}>
          {camError ?? status}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            fontSize: "1.3em",
            cursor: "pointer",
            padding: "4px 8px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Camera feed */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />

      {/* Hidden canvas for OCR / ZXing frame capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Scan guide */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -55%)",
          width: "72%",
          height: 100,
          border: "2px solid rgba(255,255,255,0.55)",
          borderRadius: 6,
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Title suggestion prompt (Layer 3) */}
      {titleSuggestion && !firedRef.current && (
        <div
          style={{
            position: "absolute",
            top: 60,
            left: 16,
            right: 16,
            zIndex: 3,
            background: "rgba(0,0,0,0.88)",
            borderRadius: 8,
            padding: "14px 16px",
          }}
        >
          <div style={{ color: "#fff", marginBottom: 10, fontSize: "0.9em" }}>
            Found: <em>&ldquo;{titleSuggestion}&rdquo;</em> — search this?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handleResult(titleSuggestion)}>Yes</button>
            <button className="muted" onClick={() => setTitleSuggestion(null)}>
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
            bottom: 48,
            left: 16,
            right: 16,
            zIndex: 3,
            background: "rgba(0,0,0,0.75)",
            borderRadius: 8,
            padding: "12px 16px",
            textAlign: "center",
          }}
        >
          <div style={{ color: "#ccc", marginBottom: 10, fontSize: "0.9em" }}>
            Try better light or move closer
          </div>
          <button className="muted" onClick={onClose} style={{ color: "#aaa" }}>
            Type instead
          </button>
        </div>
      )}
    </div>
  );
}
