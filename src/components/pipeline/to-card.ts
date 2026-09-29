import type { AppointmentWithRelations, Profile } from "@/types/domain";
import { nameOf } from "@/server/queries/people";
import type { PipelineCard } from "./types";

export function toPipelineCard(a: AppointmentWithRelations, people: Map<string, Profile>, viewer: Profile): PipelineCard {
  const isOwner = viewer.role === "owner";
  return {
    id: a.id,
    customerId: a.customer_id,
    customerName: `${a.customer.first_name} ${a.customer.last_name}`,
    phone: a.customer.phone,
    location: a.location,
    postalCode: a.postal_code,
    city: a.customer.city,
    scheduledAt: a.scheduled_at,
    durationMinutes: a.duration_minutes,
    status: a.status,
    result: a.result,
    visitNumber: a.visit_number,
    agentId: a.agent_id,
    agentName: nameOf(people, a.agent_id),
    callerName: a.caller_id ? nameOf(people, a.caller_id) : null,
    hasCaller: !!a.caller_id,
    note: a.note,
    canRecord: a.status === "scheduled" && (isOwner || a.agent_id === viewer.id),
    canEdit: a.status === "scheduled" && (isOwner || a.agent_id === viewer.id || (viewer.role === "caller" && (a.caller_id === viewer.id || a.created_by === viewer.id))),
  };
}
