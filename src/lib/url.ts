export type SearchParams = Record<string, string | string[] | undefined>;

export function param(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s === "" ? undefined : s;
}

export function pageParam(sp: SearchParams): number {
  const n = Number(param(sp, "page") ?? 1);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Build a URL from current params with a patch (undefined/"" removes a key). */
export function hrefWith(path: string, sp: SearchParams, patch: Record<string, string | number | undefined>): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) next.set(k, s);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") next.delete(k);
    else next.set(k, String(v));
  }
  const q = next.toString();
  return q ? `${path}?${q}` : path;
}

export const isUuid = (v: string | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
