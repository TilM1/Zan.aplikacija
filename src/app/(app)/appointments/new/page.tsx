import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui/misc";
import { NewAppointmentForm } from "@/components/appointments/new-appointment-form";
import { getAgents, getCallers, toOptions } from "@/server/queries/people";

export const metadata: Metadata = { title: "Nov termin" };

export default async function NewAppointmentPage() {
  const { profile } = await requireSession(["owner", "caller", "agent"]);
  const [agents, callers] = await Promise.all([getAgents(), getCallers()]);
  return (
    <>
      <PageHeader title="Nov termin" description="Vnesite stranko, ko je termin s stranko potrjen. Termin se takoj prikaže izbranemu zastopniku." />
      <NewAppointmentForm agents={toOptions(agents)} callers={toOptions(callers)} isOwner={profile.role === "owner"} />
    </>
  );
}
