"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

export default function PublicBookAccessFallback({
  username,
  bookId
}: {
  username: string;
  bookId: number;
}) {
  const router = useRouter();
  const [resolved, setResolved] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) {
        if (!alive) return;
        setResolved(true);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      const hasSession = Boolean(data.session?.user?.id);
      setSignedIn(hasSession);
      setResolved(true);
      if (hasSession) {
        router.replace(`/app/books/${bookId}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookId, router]);

  return (
    <main className="container">
      <div className="card">
        <div>
          <Link href={`/u/${username}`}>@{username}</Link>
        </div>
        <div className="text-muted" style={{ marginTop: "var(--space-8)" }}>
          {!resolved ? "Checking access…" : signedIn ? "Opening item…" : "Book not found (or private)."}
        </div>
      </div>
    </main>
  );
}
