import { describe, expect, it } from "vitest";
import { mapSheetRows } from "./sheet-ingest";

// Header and rows as in the owner's "SPECIALISTI" sheet (Facebook lead form)
const headers = [
  "created_time", "za_koga_želite_urediti_hitrejši_dostop?", "ali_trenutno_že_imate_zavarovanje?", "kako_bi_opisali_svojo_trenutno_situacijo?",
  "če_najdemo_primerno_ponudbo", "v_katero_starostno_skupino_spadate?", "full_name", "phone_number", "email", "STATUS", "",
];
const rows = [
  ["2026-09-02T09:05:43+02:00", "samo_zase", "ne,_nimam", "čim_prej", "da,_če_mi_ponudba_ustreza", "50–65_let", "Nurija Dedic", "p:+38631486734", "Nurija.Dedic@gmail.com", "SALES IN PROCESS", "TERMIN"],
  ["2026-09-24T14:15:46-05:00", "za_svojo_družino", "ne,_nimam", "za_zdaj_samo_preverjam_možnosti", "da,_če_mi_ponudba_ustreza", "31–49_let", "Marina Mihalj", "p:+38640774135", "marina@gmail.com", "SE NE JAVI", "SNO 28.9"],
  ["2026-09-26T14:12:34-05:00", "samo_zase", "ne,_nimam", "trenutno_nimam_posebnih_zdravstvenih_težav", "mogoče", "18–30_let", "Maja Božič", "p:00000000000", "majci@gmail.com", "INVALID", ""],
  ["2026-10-09T05:42:56-05:00", "samo_zase", "da,_vendar_nisem_zadovoljen", "imam_nekaj_težav,_vendar_nič_nujnega", "da,_če_mi_ponudba_ustreza", "50–60_let", "Natasa Pregl", "p:+38640166925", "natasa@hotmail.com", "", ""],
  ["", "", "", "", "", "", "", "", "", "", ""],
];

describe("Google Sheet → live call list", () => {
  const out = mapSheetRows(headers, rows);

  it("maps name, phone (without p:), e-mail and submission time", () => {
    expect(out).toHaveLength(4);
    expect(out[3]).toMatchObject({ name: "Natasa Pregl", phone: "+38640166925", email: "natasa@hotmail.com", created_at: "2026-10-09T10:42:56.000Z", skip: false });
  });

  it("keeps the form answers readable and ignores the callers' old notes column", () => {
    expect(out[3].extra).toEqual({
      "Za koga želite urediti hitrejši dostop?": "Samo zase",
      "Ali trenutno že imate zavarovanje?": "Da, vendar nisem zadovoljen",
      "Kako bi opisali svojo trenutno situacijo?": "Imam nekaj težav, vendar nič nujnega",
      "Če najdemo primerno ponudbo": "Da, če mi ponudba ustreza",
      "V katero starostno skupino spadate?": "50–60 let",
    });
    expect(Object.values(out[1].extra)).not.toContain("SNO 28.9");
  });

  it("skips SALES IN PROCESS and INVALID; SE NE JAVI and empty come in as fresh", () => {
    expect(out.map((r) => r.skip)).toEqual([true, false, true, false]);
  });

  it("gives every sheet row a stable key (processed once)", () => {
    expect(out[1].source_key).toBe("2026-09-24T14:15:46-05:00|+38640774135|");
    expect(new Set(out.map((r) => r.source_key)).size).toBe(4);
  });
});
