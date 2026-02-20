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

  // Marketing hosts should not expose /app URLs; send to app subdomain.
  if (isMarketingHost(host) && pathname.startsWith("/app")) {
    const dest = new URL(req.url);
    dest.hostname = appHostFor(host);
    dest.pathname = pathname.replace(/^\/app/, "") || "/";
    return NextResponse.redirect(dest);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
