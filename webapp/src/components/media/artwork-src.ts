/**
 * Where an artwork URL should be loaded from.
 *
 * Two kinds arrive from Home Assistant and they need opposite treatment.
 *
 * **A path on Home Assistant** — `/api/media_player_proxy/...`, or a browse
 * thumbnail like `/api/brands/integration/radio_browser/logo.png` — needs the
 * household's access token, which the browser does not have and must not be
 * given. Those go through our artwork route, which attaches the token
 * server-side and refuses anything that would resolve off HA's origin.
 *
 * **An absolute URL somewhere else entirely** — Radio Browser hands out the
 * station's own logo, hosted by the station: `https://i.iheart.com/...`,
 * `https://icecast.walmradio.com:8443/classic.jpg`. Those are public images
 * that need no credentials. Sending them through the artwork route means the
 * route refuses them — it is built to reject anything off HA's origin, which
 * is the right rule for a credentialed fetch and the wrong one here — and all
 * 238 stations render as grey squares.
 *
 * So: relative through the proxy, absolute straight to the browser. That is
 * also what Home Assistant's own media browser does with these.
 *
 * The trade-off, stated because it is real: the browser then fetches images
 * from whatever host the station listed, so a wall display makes requests to
 * third parties it would not otherwise make. No credentials of ours go with
 * them, and the alternative is a feature that does not work.
 */
export function artworkSrc(
  playerId: string,
  familyId: string,
  artworkUrl: string | undefined,
): string | undefined {
  if (!artworkUrl) return undefined;
  // Only a single-slash path is ours to proxy. `//host/x` is protocol-relative
  // — an absolute URL wearing a path's clothes — and belongs in the other branch.
  if (artworkUrl.startsWith("/") && !artworkUrl.startsWith("//")) {
    return `/api/media-players/${playerId}/artwork?family_id=${familyId}&src=${encodeURIComponent(artworkUrl)}`;
  }
  // Anything else is loaded directly. `http:` on an https page is blocked by
  // the browser as mixed content; that is the browser's call to make, and a
  // missing logo is better than a proxy that pretends it can fetch anything.
  return artworkUrl;
}
