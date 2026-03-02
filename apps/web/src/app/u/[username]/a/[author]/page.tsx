import { permanentRedirect } from "next/navigation";

export default async function PublicAuthorPage({ params }: { params: Promise<{ username: string; author: string }> }) {
  const { username, author } = await params;
  permanentRedirect(`/u/${username}?author=${encodeURIComponent(author)}`);
}
