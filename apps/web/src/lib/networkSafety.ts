const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isBlockedIpv4(hostname: string): boolean {
  if (!IPV4_RE.test(hostname)) return false;
  const octets = hostname.split(".").map((x) => Number(x));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedIpv6(hostname: string): boolean {
  if (!hostname.includes(":")) return false;
  const h = hostname.toLowerCase().split("%")[0] ?? hostname.toLowerCase();
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fe80:")) return true; // link-local
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(h)) return true; // unique local
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  if (isBlockedIpv4(h)) return true;
  if (isBlockedIpv6(h)) return true;
  return false;
}

export function isSafeHttpUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (isBlockedHostname(url.hostname)) return false;
  return true;
}

export async function fetchWithSafeRedirects(
  input: string | URL,
  init: RequestInit = {},
  maxRedirects = 5
): Promise<{ response: Response; finalUrl: string }> {
  let current = typeof input === "string" ? new URL(input) : new URL(input.toString());
  let hops = 0;

  while (true) {
    if (!isSafeHttpUrl(current)) throw new Error("That host is not allowed.");
    const response = await fetch(current.toString(), { ...init, redirect: "manual" });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: current.toString() };
    }

    if (hops >= maxRedirects) throw new Error("Too many redirects.");
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect missing location.");

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new Error("Invalid redirect target.");
    }
    if (!isSafeHttpUrl(next)) throw new Error("Redirect target host is not allowed.");

    current = next;
    hops += 1;
  }
}
