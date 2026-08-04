import * as ical from "node-ical";

export interface IcsEvent {
  uid: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
}

export interface IcsFetchResult {
  events: IcsEvent[];
  etag: string | null;
  notModified: boolean;
}

const ICS_FETCH_TIMEOUT_MS = 30_000;
const MAX_ICS_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * The sync window every iCalendar-shaped source is scoped to: 30 days of
 * history through 60 days ahead. Shared with the CalDAV path (see
 * lib/caldav-client.ts) so a family's events table has one retention
 * story regardless of which provider a calendar came from.
 */
export const ICS_WINDOW_PAST_DAYS = 30;
export const ICS_WINDOW_FUTURE_DAYS = 60;

export interface IcsWindow {
  start: Date;
  end: Date;
}

export function icsSyncWindow(now: Date = new Date()): IcsWindow {
  const start = new Date(now);
  start.setDate(start.getDate() - ICS_WINDOW_PAST_DAYS);
  const end = new Date(now);
  end.setDate(end.getDate() + ICS_WINDOW_FUTURE_DAYS);
  return { start, end };
}

/**
 * Fetch + parse an ICS URL. Handles webcal:// → https:// rewrite (iCloud
 * shares calendars as webcal links), respects ETag for conditional GETs,
 * caps response size at 5 MB to avoid memory blowups on misconfigured sources.
 *
 * Returns parsed events scoped to a 60-day window (-30 days through +60 days
 * from now) to keep the events table from growing unboundedly for calendars
 * that include long histories. Recurring events that land in the window are
 * expanded; events outside are skipped.
 */
export async function fetchIcsCalendar(
  rawUrl: string,
  previousEtag?: string | null,
): Promise<IcsFetchResult> {
  // webcal:// is iCloud's "subscribe via Calendar.app" scheme. For HTTPS
  // fetches we rewrite to https:// — same content, fetchable URL.
  let url = rawUrl.trim();
  if (url.startsWith("webcal://")) url = "https://" + url.slice(9);
  if (url.startsWith("webcals://")) url = "https://" + url.slice(10);

  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    throw new Error("ICS URL must be http(s) or webcal");
  }

  const headers: Record<string, string> = {
    "User-Agent": "Kinboard/1.x ICS sync (+https://github.com/svenger87/kinboard)",
    Accept: "text/calendar, application/calendar+xml, */*",
  };
  if (previousEtag) headers["If-None-Match"] = previousEtag;

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(ICS_FETCH_TIMEOUT_MS),
    redirect: "follow",
  });

  if (response.status === 304) {
    return { events: [], etag: previousEtag ?? null, notModified: true };
  }
  if (!response.ok) {
    throw new Error(`ICS fetch failed: HTTP ${response.status}`);
  }

  // Cap response size before reading
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_ICS_BYTES) {
    throw new Error(
      `ICS response too large: ${contentLength} bytes (max ${MAX_ICS_BYTES})`
    );
  }

  const text = await response.text();
  if (text.length > MAX_ICS_BYTES) {
    throw new Error(
      `ICS response too large after read: ${text.length} bytes`
    );
  }

  assertLooksLikeCalendar(text, response);

  const events = parseIcsEvents(text);
  const newEtag = response.headers.get("etag");

  return { events, etag: newEtag, notModified: false };
}

/**
 * Refuse a 200 that isn't an iCalendar document.
 *
 * `ical.sync.parseICS` doesn't throw on rubbish — hand it an HTML login
 * page, a Cloudflare interstitial or a "share link expired" page that
 * answers 200, and it returns an object with no VEVENT components. The
 * sync then reads that as "this calendar now has zero events" and
 * deletes every event it had, which is how a family calendar empties
 * itself because a provider had a bad afternoon.
 *
 * A genuinely empty calendar is a different thing and must still work:
 * it says BEGIN:VCALENDAR and simply contains no VEVENT. So the test is
 * for the envelope, not for the contents.
 *
 * Throwing here rather than returning empty puts this on the same path
 * as a transport failure, which the caller already handles by leaving
 * the existing events alone.
 */
function assertLooksLikeCalendar(text: string, response: Response): void {
  // Only the head is checked: the marker is the first line of any valid
  // iCalendar stream, and scanning a multi-megabyte body for it would
  // let a large HTML page pass on a stray mention.
  if (/BEGIN:VCALENDAR/i.test(text.slice(0, 2048))) return;

  const contentType = response.headers.get("content-type") ?? "unknown";
  const preview = text.slice(0, 80).replace(/\s+/g, " ").trim();
  throw new Error(
    `Response was not an iCalendar document (content-type: ${contentType}). ` +
      `Existing events were left untouched. First bytes: ${preview}`,
  );
}

/**
 * Parse raw iCalendar text into window-scoped events. Split out of
 * `fetchIcsCalendar` so the CalDAV path can reuse the exact same parsing
 * and recurrence expansion on the bodies a `calendar-query` REPORT
 * returns — the transport differs, the VEVENT semantics don't.
 */
export function parseIcsEvents(
  text: string,
  window: IcsWindow = icsSyncWindow(),
): IcsEvent[] {
  return expandToWindow(ical.sync.parseICS(text), window);
}

function expandToWindow(
  parsed: ical.CalendarResponse,
  { start: windowStart, end: windowEnd }: IcsWindow,
): IcsEvent[] {
  const out: IcsEvent[] = [];

  for (const key of Object.keys(parsed)) {
    const component = parsed[key];
    if (!component || component.type !== "VEVENT") continue;

    const ev = component as ical.VEvent;

    if (ev.rrule) {
      // Use the library's expandRecurringEvent for proper RRULE + EXDATE + RECURRENCE-ID handling
      const instances = ical.expandRecurringEvent(ev, {
        from: windowStart,
        to: windowEnd,
        includeOverrides: true,
        excludeExdates: true,
      });

      // Cap at 200 instances per calendar to bound runtime
      const capped = instances.slice(0, 200);
      for (const instance of capped) {
        const mapped = mapInstance(instance);
        if (mapped) out.push(mapped);
      }
    } else {
      // Non-recurring event: check window manually
      const start = ev.start;
      if (!start) continue;
      const startDate = start instanceof Date ? start : new Date(String(start));
      if (startDate < windowStart || startDate > windowEnd) continue;

      const end = ev.end;
      const endDate = end instanceof Date ? end : (end ? new Date(String(end)) : startDate);

      out.push({
        uid: ev.uid,
        title: extractString(ev.summary) ?? "(untitled)",
        description: extractString(ev.description) ?? null,
        location: extractString(ev.location) ?? null,
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        all_day: ev.datetype === "date",
      });
    }
  }

  return out;
}

function mapInstance(instance: ical.EventInstance): IcsEvent | null {
  const start = instance.start instanceof Date
    ? instance.start
    : new Date(String(instance.start));
  const end = instance.end instanceof Date
    ? instance.end
    : (instance.end ? new Date(String(instance.end)) : start);

  const ev = instance.event;

  return {
    uid: `${ev.uid}__${start.toISOString()}`,
    title: extractString(instance.summary) ?? extractString(ev.summary) ?? "(untitled)",
    description: extractString(ev.description) ?? null,
    location: extractString(ev.location) ?? null,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    all_day: instance.isFullDay,
  };
}

/** node-ical ParameterValue can be a plain string or an object with val property */
function extractString(
  value: ical.ParameterValue | string | undefined | null
): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  // ParameterValue object shape: { val: string, params?: Record<string,string> }
  const v = (value as { val?: string }).val;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  return null;
}
