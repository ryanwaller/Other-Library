import { NextResponse, type NextRequest } from "next/server";

function isAppHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host.startsWith("app.");
}

function isMarketingHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host.length > 0 && !isAppHost(host);
}

function stripPort(host: string) {
  return host.split(":")[0] ?? host;
}

function appHostFor(host: string) {
  const hostname = stripPort(host).toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return host;
  if (hostname.startsWith("www.")) return `app.${hostname.slice(4)}`;
  if (hostname.startsWith("app.")) return host;
  return `app.${hostname}`;
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const url = req.nextUrl;
  const pathname = url.pathname;

  // App subdomain serves routes under /app, but we keep URLs clean for users.
  if (isAppHost(host)) {
    if (pathname === "/") {
      url.pathname = "/app";
      return NextResponse.rewrite(url);
    }

    if (!pathname.startsWith("/app")) {
      url.pathname = `/app${pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  // Keep /app URLs on the current host to avoid cross-host reload redirects.

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
