import { DAVClient, DAVNamespaceShort, urlEquals } from "tsdav";
import type { DAVCalendar, DAVCalendarObject } from "tsdav";
import {
  parseIcsEvents,
  icsSyncWindow,
  type IcsEvent,
  type IcsWindow,
} from "@/lib/ics-fetcher";

/**
 * CalDAV transport layer (discussion #18).
 *
 * Wraps tsdav so the rest of the app never touches DAV XML. What lives
 * here is the protocol; what lives in caldav-sync.ts is the reconciliation
 * against the events table — the same split as ics-fetcher.ts / ics-sync.ts.
 *
 * Two deliberate reuses of the ICS path:
 *   - VEVENT bodies returned by a `calendar-query` REPORT are parsed with
 *     `parseIcsEvents` (node-ical), not a second parser. A CalDAV calendar
 *     object *is* an iCalendar document; only the transport differs.
 *   - The sync window is `icsSyncWindow()`, so both providers keep the
 *     same −30/+60-day slice of the events table.
 *
 * Note on SSRF: unlike /api/recipes/import, CalDAV server URLs are NOT run
 * through validateExternalUrl. Self-hosted Nextcloud/Radicale/Baïkal on a
 * private LAN address is the single most common CalDAV setup, so blocking
 * RFC 1918 hosts would block the primary use case. The trust boundary is
 * the same one Home Assistant and Immich sit behind: an admin-configured
 * URL in a PIN-gated settings page, not anonymous request input. Scheme is
 * still restricted to http(s) — see assertCaldavUrl.
 */

const CALDAV_TIMEOUT_MS = 30_000;

/** An event fetched from a CalDAV collection, tagged with its resource identity. */
export interface CaldavEvent extends IcsEvent {
  /** Path of the calendar object this VEVENT came from. */
  href: string;
  /** Resource ETag at fetch time — the If-Match precondition for later writes. */
  etag: string | null;
}

export interface DiscoveredCaldavCalendar {
  url: string;
  displayName: string;
  color: string | null;
  ctag: string | null;
  readOnly: boolean;
  /** VEVENT/VTODO/... — calendars without VEVENT support are filtered out. */
  components: string[];
}

export interface CaldavConnection {
  serverUrl: string;
  username: string;
  password: string;
}

/**
 * Reject anything that isn't plain http(s) before it reaches fetch.
 * `file://`, `data:` and friends have no business in a CalDAV URL, and a
 * bad scheme surfaces as a confusing tsdav stack trace otherwise.
 */
export function assertCaldavUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CalDAV URL must be http:// or https://");
  }
  return trimmed;
}

/**
 * Log in and run principal/calendar-home discovery.
 *
 * tsdav's `login()` walks current-user-principal → calendar-home-set for
 * us, which is exactly the part of RFC 4791 §6.2 nobody wants to
 * hand-roll: the server may answer at the root, at /.well-known/caldav,
 * or at a vendor path, and each hop can redirect.
 */
export async function createCaldavClient(
  connection: CaldavConnection,
): Promise<DAVClient> {
  const serverUrl = assertCaldavUrl(connection.serverUrl);

  const client = new DAVClient({
    serverUrl,
    credentials: {
      username: connection.username,
      password: connection.password,
    },
    // Basic over TLS is what every mainstream CalDAV server accepts
    // (Nextcloud/Radicale/Baïkal app passwords, Fastmail and iCloud
    // app-specific passwords). Digest exists but is vanishingly rare and
    // needs a pre-flight challenge round-trip to configure.
    authMethod: "Basic",
    defaultAccountType: "caldav",
    fetchOptions: { signal: AbortSignal.timeout(CALDAV_TIMEOUT_MS) },
  });

  await client.login();
  return client;
}

/**
 * List the VEVENT-capable calendars a principal can see.
 *
 * tsdav's default PROPFIND prop set doesn't ask for privileges, and
 * passing `props` REPLACES that set rather than extending it — so the
 * defaults are repeated here with current-user-privilege-set appended.
 */
