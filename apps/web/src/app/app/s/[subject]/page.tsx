import { redirect } from "next/navigation";

export default async function AppSubjectBrowsePage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject } = await params;
  redirect(`/app?subject=${encodeURIComponent(subject ?? "")}`);
}

