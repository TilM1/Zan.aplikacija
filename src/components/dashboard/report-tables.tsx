import { Card, CardHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatEur } from "@/lib/money";
import { formatMonth } from "@/lib/dates";
import type { PolicyAgg } from "@/server/queries/metrics";

export function AggTable({ title, description, rows, keyLabel, extra }: {
  title: string;
  description?: string;
  rows: { key: string; label: string; agg: PolicyAgg; extra?: (string | number)[] }[];
  keyLabel: string;
  extra?: string[];
}) {
  const total = rows.reduce((a, r) => ({ count: a.count + r.agg.count, premiumCents: a.premiumCents + r.agg.premiumCents }), { count: 0, premiumCents: 0 });
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">Ni podatkov za izbrano obdobje.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{keyLabel}</TH>
              {extra?.map((e) => (
                <TH key={e} className="text-right">
                  {e}
                </TH>
              ))}
              <TH className="text-right">Police</TH>
              <TH className="text-right">Mesečna premija</TH>
              <TH className="text-right">Letna premija</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.key}>
                <TD className="capitalize">{r.label}</TD>
                {r.extra?.map((v, i) => (
                  <TD key={i} className="text-right tabular">
                    {v}
                  </TD>
                ))}
                <TD className="text-right tabular">{r.agg.count}</TD>
                <TD className="text-right font-medium tabular">{formatEur(r.agg.premiumCents)}</TD>
                <TD className="text-right text-ink-2 tabular">{formatEur(r.agg.premiumCents * 12)}</TD>
              </TR>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-subtle/60 font-medium">
              <TD>Skupaj</TD>
              {extra?.map((e) => <TD key={e} />)}
              <TD className="text-right tabular">{total.count}</TD>
              <TD className="text-right tabular">{formatEur(total.premiumCents)}</TD>
              <TD className="text-right tabular">{formatEur(total.premiumCents * 12)}</TD>
            </tr>
          </tfoot>
        </Table>
      )}
    </Card>
  );
}

export function monthRows(byMonth: Map<string, PolicyAgg>) {
  return [...byMonth.keys()].sort().reverse().map((m) => ({ key: m, label: formatMonth(`${m}-01`), agg: byMonth.get(m)! }));
}
