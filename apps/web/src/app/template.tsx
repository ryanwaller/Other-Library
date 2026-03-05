"use client";

import { useEffect } from "react";

let hasRenderedOnce = false;

export default function Template({ children }: { children: React.ReactNode }) {
  const shouldAnimate = hasRenderedOnce;

  useEffect(() => {
    hasRenderedOnce = true;
  }, []);

  return <div className={shouldAnimate ? "page-transition" : undefined}>{children}</div>;
}
