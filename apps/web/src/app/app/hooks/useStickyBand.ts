"use client";

import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";

/**
 * Encapsulates the scroll-driven sticky-band state and behavior shared between
 * the catalog home page and the book detail page.
 *
 * Keeping this state in a hook rather than inline in a 4000+ line component
 * means that the scroll listener and its setState calls live in the same
 * logical scope, but the returned values are the only things that cause
 * re-renders in the consuming component when scroll state changes.
 *
 * Callers are expected to:
 *  1. Attach `bandRef` to the sticky band's root div.
 *  2. Call `measureBand()` (via requestAnimationFrame) whenever the band's
 *     content changes height (e.g. when editMode or bulkMode toggles).
 */
export function useStickyBand({
  controlsPinnedOpen,
  isMobile,
}: {
  controlsPinnedOpen: boolean;
  isMobile: boolean;
}) {
  const [controlsDocked, setControlsDocked] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [controlsBandHeight, setControlsBandHeight] = useState(0);
  const [controlsBandFrame, setControlsBandFrame] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  const bandRef = useRef<HTMLDivElement | null>(null);
  const bandTopRef = useRef(0);
  const lastScrollYRef = useRef(0);
  const wasControlsPinnedOpenRef = useRef(false);

  const measureBand = useCallback(() => {
    if (typeof window === "undefined" || !bandRef.current) return;
    const rect = bandRef.current.getBoundingClientRect();
    const container = bandRef.current.closest(".container");
    if (container instanceof HTMLElement) {
      const containerRect = container.getBoundingClientRect();
      setControlsBandFrame({ left: containerRect.left, width: containerRect.width });
    } else {
      setControlsBandFrame({ left: rect.left, width: rect.width });
    }
    if (!controlsDocked) {
      bandTopRef.current = rect.top + window.scrollY;
    }
    setControlsBandHeight(rect.height);
  }, [controlsDocked]);

  const controlsBandFixedStyle = useMemo<CSSProperties | undefined>(() => {
    if (!controlsDocked || controlsBandFrame.width <= 0) return undefined;
    return {
      left: `${controlsBandFrame.left}px`,
      width: `${controlsBandFrame.width}px`,
    };
  }, [controlsDocked, controlsBandFrame.left, controlsBandFrame.width]);

  // Re-measure on window resize.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.requestAnimationFrame(measureBand);
    const handleResize = () => window.requestAnimationFrame(measureBand);
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", handleResize);
    };
  }, [measureBand]);

  // Scroll listener — updates docked/visible based on position and direction.
  useEffect(() => {
    if (typeof window === "undefined") return;
    lastScrollYRef.current = window.scrollY;
    let ticking = false;

    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const stickyStart = Math.max(bandTopRef.current - 8, 0);
      const lastY = lastScrollYRef.current;
      const isNearTop = y <= stickyStart;
      const scrollingDown = y > lastY + 2;
      const scrollingUp = y < lastY - 2;

      if (isNearTop) {
        setControlsDocked(false);
        setControlsVisible(true);
      } else if (isMobile) {
        setControlsDocked(true);
        setControlsVisible(true);
      } else {
        setControlsDocked(true);
        if (controlsPinnedOpen) {
          setControlsVisible(true);
        } else if (scrollingDown) {
          setControlsVisible(false);
        } else if (scrollingUp) {
          setControlsVisible(true);
        }
      }

      lastScrollYRef.current = y;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [controlsPinnedOpen, isMobile]);

  // Keep band visible when pinned state changes.
  useEffect(() => {
    const wasPinnedOpen = wasControlsPinnedOpenRef.current;
    if (controlsPinnedOpen) {
      setControlsVisible(true);
    } else if (wasPinnedOpen && controlsDocked) {
      setControlsVisible(true);
    }
    wasControlsPinnedOpenRef.current = controlsPinnedOpen;
  }, [controlsDocked, controlsPinnedOpen]);

  return {
    controlsDocked,
    controlsVisible,
    controlsBandHeight,
    /** Attach to the sticky band's root div. */
    controlsBandRef: bandRef,
    controlsBandFixedStyle,
    /**
     * Call via requestAnimationFrame whenever the band's content changes height
     * (e.g. when bulkMode, editMode, or sortOpen toggles).
     */
    measureControlsBand: measureBand,
  };
}
