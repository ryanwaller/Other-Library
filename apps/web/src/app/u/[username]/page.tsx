export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return (
    <main className="container">
      <div className="card">
        <div>@{username}</div>
        <div className="muted" style={{ marginTop: 8 }}>
          Public profiles are not enabled yet.
        </div>
      </div>
    </main>
  );
}
