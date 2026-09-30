import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isValidIsoDate, todayIso, addDays, dayBoundsIso } from "@/lib/dates";
import { EXPORT_DATASETS, type ExportDataset } from "@/server/export/datasets";
import { toCell, toCsv } from "@/server/export/format";

export const runtime = "nodejs";
export const maxDuration = 60;

const DATE_ONLY = new Set(["policy_date", "due_date"]);

async function fetchAll(ds: ExportDataset, from?: string, to?: string) {
  const supabase = await createClient();
  const rows: Record<string, unknown>[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase.from(ds.table).select(ds.select).order(ds.order).range(offset, offset + PAGE - 1);
    if (ds.dateColumn && from) q = q.gte(ds.dateColumn, DATE_ONLY.has(ds.dateColumn) ? from : dayBoundsIso(from).start);
    if (ds.dateColumn && to) q = DATE_ONLY.has(ds.dateColumn) ? q.lte(ds.dateColumn, to) : q.lt(ds.dateColumn, dayBoundsIso(addDays(to, 1)).start);
    const { data, error } = await q;
    if (error) throw error;
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...(ds.flatten ? batch.map(ds.flatten) : batch));
    if (batch.length < PAGE) break;
  }
  return rows;
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: Record<string, unknown>[]) {
  // Excel sheet names: max 31 chars, no * ? : \ / [ ]
  const ws = wb.addWorksheet(name.replace(/[*?:\\/[\]]/g, "-").slice(0, 31));
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }));
  for (const r of rows) ws.addRow(Object.fromEntries(headers.map((h) => [h, typeof r[h] === "object" && r[h] !== null ? toCell(r[h]) : r[h]])));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/**
 * GET /api/export/<dataset|all>?format=csv|xlsx&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Owner only. Reads through RLS (owner sees everything).
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/export/[dataset]">) {
  const session = await getSession();
  if (!session || session.mustChangePassword || session.profile.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { dataset } = await ctx.params;
  const format = req.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const from = req.nextUrl.searchParams.get("from") ?? undefined;
  const to = req.nextUrl.searchParams.get("to") ?? undefined;
  if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to))) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

  const stamp = todayIso();
  const headers = { "Cache-Control": "private, no-store" };

  try {
    if (dataset === "all") {
      const wb = new ExcelJS.Workbook();
      wb.creator = "CoreMark CRM";
      wb.created = new Date();
      for (const ds of EXPORT_DATASETS) addSheet(wb, ds.label, await fetchAll(ds, from, to));
      const buf = await wb.xlsx.writeBuffer();
      return new NextResponse(buf, {
        headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="zan-crm-izvoz-vse-${stamp}.xlsx"` },
      });
    }

    const ds = EXPORT_DATASETS.find((d) => d.key === dataset);
    if (!ds) return NextResponse.json({ error: "Unknown dataset" }, { status: 404 });
    const rows = await fetchAll(ds, from, to);
    const base = `zan-crm-${ds.key}-${stamp}${from || to ? `_${from ?? ""}_${to ?? ""}` : ""}`;

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      addSheet(wb, ds.label, rows);
      const buf = await wb.xlsx.writeBuffer();
      return new NextResponse(buf, {
        headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` },
      });
    }
    return new NextResponse(toCsv(rows), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` },
    });
  } catch (e) {
    console.error("[export] failed", e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
