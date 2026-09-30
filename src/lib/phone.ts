/**
 * Phone normalisation — MUST match public.crm_normalize_phone in the database.
 * 041 123 456 / 38641123456 / 0038641123456 / +386 41 123 456 → +38641123456
 */
export function normalizePhone(input: string | number | null | undefined): string | null {
  let s = String(input ?? "").replace(/[^0-9+]/g, "");
  s = s.replace(/(?!^)\+/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  else if (s.startsWith("386") && s.length >= 10) s = "+" + s;
  else if (s.startsWith("0") && s.length >= 8) s = "+386" + s.slice(1);
  return s === "" ? null : s;
}

/** +38641123456 → +386 41 123 456 (display only) */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "–";
  const m = /^\+386(\d{2})(\d{3})(\d{3,4})$/.exec(value);
  return m ? `+386 ${m[1]} ${m[2]} ${m[3]}` : value;
}
