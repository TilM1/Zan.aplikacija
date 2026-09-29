import { Card, CardHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatMonth } from "@/lib/dates";
import { formatEur, sumDecimals } from "@/lib/money";
import type { InstallmentLite } from "@/server/queries/payroll";

export function summarize(rows: InstallmentLite[], today: string) {
  const unpaid = rows.filter((r) => r.status === "scheduled");
  const due = unpaid.filter((r) => r.due_date <= today);
  const future = unpaid.filter((r) => r.due_date > today);
  const nextDate = future.map((r) => r.due_date).sort()[0] ?? null;
  return {
    dueCents: sumDecimals(due.map((r) => r.amount)),
    futureCents: sumDecimals(future.map((r) => r.amount)),
    unpaidCents: sumDecimals(unpaid.map((r) => r.amount)),
    nextDate,
    nextCents: nextDate ? sumDecimals(future.filter((r) => r.due_date === nextDate).map((r) => r.amount)) : 0,
  };
}

export function ByMonthCard({ rows, title = "Izplačila po mesecih" }: { rows: InstallmentLite[]; title?: string }) {
  const byMonth = new Map<string, { agent: number; caller: number }>();
  for (const r of rows) {
    const k = r.due_date.slice(0, 7) + "-01";
    const cur = byMonth.get(k) ?? { agent: 0, caller: 0 };
    cur[r.beneficiary_type] += sumDecimals([r.amount]);
    byMonth.set(k, cur);
  }
  const months = [...byMonth.keys()].sort().slice(0, 18);
  return (
    <Card>
      <CardHeader title={title} description="Neizplačana načrtovana izplačila" />
      {months.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">Ni načrtovanih izplačil.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Mesec</TH>
              <TH className="text-right">Zastopniki</TH>
              <TH className="text-right">Klicatelji</TH>
              <TH className="text-right">Skupaj</TH>
            </tr>
          </THead>
          <tbody>
            {months.map((m) => {
              const v = byMonth.get(m)!;
              return (
                <TR key={m}>
                  <TD className="capitalize">{formatMonth(m)}</TD>
                  <TD className="text-right tabular">{formatEur(v.agent)}</TD>
                  <TD className="text-right tabular">{formatEur(v.caller)}</TD>
                  <TD className="text-right font-medium tabular">{formatEur(v.agent + v.caller)}</TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function ByEmployeeCard({ rows, names, today }: { rows: InstallmentLite[]; names: Record<string, string>; today: string }) {
  const by = new Map<string, { due: number; future: number }>();
  for (const r of rows) {
    const cur = by.get(r.beneficiary_id) ?? { due: 0, future: 0 };
    cur[r.due_date <= today ? "due" : "future"] += sumDecimals([r.amount]);
    by.set(r.beneficiary_id, cur);
  }
  const ids = [...by.keys()].sort((a, b) => by.get(b)!.due + by.get(b)!.future - (by.get(a)!.due + by.get(a)!.future));
  return (
    <Card>
      <CardHeader title="Obveznosti po zaposlenih" description={`Stanje na dan ${formatDate(today)}`} />
      {ids.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">Ni obveznosti.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Zaposleni</TH>
              <TH className="text-right">Zapadlo</TH>
              <TH className="text-right">Prihodnje</TH>
            </tr>
          </THead>
          <tbody>
            {ids.map((id) => (
              <TR key={id}>
                <TD>{names[id] ?? "–"}</TD>
                <TD className="text-right tabular text-warning">{by.get(id)!.due ? formatEur(by.get(id)!.due) : "–"}</TD>
                <TD className="text-right tabular">{formatEur(by.get(id)!.future)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
