import type { Metadata } from "next";
import { redirect } from "next/navigation";

export async function generateMetadata({ params }: { params: Promise<{ publisher: string }> }): Promise<Metadata> {
  const { publisher } = await params;
  return { title: `Publisher: ${decodeURIComponent(publisher ?? "")}` };
}

export default async function AppPublisherBrowsePage({ params }: { params: Promise<{ publisher: string }> }) {
  const { publisher } = await params;
  redirect(`/app?publisher=${encodeURIComponent(publisher ?? "")}`);
}
