"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function PublicSignInGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [authState, setAuthState] = useState<"checking" | "locked" | "unlocked">("checking");

  useEffect(() => {
    if (!supabase) {
      setAuthState("locked");
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setAuthState(data.session?.user?.id ? "unlocked" : "locked");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthState(session?.user?.id ? "unlocked" : "locked");
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const nextHref = useMemo(() => {
    const query = searchParams?.toString() ?? "";
    const target = `${pathname ?? "/"}${query ? `?${query}` : ""}`;
    return `/signin?next=${encodeURIComponent(target)}`;
  }, [pathname, searchParams]);

  return (
    <div className="om-public-signin-gate" data-state={authState}>
      <div className="om-public-signin-gate-content">
        {children}
      </div>
      <div className="om-public-signin-gate-overlay" aria-hidden={authState === "unlocked" ? "true" : "false"}>
        {authState === "locked" ? (
          <Link href={nextHref} className="om-filter-control om-public-signin-gate-button" aria-label="Sign in to continue">
            Sign in
          </Link>
        ) : null}
      </div>
    </div>
  );
}
