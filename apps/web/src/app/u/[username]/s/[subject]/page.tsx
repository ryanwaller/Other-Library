import { permanentRedirect } from "next/navigation";

export default async function PublicSubjectPage({ params }: { params: Promise<{ username: string; subject: string }> }) {
  const { username, subject } = await params;
  permanentRedirect(`/u/${username}?subject=${encodeURIComponent(subject)}`);
}
