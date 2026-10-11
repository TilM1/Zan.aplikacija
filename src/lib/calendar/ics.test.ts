import { describe, expect, it } from "vitest";
import { buildInviteIcs, type InviteEvent } from "./ics";

const base: InviteEvent = {
  uid: "abc@coremark",
  sequence: 1,
  method: "REQUEST",
  start: "2026-10-15T08:00:00.000Z",
  end: "2026-10-15T09:00:00.000Z",
  summary: "Termin: Jana Novak",
  description: "Telefon: 041 111 222\nOpomba: pozvoni; pri sosedu, 2. nadstropje",
  location: "Čebelarska ulica 26, 1000 Ljubljana",
  organizer: { name: "CoreMark CRM", email: "crm@example.si" },
  attendee: { name: "Marko Test", email: "marko@example.si" },
  stamp: "2026-10-11T10:00:00.000Z",
};

describe("calendar invitation (.ics)", () => {
  it("is a valid request with UTC times, escaped text and CRLF line ends", () => {
    const ics = buildInviteIcs(base);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("DTSTART:20261015T080000Z");
    expect(ics).toContain("DTEND:20261015T090000Z");
    expect(ics).toContain("UID:abc@coremark");
    expect(ics).toContain("LOCATION:Čebelarska ulica 26\\, 1000 Ljubljana");
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:Telefon: 041 111 222\\nOpomba: pozvoni\; pri sosedu\\, 2. nadstropje");
    expect(unfolded).toContain("ATTENDEE;CN=\"Marko Test\";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:marko@example.si");
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("folds long lines to at most 75 bytes", () => {
    const ics = buildInviteIcs({ ...base, description: "č".repeat(200) });
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /g, "")).toContain("č".repeat(200));
  });

  it("cancellation uses the same UID with a higher sequence", () => {
    const ics = buildInviteIcs({ ...base, method: "CANCEL", sequence: 2 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).not.toContain("VALARM");
  });
});
