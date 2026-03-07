import type { Metadata } from "next";
import { redirect } from "next/navigation";

export async function generateMetadata({ params }: { params: Promise<{ subject: string }> }): Promise<Metadata> {
  const { subject } = await params;
  return { title: `Subject: ${decodeURIComponent(subject ?? "")}` };
}

export default async function AppSubjectBrowsePage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject } = await params;
  redirect(`/app?subject=${encodeURIComponent(subject ?? "")}`);
}
