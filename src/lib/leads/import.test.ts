import { describe, expect, it } from "vitest";
import { chunkRows, detectMapping, guessPersonName, toLeadRows } from "./import";
import { normalizePhone, formatPhone } from "@/lib/phone";

// Headers and rows as in the owner's spreadsheet
const headers = ["Datum vpisa", "Naziv dolgi", "Gsm", "SN Ulica in št.", "KOMENTAR", "DATUM", "SN Pošta št.", "SN Pošta", "Dejavnost", "Davčna št.", "Email", "Boniteta plačil", "Fin. leto", "Povp. mes. plača", "Povp. št. zap."];
const rows = [
  [new Date("2026-04-05"), "PIA MRŠEK, SAMOSTOJNA DELAVKA V KULTURI", 38631443031, "ČEBELARSKA ULICA 26", null, null, 1000, "LJUBLJANA", "Oblikovanje industrijskih izdelkov", "n/a", "piamrsek@gmail.com", "NN", "n/a", 0, 0],
  [new Date("2026-04-03"), "ROK KETE - SAMOSTOJNI DELAVEC V KULTURI", 38640570579, "TRSTENJAKOVA ULICA 1A", null, null, 1000, "LJUBLJANA", "Arhitekturno projektiranje", 33961409, "rok.kete@gmail.com", "NN", "n/a", 1, 0],
  [new Date("2026-03-18"), "KURIRSKA DOSTAVA, ALBIAS PIRKUQI S.P.", 38671215084, "POT RDEČEGA KRIŽA 30", null, null, 1000, "LJUBLJANA", "Druga poštna in kurirska dejavnost", 12888273, "n/a", "NN", "n/a", 8, 0],
];

describe("call list import", () => {
  it("detects the columns of the owner's spreadsheet", () => {
    const m = detectMapping(headers, rows);
    expect(m).toMatchObject({ name: 1, phone: 2, street: 3, postal_code: 6, city: 7, activity: 8, tax_number: 9, email: 10 });
  });

  it("converts rows and keeps every other column in extra", () => {
    const m = detectMapping(headers, rows);
    const out = toLeadRows(headers, rows, m);
    expect(out[0]).toMatchObject({ row_number: 2, name: "PIA MRŠEK, SAMOSTOJNA DELAVKA V KULTURI", phone: "38631443031", postal_code: "1000", city: "LJUBLJANA", tax_number: null, email: "piamrsek@gmail.com" });
    expect(out[0].extra).toMatchObject({ "Datum vpisa": "2026-04-05", "Boniteta plačil": "NN", "Povp. mes. plača": "0" });
    expect(out[2].email).toBeNull(); // "n/a" treated as empty
    expect(out[1].tax_number).toBe("33961409");
    // Excel serial number in a date column → real date
    const serial = toLeadRows(headers, [[46115.318, "X, Y Z S.P.", 38631000000]], m)[0];
    expect(serial.extra["Datum vpisa"]).toBe("2026-04-03");
  });

  it("guesses the person behind sole-proprietor names", () => {
    expect(guessPersonName("PIA MRŠEK, SAMOSTOJNA DELAVKA V KULTURI")).toEqual({ first_name: "Pia", last_name: "Mršek" });
    expect(guessPersonName("KURIRSKA DOSTAVA, ALBIAS PIRKUQI S.P.")).toEqual({ first_name: "Albias", last_name: "Pirkuqi" });
    expect(guessPersonName("UREJANJE OKOLICE, MIHA POGAČAR S.P.")).toEqual({ first_name: "Miha", last_name: "Pogačar" });
    expect(guessPersonName("CREATIVE STUDIO, OGLAŠEVALSKE STORITVE")).toBeNull();
  });

  it("chunks by row count and size", () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ i, pad: "x".repeat(100) }));
    const chunks = chunkRows(many, 1000, 700_000);
    expect(chunks.map((c) => c.length)).toEqual([1000, 1000, 500]);
    const big = chunkRows(many, 1000, 50_000);
    expect(big.every((c) => JSON.stringify(c).length <= 60_000)).toBe(true);
  });
});

describe("phone normalisation (must match SQL crm_normalize_phone)", () => {
  it.each([
    ["38631443031", "+38631443031"],
    ["041 123 456", "+38641123456"],
    ["+386 41 123 456", "+38641123456"],
    ["0038641123456", "+38641123456"],
    ["01 234 56 78", "+38612345678"],
    ["", null],
  ])("%s → %s", (input, out) => expect(normalizePhone(input)).toBe(out));
  it("formats for display", () => expect(formatPhone("+38631443031")).toBe("+386 31 443 031"));
});
