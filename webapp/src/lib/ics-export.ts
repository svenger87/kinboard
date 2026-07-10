// Outbound ICS generator (Milestone C Task 2). Hand-rolled — node-ical
// (already a dependency) is parse-only, no serializer. RFC 5545:
// CRLF line endings, 75-octet line folding, and escaping for
// backslash/semicolon/comma/newline in TEXT values.

export interface ExportEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
}

const CRLF = "\r\n";
const MAX_OCTETS = 75;

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Recovers the wall-clock calendar day (in `timeZone`) for an ISO instant,
// as { y, m, d } (m is 1-indexed, matching Date.UTC's month+1 convention
// used by callers). All-day events store LOCAL midnight/23:59:59.999
// converted to UTC (see calendar/page.tsx handleAddEvent: startOfDay /
// endOfDay then toISOString) — extracting the UTC day directly shifts the
// date by the household's UTC offset. Intl with an explicit timeZone
// recovers the correct local day regardless of server TZ.
function localDayParts(iso: string, timeZone: string): { y: number; m: number; d: number } {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  const [y, m, d] = formatted.split("-").map(Number);
  return { y, m, d };
}

// allDay → YYYYMMDD (used with VALUE=DATE) in the household timeZone,
// else UTC YYYYMMDDTHHMMSSZ (timed events are unambiguous instants and
// keep their current UTC serialization).
function icsDate(iso: string, allDay: boolean, timeZone: string): string {
  const d = new Date(iso);
  if (allDay) {
    const { y, m, d: day } = localDayParts(iso, timeZone);
    return `${y}${pad(m)}${pad(day)}`;
  }
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const da = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const se = pad(d.getUTCSeconds());
  return `${y}${mo}${da}T${h}${mi}${se}Z`;
}

// Local day of `iso` (in `timeZone`) plus one day, as YYYYMMDD.
// Date.UTC normalizes day-of-month overflow (e.g. day 31 in a 30-day
// month) into the correct next month/year, so this is safe across
// month/year boundaries without manual carry logic.
function localDayPlusOne(iso: string, timeZone: string): string {
  const { y, m, d } = localDayParts(iso, timeZone);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

// RFC 5545 §3.1: fold at 75 octets (of the UTF-8 encoding, not chars) by
// inserting CRLF + a single leading space before the continuation. The
// leading space itself counts against the 75-octet budget of the
// continuation line, so continuation chunks get a 74-octet content budget.
// Iterates by Unicode code point (not UTF-16 code unit) so a surrogate
// pair is never split across a fold boundary.
function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= MAX_OCTETS) return line;

  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = MAX_OCTETS;

  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (currentBytes + chBytes > limit) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
      limit = MAX_OCTETS - 1;
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current) chunks.push(current);

  return chunks.join(CRLF + " ");
}

export function buildIcsCalendar(
  events: ExportEvent[],
  calendarName: string,
  timeZone: string
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kinboard//Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ];

  const dtstamp = icsDate(new Date().toISOString(), false, timeZone);

  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@kinboard`);
    lines.push(`DTSTAMP:${dtstamp}`);

    if (event.all_day) {
      // Stored end_at is local 23:59:59.999 of the inclusive last day
      // (see calendar/page.tsx handleAddEvent: endOfDay(endDate) then
      // toISOString); its local day IS the last day, so DTEND is that
      // local day plus one — the RFC 5545 §3.6.1 exclusive end.
      lines.push(`DTSTART;VALUE=DATE:${icsDate(event.start_at, true, timeZone)}`);
      lines.push(`DTEND;VALUE=DATE:${localDayPlusOne(event.end_at, timeZone)}`);
    } else {
      lines.push(`DTSTART:${icsDate(event.start_at, false, timeZone)}`);
      lines.push(`DTEND:${icsDate(event.end_at, false, timeZone)}`);
    }

    lines.push(`SUMMARY:${icsEscape(event.title)}`);
    if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join(CRLF) + CRLF;
}