export async function discoverCaldavCalendars(
  connection: CaldavConnection,
): Promise<DiscoveredCaldavCalendar[]> {
  const client = await createCaldavClient(connection);

  const calendars = await client.fetchCalendars({
    props: {
      [`${DAVNamespaceShort.CALDAV}:calendar-description`]: {},
      [`${DAVNamespaceShort.CALDAV}:calendar-timezone`]: {},
      [`${DAVNamespaceShort.DAV}:displayname`]: {},
      [`${DAVNamespaceShort.CALDAV_APPLE}:calendar-color`]: {},
      [`${DAVNamespaceShort.CALENDAR_SERVER}:getctag`]: {},
      [`${DAVNamespaceShort.DAV}:resourcetype`]: {},
      [`${DAVNamespaceShort.CALDAV}:supported-calendar-component-set`]: {},
      [`${DAVNamespaceShort.DAV}:sync-token`]: {},
      [`${DAVNamespaceShort.DAV}:current-user-privilege-set`]: {},
    },
    projectedProps: { currentUserPrivilegeSet: true },
  });

  return calendars
    // A calendar collection that only holds VTODOs (Nextcloud Tasks
    // creates these) has nothing for a family calendar to show. An empty
    // component list means the server didn't advertise one — RFC 4791
    // says treat that as "supports everything", so keep it.
    .filter(
      (cal) =>
        !cal.components ||
        cal.components.length === 0 ||
        cal.components.includes("VEVENT"),
    )
    .map((cal) => ({
      url: cal.url,
      displayName: calendarDisplayName(cal),
      color: normalizeCalendarColor(cal.calendarColor),
      ctag: cal.ctag ?? null,
      readOnly: isReadOnly(cal),
      components: cal.components ?? [],
    }));
}

/** displayName comes back as a string, a CDATA wrapper, or missing entirely. */
function calendarDisplayName(cal: DAVCalendar): string {
  const raw = cal.displayName;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object") {
    const cdata = (raw as { _cdata?: unknown })._cdata;
    if (typeof cdata === "string" && cdata.trim()) return cdata.trim();
  }
  // Last resort: the final path segment of the collection URL, which is
  // the calendar's slug on every server that doesn't set a displayname.
  const segments = cal.url.replace(/\/+$/, "").split("/");
  return decodeURIComponent(segments[segments.length - 1] || "Calendar");
}

/**
 * Apple's calendar-color is `#RRGGBBAA` (8 digits, alpha last). The
 * calendars table stores plain `#RRGGBB`, so drop the alpha; anything
 * that isn't a recognisable hex colour becomes null and the UI picks a
 * default swatch.
 */
function normalizeCalendarColor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.trim().match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  return match ? `#${match[1].toLowerCase()}` : null;
}

/**
 * Read the DAV:current-user-privilege-set into a single writable flag.
 *
 * Deliberately tolerant: the property is optional, its nesting varies
 * between servers, and xml-js compact mode shapes it differently
 * depending on whether there's one privilege or many. Rather than model
 * every variant, scan the serialized subtree for a write privilege —
 * `write`, `write-content` (RFC 3744) or the CalDAV-specific
 * `write-properties`. Absent or unrecognisable ⇒ assume writable and let
 * the server's 403 on PUT be the authority; locking a user out of their
 * own calendar over an unparsed property is the worse failure.
 */
function isReadOnly(cal: DAVCalendar): boolean {
  const privileges = cal.projectedProps?.currentUserPrivilegeSet;
  if (privileges === undefined || privileges === null) return false;

  const serialized = JSON.stringify(privileges);
  if (!serialized || serialized === "{}" || serialized === "null") return false;

  const hasWrite = /"(?:[a-z]+:)?write(?:-content|-properties)?"/i.test(serialized);
  return !hasWrite;
}

