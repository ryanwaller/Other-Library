import type { Metadata } from "next";
import { redirect } from "next/navigation";

export async function generateMetadata({ params }: { params: Promise<{ author: string }> }): Promise<Metadata> {
  const { author } = await params;
  return { title: `Author: ${decodeURIComponent(author ?? "")}` };
}

export default async function AppAuthorBrowsePage({ params }: { params: Promise<{ author: string }> }) {
  const { author } = await params;
  redirect(`/app?author=${encodeURIComponent(author ?? "")}`);
}
