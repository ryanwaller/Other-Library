"use client";

import { useEffect, useRef, type ReactNode } from "react";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ease(progress: number) {
  return progress * (2 - progress);
}

export default function ExploreColumns({
  main,
  rail,
}: {
  main: ReactNode;
  rail: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const currentMainOffsetRef = useRef(0);
  const currentRailOffsetRef = useRef(0);
  const targetMainOffsetRef = useRef(0);
  const targetRailOffsetRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    const mainEl = mainRef.current;
    const railEl = railRef.current;
    if (!container || !mainEl || !railEl) return;

    let raf = 0;
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktopQuery = window.matchMedia("(min-width: 901px)");

    const reset = () => {
      currentMainOffsetRef.current = 0;
      currentRailOffsetRef.current = 0;
      targetMainOffsetRef.current = 0;
      targetRailOffsetRef.current = 0;
      mainEl.style.transform = "";
      railEl.style.transform = "";
    };

    const animate = () => {
      const mainDelta = targetMainOffsetRef.current - currentMainOffsetRef.current;
      const railDelta = targetRailOffsetRef.current - currentRailOffsetRef.current;

      currentMainOffsetRef.current += mainDelta * 0.16;
      currentRailOffsetRef.current += railDelta * 0.16;

      if (Math.abs(mainDelta) < 0.12) currentMainOffsetRef.current = targetMainOffsetRef.current;
      if (Math.abs(railDelta) < 0.12) currentRailOffsetRef.current = targetRailOffsetRef.current;

      mainEl.style.transform = `translate3d(0, ${currentMainOffsetRef.current.toFixed(2)}px, 0)`;
      railEl.style.transform = `translate3d(0, ${currentRailOffsetRef.current.toFixed(2)}px, 0)`;

      if (
        currentMainOffsetRef.current !== targetMainOffsetRef.current ||
        currentRailOffsetRef.current !== targetRailOffsetRef.current
      ) {
        raf = window.requestAnimationFrame(animate);
      } else {
        raf = 0;
      }
    };

    const measure = () => {
      const isDesktop = window.matchMedia("(min-width: 901px)").matches;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!isDesktop || reduceMotion) {
        reset();
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const scrollRange = Math.max(1, container.offsetHeight - viewportHeight);
      const progress = clamp((-containerRect.top) / scrollRange, 0, 1);
      const eased = ease(progress);

      const mainHeight = mainEl.offsetHeight;
      const railHeight = railEl.offsetHeight;
      const maxHeight = Math.max(mainHeight, railHeight);

      targetMainOffsetRef.current = (maxHeight - mainHeight) * eased;
      targetRailOffsetRef.current = (maxHeight - railHeight) * eased;
    };

    const requestUpdate = () => {
      measure();
      if (!raf) raf = window.requestAnimationFrame(animate);
    };

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => requestUpdate())
      : null;
    resizeObserver?.observe(container);
    resizeObserver?.observe(mainEl);
    resizeObserver?.observe(railEl);

    measure();
    animate();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    desktopQuery.addEventListener("change", requestUpdate);
    reduceMotionQuery.addEventListener("change", requestUpdate);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      desktopQuery.removeEventListener("change", requestUpdate);
      reduceMotionQuery.removeEventListener("change", requestUpdate);
    };
  }, []);

  return (
    <div ref={containerRef} className="om-explore-layout">
      <div className="om-explore-main">
        <div ref={mainRef} className="om-explore-scroll-inner">
          {main}
        </div>
      </div>

      <div className="om-explore-divider" aria-hidden="true" />

      <aside className="om-explore-rail">
        <div ref={railRef} className="om-explore-scroll-inner">
          {rail}
        </div>
      </aside>
    </div>
  );
}
