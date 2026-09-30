import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { isUuid, param } from "@/lib/url";
import { guessPersonName } from "@/lib/leads/import";
import { PageHeader } from "@/components/ui/misc";
import { NewAppointmentForm, type AppointmentPrefill } from "@/components/appointments/new-appointment-form";
import { getAgents, getCallers, toOptions } from "@/server/queries/people";
import { getLeadWithHistory } from "@/server/queries/leads";

export const metadata: Metadata = { title: "Nov termin" };

const titleCase = (s: string | null) => (s ? s.toLowerCase().replace(/(^|\s|-)\p{L}/gu, (m) => m.toUpperCase()) : "");

export default async function NewAppointmentPage({ searchParams }: PageProps<"/appointments/new">) {
  const { profile } = await requireSession(["owner", "caller", "agent"]);
  const sp = await searchParams;
  const leadId = param(sp, "lead");
  const [agents, callers, leadRes] = await Promise.all([getAgents(), getCallers(), isUuid(leadId) ? getLeadWithHistory(leadId) : Promise.resolve(null)]);

  let prefill: AppointmentPrefill | undefined;
  if (leadRes && leadRes.lead.status !== "appointment") {
    const l = leadRes.lead;
    const person = guessPersonName(l.name);
    prefill = {
      leadId: l.id,
      leadName: l.name,
      customer: {
        first_name: person?.first_name ?? "",
        last_name: person?.last_name ?? "",
        phone: l.phone_normalized,
        email: l.email ?? "",
        address: titleCase(l.street),
        postal_code: l.postal_code ?? "",
        city: titleCase(l.city),
      },
      note: [`Podjetje: ${l.name}`, l.activity && `Dejavnost: ${l.activity}`, l.tax_number && `Davčna: ${l.tax_number}`, l.last_comment && `Komentar klicatelja: ${l.last_comment}`]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return (
    <>
      <PageHeader title="Nov termin" description="Vnesite stranko, ko je termin s stranko potrjen. Termin se takoj prikaže izbranemu zastopniku." />
      <NewAppointmentForm agents={toOptions(agents)} callers={toOptions(callers)} isOwner={profile.role === "owner"} prefill={prefill} />
    </>
  );
}
