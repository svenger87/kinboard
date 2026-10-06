/**
 * The URL to store and render for an object in a public Storage bucket.
 *
 * Always relative: `/storage/v1/object/public/<bucket>/<path>` (RFC-018 §4).
 * It resolves against whatever address the page was opened from, so an image
 * uploaded through the LAN address still loads through the domain, and
 * changing the install's address never breaks a stored image again.
 *
 * Until 1.13 this built an absolute URL from NEXT_PUBLIC_SUPABASE_URL, and that
 * address went into the database with every upload. The migration
 * migration_zzzzzzzz_image_urls_relative.sql rewrites those rows.
 *
 * Who serves the relative path:
 * - Kong, when it is the front door (KINBOARD_ENTRY=kong) or behind a proxy
 *   that sends /storage to it (Traefik, a tunnel);
 * - the webapp's own app/storage/v1/object/public route otherwise — an install
 *   still on KINBOARD_ENTRY=webapp, or `next dev` — which streams the object
 *   from Kong over the internal network.
 *
 * Not `supabase.storage.getPublicUrl()`: the admin client is built on the
 * internal `http://kong:8000`, which no browser can resolve.
 */
export function publicStorageUrl(bucket: string, path: string): string {
  return `/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
}

/**
 * A stored image URL made absolute for a client that is not a browser on our
 * page — the Integration API's callers (Home Assistant, assistants) have no
 * page origin to resolve a relative path against. `origin` is the address the
 * caller reached us on (lib/oauth/origin.ts `publicOrigin`). Anything that is
 * not one of our relative storage paths is returned as it is.
 */
export function absoluteStorageUrl(url: string | null, origin: string): string | null {
  if (!url || !url.startsWith("/storage/v1/")) return url;
  return `${origin.replace(/\/+$/, "")}${url}`;
}
