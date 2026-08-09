/**
 * A DLNA/UPnP media server, as a photo source.
 *
 * Asked for in discussion #184: a NAS already serving photos over DLNA is the
 * one photo library a household tends to have without signing up for anything.
 * No account, no API key, no cloud — the server is on the LAN and answers to
 * anyone who asks it politely in SOAP.
 *
 * Two things are worth knowing before reading further.
 *
 * THERE IS NO AUTODISCOVERY, DELIBERATELY
 *
 * SSDP finds servers by shouting on a UDP multicast group (239.255.255.250).
 * Kinboard runs in a bridge-networked container, which does not receive that
 * traffic, so discovery would find nothing on a normal install and something
 * on a host-networked one — a feature that works for a minority and silently
 * fails for everyone else is worse than no feature. The owner pastes the
 * device description URL instead, and the settings page says where to find it.
 *
 * IMAGES MUST BE PROXIED
 *
 * A DLNA server speaks plain HTTP. A wall display on https:// cannot load an
 * http:// image — the browser blocks it as mixed content, silently. So the
 * bytes come back through /api/dlna/image rather than being linked directly,
 * the same shape /api/immich/image already uses.
 *
 * On SSRF: these URLs are LAN addresses by definition, so they are not run
 * through validateExternalUrl — the same call the CalDAV client makes, for the
 * same reason (see caldav-client.ts). The trust boundary is an admin-typed URL
 * in a PIN-gated settings page.
 */

const DLNA_TIMEOUT_MS = 10_000;
const CONTENT_DIRECTORY = "urn:schemas-upnp-org:service:ContentDirectory:1";

/** Reject anything that isn't plain http(s) before it reaches fetch. */
export function assertDlnaUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("dlna: not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`dlna: unsupported scheme ${url.protocol}`);
  }
  return url;
}

export interface DlnaServer {
  /** The device description URL the user gave us, echoed back. */
  descriptionUrl: string;
  friendlyName: string;
  /** Absolute URL of the ContentDirectory service's control endpoint. */
  controlUrl: string;
}

export interface DlnaContainer {
  id: string;
  title: string;
  /** How many children the server claims. `null` when it does not say. */
  childCount: number | null;
}

export interface DlnaItem {
  id: string;
  title: string;
  /** Full-size image URL on the media server. */
  url: string;
  /** A smaller rendition when the server offers one. */
  thumbnailUrl: string | null;
  mimeType: string | null;
  /** "4032x3024" as the server reported it, unparsed. */
  resolution: string | null;
  /** Bytes, when the server says. */
  size: number | null;
  /** dc:date, as reported — formats vary too much to normalise here. */
  date: string | null;
}

