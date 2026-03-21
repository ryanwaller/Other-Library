import type { Metadata } from "next";
import ExploreAuthPanel from "../ExploreAuthPanel";

export const metadata: Metadata = {
  title: "Sign in"
};

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = String(params?.next ?? "").trim() || "/app";

  return (
    <main className="container" style={{ paddingBottom: "var(--space-2xl)" }}>
      <ExploreAuthPanel open standalone redirectTo={redirectTo} />
    </main>
  );
}
