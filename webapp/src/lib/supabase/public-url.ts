/**
 * Build a browser-reachable public URL for an object in a public Supabase
 * Storage bucket.
 *
 * Why this exists: the server-side `createAdminClient()` is constructed
 * with `SUPABASE_URL=http://kong:8000` (internal Docker hostname) so its
 * own API calls take the fast in-network path. But `supabase.storage
 * .from(bucket).getPublicUrl(path)` derives the returned URL from that
 * same constructor URL — meaning every public URL it hands back uses
 * `http://kong:8000`, which the browser can't resolve.
 *
 * The fix is to construct the URL ourselves using the external base
 * (`NEXT_PUBLIC_SUPABASE_URL`, which is what the browser uses for every
 * other Supabase call). This is what Supabase's hosted environment does
 * implicitly because there is no internal/external split there; in our
 * self-hosted Docker setup, we have to do it explicitly.
 */
export function publicStorageUrl(bucket: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    // No external URL configured — fall back to a relative path so at
    // least the same-origin case still works. Self-hosters who set up
    // setup.sh will always have NEXT_PUBLIC_SUPABASE_URL set; this
    // branch is just defensive.
    return `/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
  }
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
}
