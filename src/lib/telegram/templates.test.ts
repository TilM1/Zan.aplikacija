import { describe, expect, it } from "vitest";
import { matchProduct, parseDate, parseTemplate, templateFor, validateTemplate } from "./templates";

const NOW = new Date("2026-11-13T10:00:00Z");

describe("templates", () => {
  it("a blank template parses back to empty fields", () => {
    for (const c of ["novastranka", "novapolica", "dodajpolico"] as const) {
      const p = parseTemplate(templateFor(c));
      expect(p?.command).toBe(c);
      expect(p?.unknown).toEqual([]);
      expect(Object.values(p!.fields).every((v) => v === "")).toBe(true);
    }
  });

  it("ignores text that is not a template", () => {
    expect(parseTemplate("živjo")).toBeNull();
    expect(parseTemplate("#neznano\nIme: X")).toBeNull();
    expect(parseTemplate("")).toBeNull();
  });

  it("parses a filled /novastranka with loose spelling and a multi-line note", () => {
    const p = parseTemplate(`  #NovaStranka
ime: Janez
PRIIMEK:   Novak
Tel: 041 123 456
E-posta: Janez@Mail.SI
Posta: 1000
Kraj: Ljubljana
Opomba: Zanima ga zavarovanje
pokliči po 17h
Nekaj: drugo`);
    expect(p?.command).toBe("novastranka");
    expect(p?.fields).toMatchObject({ first_name: "Janez", last_name: "Novak", phone: "041 123 456", postal_code: "1000", note: "Zanima ga zavarovanje\npokliči po 17h\nNekaj: drugo" });
    const v = validateTemplate(p!, NOW);
    expect(v.ok && v.input.command === "novastranka" && v.input.data.email).toBe("janez@mail.si");
  });

  it("reports missing and invalid fields in Slovenian", () => {
    const v = validateTemplate(parseTemplate("#novastranka\nIme: \nPriimek: Kos\nTelefon: abc\nPošta: 10")!, NOW);
    expect(v).toEqual({
      ok: false,
      errors: ["Ime: Ime je obvezno polje.", "Telefon: Vnesite veljavno telefonsko številko.", "Pošta: Poštna številka ima 4 števke."],
    });
  });

  it("validates /novapolica money, years and date", () => {
    const p = parseTemplate(`#novapolica
Ime: Ana
Priimek: Kovač
Telefon: 031 222 333
Produkt: bonus
Mesečna premija: 45,50 €
Trajanje (let): 20 let
Datum police: 5. 10. 2026
Številka police: 123/45`)!;
    const v = validateTemplate(p, NOW);
    expect(v.ok).toBe(true);
    if (v.ok && v.input.command === "novapolica") {
      expect(v.input.data).toMatchObject({ product: "bonus", monthly_premium: "45.50", duration_years: 20, policy_date: "2026-10-05", policy_number: "123/45" });
    }
    const bad = validateTemplate(parseTemplate("#dodajpolico\nTelefon: 031 222 333\nProdukt: x\nMesečna premija: 0\nTrajanje (let): pol\nDatum police: 31.2.2026")!, NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.split(":")[0])).toEqual(["Mesečna premija", "Trajanje (let)", "Datum police"]);
  });

  it("empty policy date means today (Ljubljana)", () => {
    expect(parseDate("", NOW)).toBe("2026-11-13");
    expect(parseDate("danes", NOW)).toBe("2026-11-13");
    expect(parseDate("2026-01-31")).toBe("2026-01-31");
    expect(parseDate("1.1.2026.")).toBe("2026-01-01");
    expect(parseDate("32.1.2026")).toBeNull();
  });

  it("thousands separator in premium", () => {
    const v = validateTemplate(parseTemplate("#dodajpolico\nTelefon: 031 222 333\nProdukt: x\nMesečna premija: 1.200,00\nTrajanje: 10")!, NOW);
    expect(v.ok && v.input.command === "dodajpolico" && v.input.data.monthly_premium).toBe("1200.00");
  });
});

describe("matchProduct", () => {
  const products = [
    { id: "1", name: "Moj življenjski bonus" },
    { id: "2", name: "Življenjsko zavarovanje" },
    { id: "3", name: "Nezgodno" },
  ];
  it("exact, then unique partial, ignoring case and diacritics", () => {
    expect(matchProduct("nezgodno", products)).toEqual({ product: products[2] });
    expect(matchProduct("bonus", products)).toEqual({ product: products[0] });
    expect(matchProduct("zivljenj", products)).toEqual({ candidates: [products[0], products[1]] });
    expect(matchProduct("avto", products)).toEqual({ candidates: products });
  });
});
