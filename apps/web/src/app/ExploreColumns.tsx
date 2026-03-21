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

  useEffect(() => {
    const container = containerRef.current;
    const mainEl = mainRef.current;
    const railEl = railRef.current;
    if (!container || !mainEl || !railEl) return;

    let raf = 0;

    const update = () => {
      raf = 0;
      const isDesktop = window.matchMedia("(min-width: 901px)").matches;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!isDesktop || reduceMotion) {
        mainEl.style.transform = "";
        railEl.style.transform = "";
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

      const mainOffset = (maxHeight - mainHeight) * eased;
      const railOffset = (maxHeight - railHeight) * eased;

      mainEl.style.transform = `translate3d(0, ${mainOffset.toFixed(2)}px, 0)`;
      railEl.style.transform = `translate3d(0, ${railOffset.toFixed(2)}px, 0)`;
    };

    const requestUpdate = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
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
