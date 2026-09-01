/**
 * The host an article came from, normalized the same way the backend's
 * `registrable_host` does (lowercase, no leading `www.`). This is the key a
 * source page is addressed by — see `api/routers/sources.py` for why it's the
 * host rather than a `sources` row id.
 */
export function articleHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host: string = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/** Link target for the source behind an article, or null when unparseable. */
export function sourceHref(url: string | null | undefined): string | null {
  const host: string | null = articleHost(url);
  return host ? `/source/${encodeURIComponent(host)}` : null;
}

/** Link target for a person's profile. */
export function userHref(userId: string): string {
  return `/user/${userId}`;
}
