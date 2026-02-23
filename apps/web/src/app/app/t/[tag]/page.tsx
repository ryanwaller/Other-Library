import { redirect } from "next/navigation";

export default async function AppTagBrowsePage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  redirect(`/app?tag=${encodeURIComponent(tag ?? "")}`);
}

