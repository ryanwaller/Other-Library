import { getPublicEnvOptional } from "../../lib/env";

export default function SetupPage() {
  const env = getPublicEnvOptional();

  return (
    <main className="container">
      <div className="card">
        <div style={{ marginBottom: 8 }}>Setup</div>
        <div className="muted">
          This page confirms whether the web app can see the required Supabase environment variables.
        </div>
        <div style={{ marginTop: 12 }}>
          {env ? (
            <div>
              <div>Supabase env: present</div>
              <div className="muted" style={{ marginTop: 8 }}>
                URL: {env.url}
              </div>
            </div>
          ) : (
            <div>
              <div>Supabase env: missing</div>
              <div className="muted" style={{ marginTop: 8 }}>
                In Vercel → Project → Settings → Environment Variables, add:
                <div style={{ marginTop: 8 }}>
                  <div>
                    <span className="muted">-</span> NEXT_PUBLIC_SUPABASE_URL
                  </div>
                  <div>
                    <span className="muted">-</span> NEXT_PUBLIC_SUPABASE_ANON_KEY
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

