import type { Metadata } from "next";
import ExploreAuthPanel from "../ExploreAuthPanel";

export const metadata: Metadata = {
  title: "Sign in"
};

export default function SignInPage() {
  return (
    <main className="container" style={{ paddingBottom: "var(--space-2xl)" }}>
      <ExploreAuthPanel open standalone />
    </main>
  );
}