export interface DlnaBrowseResult {
  containers: DlnaContainer[];
  items: DlnaItem[];
  /** The server's total child count for this container, for paging. */
  totalMatches: number;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

/**
 * A tolerant XML scanner, just large enough for DIDL-Lite and device
 * descriptions.
 *
 * Not a regex — this codebase has already paid once for treating markup as
 * text — and not a dependency either: the only XML parser in the tree is a
 * transitive one, and promoting it to a direct dependency means a lockfile
 * change this worktree cannot regenerate without mutating a node_modules it
 * shares with other checkouts. DIDL-Lite is a narrow, well-specified format,
 * so a scanner with real fixtures behind it is the smaller risk.
 *
 * Tolerant on purpose: media servers emit XML that a strict parser rejects,
 * and an unescaped `&` in a filename is routine. A photo wall that drops one
 * badly-named file beats one that shows nothing.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    switch (body) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      // Anything else is left as written: a bare "&" in a filename is not an
      // entity and must survive the round trip.
      default: return whole;
    }
  });
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function walk(
  xml: string,
  onOpen: (name: string, attrs: Record<string, string>) => void,
  onText: (name: string, text: string) => void,
  onClose: (name: string) => void,
): void {
  const stack: string[] = [];
  let i = 0;

  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) break;

    if (lt > i) {
      const text = xml.slice(i, lt);
      const name = stack[stack.length - 1];
      if (name && text.trim()) onText(name, decodeEntities(text).trim());
    }

    // <!-- comment -->, <![CDATA[...]]>, <?xml ... ?>, <!DOCTYPE ...>
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      i = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      const body = xml.slice(lt + 9, end === -1 ? xml.length : end);
      const name = stack[stack.length - 1];
      // CDATA is literal: no entity decoding.
      if (name && body.trim()) onText(name, body.trim());
      i = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt);
      i = end === -1 ? xml.length : end + 1;
      continue;
    }

    const gt = xml.indexOf(">", lt);
    if (gt === -1) break;
    const inner = xml.slice(lt + 1, gt);

    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim().toLowerCase();
      // Unbalanced close tags are dropped rather than corrupting the stack.
      if (stack[stack.length - 1] === name) {
        stack.pop();
        onClose(name);
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/\s/);
    const name = (space === -1 ? body : body.slice(0, space)).trim().toLowerCase();
    const attrs = space === -1 ? {} : parseAttrs(body.slice(space));

    if (name) {
      if (!selfClosing) stack.push(name);
      onOpen(name, attrs);
      if (selfClosing) onClose(name);
    }
    i = gt + 1;
  }
}

/** Strip a namespace prefix: `dc:title` → `title`. */
function local(name: string): string {
  const i = name.indexOf(":");
  return i === -1 ? name : name.slice(i + 1);
}

// ---------------------------------------------------------------------------
// Device description
// ---------------------------------------------------------------------------

/**
 * Read a device description XML and find its ContentDirectory control URL.
 *
 * `controlURL` is usually relative, and servers disagree about whether it
 * starts with a slash, so it is resolved against `URLBase` when present and the
 * description URL otherwise — which is what the UPnP spec says to do and what
 * the difference between MiniDLNA and Jellyfin comes down to in practice.
 */
export function parseDeviceDescription(
  xml: string,
  descriptionUrl: string,
): { friendlyName: string; controlUrl: string } | null {
  let friendlyName = "";
  let urlBase = "";
  let inService = false;
  let serviceType = "";
  let controlPath = "";
  let foundControlPath: string | null = null;
  let field: string | null = null;

  walk(
    xml,
    (name) => {
      const n = local(name);
      if (n === "service") {
        inService = true;
        serviceType = "";
        controlPath = "";
      }
      field = n;
    },
    (name, text) => {
      const n = local(name);
      if (n !== field) return;
      if (n === "friendlyname" && !friendlyName) friendlyName = text;
      else if (n === "urlbase" && !urlBase) urlBase = text;
      else if (inService && n === "servicetype") serviceType += text;
      else if (inService && n === "controlurl") controlPath += text;
    },
    (name) => {
      if (local(name) === "service") {
        // ContentDirectory:1 is the near-universal version; match on the
        // service name rather than the exact version string so a server
        // advertising :2 still works.
        if (serviceType.includes("ContentDirectory") && controlPath) {
          foundControlPath ??= controlPath;
        }
        inService = false;
      }
      field = null;
    },
  );

  if (!foundControlPath) return null;

  const base = urlBase || descriptionUrl;
  let controlUrl: string;
  try {
    controlUrl = new URL(foundControlPath, base).toString();
  } catch {
    return null;
  }

  return { friendlyName: friendlyName || "DLNA server", controlUrl };
}

// ---------------------------------------------------------------------------
// DIDL-Lite
// ---------------------------------------------------------------------------

/** Which `upnp:class` values count as a photo. */
function isPhotoClass(cls: string): boolean {
  const c = cls.toLowerCase();
  return c.includes("imageitem") || c.includes("photo");
}

/** Is this `res` a thumbnail rather than the real thing? */
function isThumbnailRes(protocolInfo: string): boolean {
  const p = protocolInfo.toUpperCase();
  return p.includes("JPEG_TN") || p.includes("JPEG_SM") || p.includes("PNG_TN");
}

/**
 * Parse the DIDL-Lite document a Browse returns.
 *
 * Items carry one `<res>` per rendition; which one is "the photo" is a
 * judgement the server does not make for us. The largest non-thumbnail wins,
 * falling back to the first `res` of any kind so a server that only publishes
 * a thumbnail still shows something.
 */
export function parseDidl(xml: string): { containers: DlnaContainer[]; items: DlnaItem[] } {
  const containers: DlnaContainer[] = [];
  const items: DlnaItem[] = [];

  type Res = { url: string; protocolInfo: string; size: number | null; resolution: string | null };
  let current: {
    kind: "container" | "item";
    id: string;
    title: string;
    cls: string;
    childCount: number | null;
    date: string | null;
    albumArt: string | null;
    res: Res[];
  } | null = null;
  let pendingRes: Res | null = null;
  let field: string | null = null;

  walk(
    xml,
    (name, attrs) => {
      const n = local(name);
      field = n;
      if (n === "container" || n === "item") {
        const childCount = attrs["childcount"];
        current = {
          kind: n === "container" ? "container" : "item",
          id: attrs["id"] ?? "",
          title: "",
          cls: "",
          childCount: childCount != null && childCount !== "" ? Number(childCount) : null,
          date: null,
          albumArt: null,
          res: [],
        };
      } else if (n === "res" && current) {
        const size = attrs["size"];
        pendingRes = {
          url: "",
          protocolInfo: attrs["protocolinfo"] ?? "",
          size: size != null && size !== "" && Number.isFinite(Number(size)) ? Number(size) : null,
          resolution: attrs["resolution"] ?? null,
        };
      }
    },
    (name, text) => {
      if (!current) return;
      const n = local(name);
      if (n !== field) return;
      if (n === "title") current.title += text;
      else if (n === "class") current.cls += text;
      else if (n === "date") current.date = (current.date ?? "") + text;
      else if (n === "albumarturi") current.albumArt = (current.albumArt ?? "") + text;
      else if (n === "res" && pendingRes) pendingRes.url += text;
    },
    (name) => {
      const n = local(name);
      field = null;
      if (n === "res" && pendingRes) {
        if (pendingRes.url) current?.res.push(pendingRes);
        pendingRes = null;
        return;
      }
      if (!current) return;
      if (n === "container" && current.kind === "container") {
        containers.push({
          id: current.id,
          title: current.title || "(untitled)",
          childCount: Number.isFinite(current.childCount as number) ? current.childCount : null,
        });
        current = null;
      } else if (n === "item" && current.kind === "item") {
        // Only photos. A DLNA root mixes music, video and images, and a
        // screensaver asking for the Photos container still gets the odd
        // stray .nfo or playlist alongside them.
        if (isPhotoClass(current.cls) && current.res.length > 0) {
          const full = current.res.filter((r) => !isThumbnailRes(r.protocolInfo));
          const chosen =
            full.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0] ?? current.res[0];
          const thumb =
            current.albumArt ||
            current.res.find((r) => isThumbnailRes(r.protocolInfo))?.url ||
            null;
          const mime = chosen.protocolInfo.split(":")[2] || null;
          items.push({
            id: current.id,
            title: current.title || "(untitled)",
            url: chosen.url,
            thumbnailUrl: thumb,
            mimeType: mime && mime !== "*" ? mime : null,
            resolution: chosen.resolution,
            size: chosen.size,
            date: current.date,
          });
        }
        current = null;
      }
    },
  );

