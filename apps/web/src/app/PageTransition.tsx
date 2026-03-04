"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [entering, setEntering] = useState<{ pathname: string; node: ReactNode }>({ pathname, node: children });
  const [exiting, setExiting] = useState<{ key: number; node: ReactNode } | null>(null);
  const exitKeyRef = useRef(0);

  useEffect(() => {
    setEntering((prev) => {
      if (prev.pathname === pathname) return prev;
      exitKeyRef.current += 1;
      setExiting({ key: exitKeyRef.current, node: prev.node });
      return { pathname, node: children };
    });
  }, [pathname, children]);

  useEffect(() => {
    if (!exiting) return;
    const timeout = window.setTimeout(() => setExiting(null), 800);
    return () => window.clearTimeout(timeout);
  }, [exiting]);

  useEffect(() => {
    setEntering((prev) => (prev.pathname === pathname ? { ...prev, node: children } : prev));
  }, [children, pathname]);

  return (
    <div className="page-transition-root">
      {exiting ? (
        <div key={`exit-${exiting.key}`} className="page-exit" aria-hidden="true">
          {exiting.node}
        </div>
      ) : null}
      <div key={pathname} className="page-enter">
        {entering.node}
      </div>
    </div>
  );
}
