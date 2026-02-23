import { Suspense } from "react";
import DiscoverClient from "./DiscoverClient";

export const dynamic = "force-dynamic";

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <main className="container">
          <div className="card">
            <div className="muted">Loading…</div>
          </div>
        </main>
      }
    >
      <DiscoverClient />
    </Suspense>
  );
}

