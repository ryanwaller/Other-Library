import { permanentRedirect } from "next/navigation";

export default async function PublicPublisherPage({ params }: { params: Promise<{ username: string; publisher: string }> }) {
  const { username, publisher } = await params;
  permanentRedirect(`/u/${username}?publisher=${encodeURIComponent(publisher)}`);
}
