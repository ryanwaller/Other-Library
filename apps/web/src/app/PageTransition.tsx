"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    console.log("[PageTransition] pathname changed:", pathname);
  }, [pathname]);

  return (
    <div key={pathname} className="page-enter page-debug-flash">
      {children}
    </div>
  );
}
