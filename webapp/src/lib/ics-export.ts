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

// allDay → YYYYMMDD (used with VALUE=DATE), else UTC YYYYMMDDTHHMMSSZ.
function icsDate(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const da = pad(d.getUTCDate());
  if (allDay) return `${y}${mo}${da}`;
  const h = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const se = pad(d.getUTCSeconds());
  return `${y}${mo}${da}T${h}${mi}${se}Z`;
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

export function buildIcsCalendar(events: ExportEvent[], calendarName: string): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kinboard//Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ];

  const dtstamp = icsDate(new Date().toISOString(), false);

  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@kinboard`);
    lines.push(`DTSTAMP:${dtstamp}`);

    if (event.all_day) {
      // Stored end_at is the inclusive last day (see calendar/page.tsx
      // handleAddEvent: endOfDay(endDate)); DTEND must be the exclusive
      // day after, per RFC 5545 §3.6.1.
      const endExclusive = new Date(event.end_at);
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${icsDate(event.start_at, true)}`);
      lines.push(`DTEND;VALUE=DATE:${icsDate(endExclusive.toISOString(), true)}`);
    } else {
      lines.push(`DTSTART:${icsDate(event.start_at, false)}`);
      lines.push(`DTEND:${icsDate(event.end_at, false)}`);
    }

    lines.push(`SUMMARY:${icsEscape(event.title)}`);
    if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join(CRLF) + CRLF;
}