/**
 * True when the collection has changed since `previousCtag`.
 *
 * The CTag is the CalDAV analogue of the ICS path's ETag: one cheap
 * PROPFIND tells us whether the expensive REPORT is worth running. A
 * server that doesn't publish a CTag (rare, but Radicale used to) always
 * reports dirty, which just means we always do the full REPORT.
 */
export async function fetchCaldavCtag(
  client: DAVClient,
  calendarUrl: string,
): Promise<string | null> {
  const [response] = await client.propfind({
    url: calendarUrl,
    props: { [`${DAVNamespaceShort.CALENDAR_SERVER}:getctag`]: {} },
    depth: "0",
  });
  const ctag = response?.props?.getctag;
  return typeof ctag === "string" ? ctag : null;
}

/**
 * Fetch every VEVENT in the sync window, expanded and window-scoped.
 *
 * Recurring events are expanded client-side by node-ical rather than
 * asking the server for a `calendar-query` with `expand` — server-side
 * expansion is optional in RFC 4791 and implemented inconsistently
 * (Radicale ignores it, older Nextcloud mangles EXDATEs). Expanding
 * locally means one code path shared with ICS feeds and identical
 * results across servers.
 */
export async function fetchCaldavEvents(
  client: DAVClient,
  calendarUrl: string,
  window: IcsWindow = icsSyncWindow(),
): Promise<CaldavEvent[]> {
  const objects = await client.fetchCalendarObjects({
    calendar: { url: calendarUrl },
    timeRange: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    },
    // tsdav's default filter keeps only hrefs ending in `.ics`. Most
    // servers name resources that way, but it's a convention, not a
    // rule — Zimbra and some Exchange bridges don't. The calendar-query
    // REPORT has already restricted the result set to VEVENT resources,
    // so the only thing worth excluding is the collection's own href,
    // which servers echo back as the first response at Depth: 1.
    urlFilter: (url) => Boolean(url) && !urlEquals(url, calendarUrl),
  });

  const out: CaldavEvent[] = [];
  for (const object of objects) {
    for (const event of parseCaldavObject(object, window)) out.push(event);
  }
  return out;
}

/**
 * Parse one calendar object into zero or more window-scoped events.
 *
 * "Zero" is normal: a `time-range` filter matches the resource, but after
 * local expansion an all-day boundary case can fall outside the window.
 * "More than one" is a recurring master expanding into instances.
 */
