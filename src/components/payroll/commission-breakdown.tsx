import { Card, CardHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { InstallmentStatusBadge } from "@/components/ui/status";
import { BENEFICIARY_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDecimalEur } from "@/lib/money";
import { displayStatus } from "@/lib/payroll";
import type { Commission, Installment } from "@/types/domain";

/** Explains exactly how a commission was calculated, from its snapshot. */
export function CommissionBreakdown({ commission, beneficiaryName, today }: { commission: Commission & { installments: Installment[] }; beneficiaryName: string; today: string }) {
  const calc = commission.calculation as Record<string, unknown>;
  const installments = [...commission.installments].sort((a, b) => a.installment_number - b.installment_number);
  const cancelled = commission.status === "cancelled";
  return (
    <Card>
      <CardHeader
        title={`Provizija – ${BENEFICIARY_LABELS[commission.beneficiary_type]}: ${beneficiaryName}${cancelled ? " (stornirano)" : ""}`}
        description={`Pravila ${commission.rule_version} · obračunano ${formatDateTime(commission.created_at)}`}
        actions={<span className="text-base font-semibold tabular">{formatDecimalEur(commission.total_amount)}</span>}
      />
      <div className="border-b border-line bg-subtle/50 px-4 py-2.5 text-sm">
        <p className="font-mono text-[13px]">
          {String(calc.expression ?? "")} = <b>{formatDecimalEur(commission.total_amount)}</b>
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          {commission.beneficiary_type === "agent" && commission.calc_model === "agent_multiplier"
            ? `Mesečna premija × število zastopnika za ta produkt ob prodaji (${Number(commission.agent_multiplier).toLocaleString("sl-SI")}), izplačilo v 11 mesečnih obrokih`
            : commission.beneficiary_type === "agent"
            ? `Mesečna premija × 12 × trajanje (${commission.base_duration_years} let) × odstotek zastopnika ob prodaji (${Number(commission.rate_percent).toFixed(2)} %)`
            : `Mesečna premija × faktor klicatelja ob prodaji (${Number(commission.caller_multiplier).toLocaleString("sl-SI")}) – enkratno, izplačano skupaj s 1. obrokom zastopnika`}
          {" · "}datum police {formatDate(commission.policy_date)}
        </p>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>Obrok</TH>
            <TH className="text-right">Delež</TH>
            <TH className="text-right">Znesek</TH>
            <TH>Zapadlost</TH>
            <TH>Status</TH>
            <TH>Izplačano</TH>
          </tr>
        </THead>
        <tbody>
          {installments.map((i) => (
            <TR key={i.id}>
              <TD>{i.kind === "clawback" ? <span className="font-semibold text-danger">Storno odbitek</span> : `${i.installment_number}.`}</TD>
              <TD className="text-right tabular">{i.kind === "clawback" ? "–" : `${Number(i.share_percent)} %`}</TD>
              <TD className={`text-right font-medium tabular ${Number(i.amount) < 0 ? "text-danger" : ""}`}>{formatDecimalEur(i.amount)}</TD>
              <TD className="tabular">
                {formatDate(i.due_date)}
                {i.due_date !== i.original_due_date && <span className="ml-1 text-xs text-ink-3">(prvotno {formatDate(i.original_due_date)})</span>}
              </TD>
              <TD>
                <InstallmentStatusBadge status={displayStatus(i, today)} />
              </TD>
              <TD className="text-ink-2 tabular">{i.paid_at ? formatDate(i.paid_at) : "–"}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
