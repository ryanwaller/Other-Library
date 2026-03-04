export function getTrustedAppOrigin(req: Request): string {
  const configured = (process.env.APP_ORIGIN ?? "").trim();
  if (configured) {
    let parsed: URL;
    try {
      parsed = new URL(configured);
    } catch {
      throw new Error("app_origin_invalid");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("app_origin_invalid");
    return parsed.origin;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("app_origin_not_configured");
  }

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (!host) return new URL(req.url).origin;
  return `${proto}://${host}`;
}
