/**
 * Builds an iCalendar (.ics) invitation for one appointment (RFC 5545 / iTIP).
 * METHOD:REQUEST creates or updates the event in the recipient's calendar,
 * METHOD:CANCEL removes it. The same UID + a higher SEQUENCE means "update".
 * Pure and tested.
 */
export interface InviteEvent {
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  /** ISO instants */
  start: string;
  end: string;
  summary: string;
  description: string;
  location: string;
  organizer: { name: string; email: string };
  attendee: { name: string; email: string };
  /** When this message was produced (ISO). */
  stamp: string;
}

const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets must be folded (continuation lines start with a space). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const cn = (s: string) => `"${s.replace(/"/g, "")}"`;

export function buildInviteIcs(e: InviteEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//CoreMark CRM//SL",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.method}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${utc(e.stamp)}`,
    `DTSTART:${utc(e.start)}`,
    `DTEND:${utc(e.end)}`,
    `SUMMARY:${esc(e.summary)}`,
    `LOCATION:${esc(e.location)}`,
    `DESCRIPTION:${esc(e.description)}`,
    `ORGANIZER;CN=${cn(e.organizer.name)}:mailto:${e.organizer.email}`,
    `ATTENDEE;CN=${cn(e.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${e.attendee.email}`,
    `STATUS:${e.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    ...(e.method === "REQUEST" ? ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Termin", "TRIGGER:-PT30M", "END:VALARM"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
