"use client";

import { usePathname } from "next/navigation";

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} style={{ animation: "fadeIn 150ms ease-out" }}>
      {children}
    </div>
  );
}
