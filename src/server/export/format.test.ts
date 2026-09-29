import { describe, expect, it } from "vitest";
import { neutraliseFormula, toCsv } from "./format";

describe("CSV export", () => {
  it("quotes separators and escapes quotes", () => {
    expect(toCsv([{ a: 'x,"y"', b: 1 }])).toBe('﻿a,b\r\n"x,""y""",1');
  });
  it("keeps phone numbers and amounts intact", () => {
    expect(neutraliseFormula("+386 41 123 456")).toBe("+386 41 123 456");
    expect(neutraliseFormula("-12.50")).toBe("-12.50");
    expect(neutraliseFormula("1200.00")).toBe("1200.00");
  });
  it("neutralises formula injection", () => {
    expect(neutraliseFormula("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(neutraliseFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutraliseFormula("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
  });
  it("serialises JSON objects", () => {
    expect(toCsv([{ j: { k: 1 } }])).toContain('"{""k"":1}"');
  });
});