  return { containers, items };
}

/** Pull the escaped DIDL-Lite payload out of a Browse SOAP envelope. */
export function extractBrowseResult(soapXml: string): { didl: string; totalMatches: number } {
  let didl = "";
  let totalMatches = 0;
  let field: string | null = null;

  walk(
    soapXml,
    (name) => {
      field = local(name);
    },
    (name, text) => {
      const n = local(name);
      if (n !== field) return;
      // The scanner decodes entities, so `Result` arrives as the DIDL-Lite
      // document itself rather than as &lt;DIDL-Lite&gt;.
      if (n === "result") didl += text;
      else if (n === "totalmatches") totalMatches = Number(text) || 0;
    },
    () => {
      field = null;
    },
  );

  return { didl, totalMatches };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DLNA_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Read a device description and locate its ContentDirectory. */
export async function describeServer(descriptionUrl: string): Promise<DlnaServer> {
  assertDlnaUrl(descriptionUrl);
  const res = await fetchWithTimeout(descriptionUrl, { headers: { Accept: "text/xml" } });
  if (!res.ok) {
    throw new Error(`dlna: device description returned ${res.status}`);
  }
  const xml = await res.text();
  const parsed = parseDeviceDescription(xml, descriptionUrl);
  if (!parsed) {
    throw new Error("dlna: no ContentDirectory service in the device description");
  }
  return { descriptionUrl, friendlyName: parsed.friendlyName, controlUrl: parsed.controlUrl };
}

/** Build the SOAP envelope for a ContentDirectory Browse. */
export function browseEnvelope(
  objectId: string,
  flag: "BrowseDirectChildren" | "BrowseMetadata",
  startingIndex: number,
  requestedCount: number,
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
 <s:Body>
  <u:Browse xmlns:u="${CONTENT_DIRECTORY}">
   <ObjectID>${esc(objectId)}</ObjectID>
   <BrowseFlag>${flag}</BrowseFlag>
   <Filter>*</Filter>
   <StartingIndex>${startingIndex}</StartingIndex>
   <RequestedCount>${requestedCount}</RequestedCount>
   <SortCriteria></SortCriteria>
  </u:Browse>
 </s:Body>
</s:Envelope>`;
}

/**
 * Point a media URL at the address we can actually reach.
 *
 * A media server fills its `<res>` URLs with whichever address it detected for
 * itself at startup. That is frequently not the address the client used: a
 * multi-homed NAS, a server behind NAT, or anything in Docker will happily
 * hand out an address that is unroutable from here. Caught with a real
 * MiniDLNA, which advertised its bridge IP while answering on another network.
 *
 * The host is rewritten to the one that just answered the browse; the port and
 * path are kept, because media is often served from a different port than the
 * control endpoint and that part the server does know.
 */
export function reachableMediaUrl(mediaUrl: string, controlUrl: string): string {
  try {
    const media = new URL(mediaUrl);
    const control = new URL(controlUrl);
    if (media.hostname === control.hostname) return mediaUrl;
    media.hostname = control.hostname;
    return media.toString();
  } catch {
    return mediaUrl;
  }
}

/**
 * One object's own metadata, rather than its children.
 *
 * This is how the image proxy finds out where a photo lives. It could have
 * been handed the URL by the browser instead — it used to be — but then the
 * address the server fetches comes from the request, which is an open proxy
 * wearing a signature. Asking the media server to describe the object by its
 * own id means the URL is only ever something this family's configured server
 * said, and there is nothing to forge.
 *
 * Returns null when the id names something that is not an item, or the server
 * declines to describe it.
 */
export async function browseItemMetadata(
  controlUrl: string,
  objectId: string,
): Promise<DlnaItem | null> {
  assertDlnaUrl(controlUrl);
  const res = await fetchWithTimeout(controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPACTION: `"${CONTENT_DIRECTORY}#Browse"`,
    },
    body: browseEnvelope(objectId, "BrowseMetadata", 0, 1),
  });
  if (!res.ok) {
    throw new Error(`dlna: metadata returned ${res.status}`);
  }
  const { didl } = extractBrowseResult(await res.text());
  const { items } = parseDidl(didl);
  return items[0] ?? null;
}

/** Browse a container's direct children. `objectId` "0" is the root. */
export async function browse(
  controlUrl: string,
  objectId = "0",
  { startingIndex = 0, requestedCount = 200 } = {},
): Promise<DlnaBrowseResult> {
  assertDlnaUrl(controlUrl);
  const res = await fetchWithTimeout(controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPACTION: `"${CONTENT_DIRECTORY}#Browse"`,
    },
    body: browseEnvelope(objectId, "BrowseDirectChildren", startingIndex, requestedCount),
  });
  if (!res.ok) {
    throw new Error(`dlna: browse returned ${res.status}`);
  }
  const soap = await res.text();
  const { didl, totalMatches } = extractBrowseResult(soap);
  const { containers, items } = parseDidl(didl);
  return { containers, items, totalMatches };
}