function parseCaldavObject(
  object: DAVCalendarObject,
  window: IcsWindow,
): CaldavEvent[] {
  const data = typeof object.data === "string" ? object.data : null;
  if (!data) return [];

  let events: IcsEvent[];
  try {
    events = parseIcsEvents(data, window);
  } catch (err) {
    // One malformed resource must not fail the whole calendar's sync.
    console.warn(
      `[caldav] Skipping unparseable object ${object.url}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }

  return events.map((event) => ({
    ...event,
    href: object.url,
    etag: normalizeEtag(object.etag),
  }));
}

/**
 * Quotes and any `W/` weak-validator prefix are deliberately preserved:
 * an ETag has to go back out on If-Match byte-identical to how it
 * arrived, or the precondition fails against a server that compares
 * strictly. Only whitespace and the empty case are normalized.
 */
function normalizeEtag(etag: string | undefined | null): string | null {
  if (typeof etag !== "string") return null;
  const trimmed = etag.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface CaldavWriteResult {
  href: string;
  etag: string | null;
}

/**
 * Create a new calendar object.
 *
 * tsdav sends `If-None-Match: *`, so a UID collision fails loudly instead
 * of overwriting somebody else's event. `filename` is `<uid>.ics` — the
 * convention every server accepts, and the one that makes the resource
 * findable by UID if a human ever pokes at the collection directly.
 */
export async function createCaldavEvent(
  client: DAVClient,
  calendarUrl: string,
  uid: string,
  iCalString: string,
): Promise<CaldavWriteResult> {
  const collectionUrl = ensureCollectionUrl(calendarUrl);
  const filename = `${encodeURIComponent(uid)}.ics`;

  const response = await client.createCalendarObject({
    calendar: { url: collectionUrl },
    filename,
    iCalString,
  });

  await assertOk(response, "create");

  // tsdav PUTs to `new URL(filename, calendar.url)`. Resolving the same
  // way here (rather than reading Location, which plenty of servers omit
  // on 201) guarantees the href we persist is the one that was written.
  const href = new URL(filename, collectionUrl).href;
  return { href, etag: etagFromResponse(response) };
}

/**
 * A DAV collection URL must end in a slash before it can be used as a
 * relative-resolution base: `new URL('a.ics', '.../cal')` resolves to a
 * *sibling* of `cal`, silently writing outside the calendar. Most servers
 * already return the trailing slash; the ones that don't would otherwise
 * scatter events into the calendar-home collection.
 */
function ensureCollectionUrl(calendarUrl: string): string {
  return calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
}

/**
 * Replace an existing calendar object.
 *
 * CalDAV has no partial update — a PUT replaces the whole resource, so
 * callers must serialize the complete VEVENT, not a delta. `etag` becomes
 * an `If-Match` precondition: if the event changed on a phone since our
 * last sync, the server answers 412 and we surface a conflict rather than
 * silently discarding that change.
 */
export async function updateCaldavEvent(
  client: DAVClient,
  href: string,
  iCalString: string,
  etag: string | null,
): Promise<CaldavWriteResult> {
  const response = await client.updateCalendarObject({
    calendarObject: { url: href, data: iCalString, etag: etag ?? undefined },
  });

  await assertOk(response, "update");
  return { href, etag: etagFromResponse(response) };
}

/** Delete a calendar object, guarded by If-Match for the same reason as update. */
export async function deleteCaldavEvent(
  client: DAVClient,
  href: string,
  etag: string | null,
): Promise<void> {
  const response = await client.deleteCalendarObject({
    calendarObject: { url: href, etag: etag ?? undefined },
  });

  // A resource that's already gone is the desired end state, not an error.
  if (response.status === 404 || response.status === 410) return;
  await assertOk(response, "delete");
}

/** Thrown when the server rejected a write because the resource moved under us. */
export class CaldavConflictError extends Error {
  constructor(operation: string) {
    super(
      `CalDAV ${operation} rejected: the event changed on the server since the last sync`,
    );
    this.name = "CaldavConflictError";
  }
}

/** Thrown when the credentials no longer authenticate. */
export class CaldavAuthError extends Error {
  constructor() {
    super("CalDAV authentication failed — check the username and password");
    this.name = "CaldavAuthError";
  }
}

async function assertOk(response: Response, operation: string): Promise<void> {
  if (response.ok) return;

  if (response.status === 412) throw new CaldavConflictError(operation);
  if (response.status === 401) throw new CaldavAuthError();
  if (response.status === 403) {
    throw new Error(`CalDAV ${operation} forbidden — the calendar is read-only`);
  }

  // Servers put the useful part in the body (Nextcloud returns a DAV
  // error element naming the failed precondition); cap it so a stray HTML
  // error page doesn't end up in a toast.
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 200).replace(/\s+/g, " ").trim();
  } catch {
    // body already consumed or not readable — status alone will do
  }

  throw new Error(
    `CalDAV ${operation} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
  );
}

/**
 * The ETag a write produced.
 *
 * Servers are allowed to answer a PUT without one (RFC 4791 §5.3.4 only
 * says they SHOULD), in which case there's no validator to guard the next
 * write with — null propagates through to the events row and the next
 * update goes out unconditioned, which is the same exposure the ICS path
 * has always had. The following sync restores a real ETag.
 */
function etagFromResponse(response: Response): string | null {
  return normalizeEtag(response.headers.get("etag"));
}
