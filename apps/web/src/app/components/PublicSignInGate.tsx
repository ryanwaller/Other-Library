"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function PublicSignInGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [authResolved, setAuthResolved] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setAuthResolved(true);
      setSessionUserId(null);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSessionUserId(data.session?.user?.id ?? null);
      setAuthResolved(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUserId(session?.user?.id ?? null);
      setAuthResolved(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const locked = authResolved && !sessionUserId;
  const nextHref = useMemo(() => {
    const query = searchParams?.toString() ?? "";
    const target = `${pathname ?? "/"}${query ? `?${query}` : ""}`;
    return `/signin?next=${encodeURIComponent(target)}`;
  }, [pathname, searchParams]);

  return (
    <div className="om-public-signin-gate">
      <div className="om-public-signin-gate-content" data-locked={locked ? "true" : "false"}>
        {children}
      </div>
      {locked ? (
        <div className="om-public-signin-gate-overlay" aria-hidden="true">
          <Link href={nextHref} className="om-filter-control om-public-signin-gate-button" aria-label="Sign in to continue">
            Sign in
          </Link>
        </div>
      ) : null}
    </div>
  );
}
