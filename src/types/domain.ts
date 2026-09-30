/**
 * Domain row types mirroring supabase/migrations. Numeric money columns arrive
 * from PostgREST as numbers or strings; always normalise with money helpers.
 * (Regenerate full DB types with `npm run db:types` once linked to a project.)
 */
export type Role = "owner" | "agent" | "caller";
export type CustomerStatus = "scheduled" | "callback" | "won" | "lost" | "closed";
export type AppointmentStatus = "scheduled" | "completed" | "cancelled";
export type ConsultationResult = "A" | "A0" | "A1" | "B";
export type FollowupStatus = "open" | "rescheduled" | "closed";
export type InstallmentStatus = "scheduled" | "paid" | "cancelled";
export type DisplayInstallmentStatus = InstallmentStatus | "due";
export type Beneficiary = "agent" | "caller";
export type Numeric = number | string;

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export type PersonRef = Pick<Profile, "id" | "first_name" | "last_name">;

export interface Product {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  address: string;
  postal_code: string;
  city: string | null;
  status: CustomerStatus;
  last_result: ConsultationResult | null;
  responsible_caller_id: string | null;
  current_agent_id: string | null;
  created_by: string;
  archived_at: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerOverview extends Customer {
  consultation_count: number;
  appointment_count: number;
  policy_count: number;
  next_appointment_at: string | null;
}

export interface Appointment {
  id: string;
  customer_id: string;
  agent_id: string;
  caller_id: string | null;
  created_by: string;
  previous_appointment_id: string | null;
  visit_number: number;
  scheduled_at: string;
  duration_minutes: number;
  location: string;
  postal_code: string | null;
  note: string | null;
  status: AppointmentStatus;
  result: ConsultationResult | null;
  result_note: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface AppointmentWithRelations extends Appointment {
  customer: Pick<Customer, "id" | "first_name" | "last_name" | "phone" | "email" | "address" | "postal_code" | "city" | "status">;
  agent: PersonRef | null;
  caller: PersonRef | null;
}

export interface CallerFollowup {
  id: string;
  customer_id: string;
  caller_id: string | null;
  source_appointment_id: string;
  status: FollowupStatus;
  note: string | null;
  resolved_appointment_id: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface Policy {
  id: string;
  customer_id: string;
  appointment_id: string;
  product_id: string;
  product_name: string;
  policy_number: string | null;
  monthly_premium: Numeric;
  duration_years: number;
  policy_date: string;
  agent_id: string;
  caller_id: string | null;
  status: "active" | "cancelled";
  note: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface Commission {
  id: string;
  policy_id: string;
  beneficiary_id: string;
  beneficiary_type: Beneficiary;
  base_monthly_premium: Numeric;
  base_duration_years: number | null;
  rate_percent: Numeric | null;
  caller_multiplier: Numeric | null;
  calc_model: "standard" | "agent_multiplier";
  agent_multiplier: Numeric | null;
  total_amount: Numeric;
  policy_date: string;
  rule_version: string;
  calculation: Record<string, unknown>;
  status: "active" | "cancelled";
  created_at: string;
}

export interface Installment {
  id: string;
  commission_id: string;
  policy_id: string;
  beneficiary_id: string;
  beneficiary_type: Beneficiary;
  installment_number: number;
  /** "clawback" = negative deduction created by a storno */
  kind: "regular" | "clawback";
  reverses_installment_id: string | null;
  share_percent: Numeric;
  amount: Numeric;
  due_date: string;
  original_due_date: string;
  status: InstallmentStatus;
  paid_at: string | null;
  paid_by: string | null;
  paid_amount: Numeric | null;
  payment_note: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  customer_id: string;
  policy_id: string | null;
  document_type: "signed_policy" | "other";
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  created_at: string;
}

export interface ActivityRow {
  id: number;
  customer_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  actor_id: string | null;
  visibility: "team" | "owner";
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Call lists
// ---------------------------------------------------------------------------
export type LeadStatus = "new" | "callback" | "rejected" | "appointment" | "do_not_call";

export interface LeadList {
  id: string;
  name: string;
  source_file_name: string | null;
  status: "importing" | "ready" | "archived";
  assigned_caller_id: string | null;
  total_rows: number;
  imported_count: number;
  skipped_duplicates: number;
  skipped_suppressed: number;
  skipped_invalid: number;
  imported_by: string;
  created_at: string;
}

export interface Lead {
  id: string;
  list_id: string;
  row_number: number | null;
  name: string;
  phone: string;
  phone_normalized: string;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  activity: string | null;
  tax_number: string | null;
  email: string | null;
  extra: Record<string, string>;
  status: LeadStatus;
  next_call_at: string | null;
  last_contacted_at: string | null;
  last_contacted_by: string | null;
  contact_count: number;
  last_comment: string | null;
  customer_id: string | null;
  existing_customer_id: string | null;
  created_at: string;
}

export interface LeadEvent {
  id: number;
  lead_id: string;
  actor_id: string | null;
  action: "status_changed" | "comment" | "converted";
  status_from: LeadStatus | null;
  status_to: LeadStatus | null;
  next_call_at: string | null;
  comment: string | null;
  created_at: string;
}

export interface DeletedRecord {
  id: string;
  kind: "customer_deleted" | "policy_storno";
  customer_id: string;
  customer_name: string;
  policy_id: string | null;
  summary: string;
  reason: string;
  meta: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  restored_at: string | null;
  restored_by: string | null;
}
