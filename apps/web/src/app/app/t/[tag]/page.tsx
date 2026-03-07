import type { Metadata } from "next";
import { redirect } from "next/navigation";

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  const { tag } = await params;
  return { title: `Tag: ${decodeURIComponent(tag ?? "")}` };
}

export default async function AppTagBrowsePage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  redirect(`/app?tag=${encodeURIComponent(tag ?? "")}`);
}
