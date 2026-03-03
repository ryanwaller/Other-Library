"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    // Reset to 0 then fade in
    setOpacity(0);
    const raf = requestAnimationFrame(() => {
      setOpacity(1);
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname]);

  return (
    <div 
      style={{ 
        opacity, 
        transition: "opacity 150ms ease-out"
      }}
    >
      {children}
    </div>
  );
}
