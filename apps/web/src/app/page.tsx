"use client";

export default function MarketingHome() {
  return (
    <main className="container">
      <div className="card">
        <div style={{ marginBottom: 8 }}>Other Library</div>
        <div className="muted" style={{ marginBottom: 12 }}>
          A minimal, followers-only book catalog.
        </div>
        <div className="row">
          <a href="/app">Open the app</a>
          <span className="muted">/</span>
          <a href="mailto:hello@other-library.com">Contact</a>
        </div>
      </div>
      <div className="muted" style={{ marginTop: 12 }}>
        Public profiles (optional) will live under <span style={{ whiteSpace: "nowrap" }}>/u/username</span>.
      </div>
    </main>
  );
}
