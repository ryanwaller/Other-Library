import { redirect } from "next/navigation";

export default async function AppAuthorBrowsePage({ params }: { params: Promise<{ author: string }> }) {
  const { author } = await params;
  redirect(`/app?author=${encodeURIComponent(author ?? "")}`);
}

