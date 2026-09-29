import type { AppointmentStatus, ConsultationResult } from "@/types/domain";

/** Compact, serialisable appointment card for client components. */
export interface PipelineCard {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  location: string;
  postalCode: string | null;
  city: string | null;
  scheduledAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  result: ConsultationResult | null;
  visitNumber: number;
  agentId: string;
  agentName: string;
  callerName: string | null;
  callerId: string | null;
  note: string | null;
  canRecord: boolean;
  canEdit: boolean;
}
