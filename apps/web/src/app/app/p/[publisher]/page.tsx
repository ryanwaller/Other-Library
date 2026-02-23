import { redirect } from "next/navigation";

export default async function AppPublisherBrowsePage({ params }: { params: Promise<{ publisher: string }> }) {
  const { publisher } = await params;
  redirect(`/app?publisher=${encodeURIComponent(publisher ?? "")}`);
}

