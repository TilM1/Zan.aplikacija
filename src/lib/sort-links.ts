import { hrefWith, type SearchParams } from "@/lib/url";

/** Prebuilt asc/desc links per column (for client components, which cannot receive functions). */
export function buildSortHrefs(path: string, sp: SearchParams, columns: readonly string[]) {
  return Object.fromEntries(
    columns.map((c) => [c, { asc: hrefWith(path, sp, { sort: c, page: undefined }), desc: hrefWith(path, sp, { sort: `-${c}`, page: undefined }) }]),
  ) as Record<string, { asc: string; desc: string }>;
}
