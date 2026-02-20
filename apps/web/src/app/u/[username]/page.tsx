export default function PublicProfilePage({ params }: { params: { username: string } }) {
  const { username } = params;
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
