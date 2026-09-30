import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { formatDate, formatDateTime, todayIso } from "@/lib/dates";
import { formatDecimalEur } from "@/lib/money";
import { isUuid } from "@/lib/url";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, KeyValue, PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { CommissionBreakdown } from "@/components/payroll/commission-breakdown";
import { PolicyUpload } from "@/components/policies/policy-upload";
import { StornoButton } from "@/components/storno/storno-dialogs";
import { sumDecimals } from "@/lib/money";
import { getPolicyDetail } from "@/server/queries/policies";
import { getPeople, nameOf } from "@/server/queries/people";

export const metadata: Metadata = { title: "Polica" };

export default async function PolicyPage({ params }: PageProps<"/policies/[id]">) {
  const { profile } = await requireSession(["owner", "agent"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [detail, people] = await Promise.all([getPolicyDetail(id), getPeople()]);
  if (!detail) notFound();
  const { policy, commissions, documents } = detail;
  const who = (pid: string | null) => nameOf(people, pid);
  const today = todayIso();

  return (
    <>
      <PageHeader
        title={`${policy.product_name}${policy.policy_number ? ` · ${policy.policy_number}` : ""}`}
        description={
          <Link href={`/customers/${policy.customer.id}`} className="hover:text-brand hover:underline">
            {policy.customer.first_name} {policy.customer.last_name}
          </Link>
        }
        actions={
          policy.status === "cancelled" ? (
            <Badge tone="danger">Stornirana</Badge>
          ) : (
            <>
              <Badge tone="success">Aktivna</Badge>
              {profile.role === "owner" && (
                <StornoButton
                  size="md"
                  policyId={policy.id}
                  label={`${policy.product_name} · ${formatDecimalEur(policy.monthly_premium)}/mes.`}
                  preview={{
                    rows: commissions.map((c) => ({
                      name: who(c.beneficiary_id),
                      type: c.beneficiary_type,
                      unpaid: sumDecimals(c.installments.filter((i) => i.kind === "regular" && i.status === "scheduled").map((i) => i.amount)),
                      paid: sumDecimals(c.installments.filter((i) => i.kind === "regular" && i.status === "paid").map((i) => i.paid_amount ?? i.amount)),
                    })),
                  }}
                />
              )}
            </>
          )
        }
      />
      {policy.status === "cancelled" && (
        <div className="mb-4 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
          <b>Polica je stornirana</b> {policy.cancelled_at ? `(${formatDate(policy.cancelled_at)})` : ""}. Razlog: {policy.cancel_reason ?? "–"}. Neizplačane provizije so preklicane, že
          izplačane se odbijejo pri naslednjem izplačilu.
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          {commissions.length === 0 ? (
            <Card>
              <EmptyState title="Podatki o proviziji niso vidni" description="Provizije vidijo samo prejemnik in lastnik." />
            </Card>
          ) : (
            commissions
              .sort((a, b) => a.beneficiary_type.localeCompare(b.beneficiary_type))
              .map((c) => <CommissionBreakdown key={c.id} commission={c} beneficiaryName={who(c.beneficiary_id)} today={today} />)
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Podatki police" />
            <div className="p-4">
              <KeyValue
                className="sm:grid-cols-1"
                items={[
                  { label: "Mesečna premija", value: formatDecimalEur(policy.monthly_premium) },
                  { label: "Trajanje", value: `${policy.duration_years} let` },
                  { label: "Datum police", value: formatDate(policy.policy_date) },
                  { label: "Zastopnik (prodaja)", value: who(policy.agent_id) },
                  { label: "Klicatelj (izvor)", value: policy.caller_id ? who(policy.caller_id) : "–" },
                  { label: "Vneseno", value: formatDateTime(policy.created_at) },
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Dokumenti" />
            {documents.length === 0 ? (
              <div className="px-4 py-3 text-sm text-warning">Podpisana polica še ni naložena (priporočeno).</div>
            ) : (
              <ul className="divide-y divide-line">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                    <FileText className="size-4 text-ink-3" />
                    <a href={`/api/documents/${d.id}`} target="_blank" className="min-w-0 flex-1 truncate hover:text-brand hover:underline">
                      {d.file_name}
                    </a>
                    <span className="text-xs text-ink-3">{formatDate(d.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            {(profile.role === "owner" || policy.agent_id === profile.id) && (
              <div className="border-t border-line p-3">
                <PolicyUpload customerId={policy.customer.id} policyId={policy.id} />
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
