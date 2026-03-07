import { Suspense } from "react";
import type { Metadata } from "next";
import DiscoverClient from "./DiscoverClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Search"
};

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <main className="container">
          <div className="card">
            <div className="text-muted">Loading…</div>
          </div>
        </main>
      }
    >
      <DiscoverClient />
    </Suspense>
  );
}
