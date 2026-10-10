/**
 * Google Apps Script that the owner pastes into the sheet (Razširitve → Apps Script).
 * It only READS the sheet and posts rows to the CRM every minute; nothing is
 * written back. The CRM processes each row exactly once, so resending is safe.
 */
export function buildAppsScript(opts: { origin: string; token: string; tab: string }): string {
  return `/**
 * CoreMark CRM – samodejni prenos novih kontaktov iz te tabele v CRM.
 * 1) Prilepite to kodo (zamenjajte vse, kar je v oknu).
 * 2) Zgoraj izberite funkcijo "namesti" in kliknite "Zaženi" (enkrat).
 * 3) Potrdite dovoljenja z vašim Google računom.
 * Tabela ostane nespremenjena – skripta jo samo bere.
 */
const CRM_URL = ${JSON.stringify(`${opts.origin}/api/leads/ingest`)};
const CRM_TOKEN = ${JSON.stringify(opts.token)};
const ZAVIHEK = ${JSON.stringify(opts.tab)};

function namesti() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("posljiVCrm").timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().deleteProperty("prvicPoslano");
  posljiVCrm();
}

function posljiVCrm() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(ZAVIHEK);
  if (!sheet) throw new Error("Zavihek '" + ZAVIHEK + "' ne obstaja.");
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return;
  const headers = values[0];
  const rows = values.slice(1).filter(function (r) { return r.join("").trim() !== ""; });

  const props = PropertiesService.getScriptProperties();
  var toSend = rows;
  if (props.getProperty("prvicPoslano") === "1" && rows.length > 300) {
    // po prvem prenosu pošiljamo samo začetek in konec tabele (nove vrstice)
    toSend = rows.slice(0, 50).concat(rows.slice(-250));
  }
  for (var i = 0; i < toSend.length; i += 400) {
    const res = UrlFetchApp.fetch(CRM_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + CRM_TOKEN },
      payload: JSON.stringify({ headers: headers, rows: toSend.slice(i, i + 400) }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      throw new Error("CRM je vrnil " + res.getResponseCode() + ": " + res.getContentText());
    }
  }
  props.setProperty("prvicPoslano", "1");
}
`;
}
