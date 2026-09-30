/**
 * Operational/emergency export definitions. Exports contain raw columns incl.
 * IDs and foreign keys so data can be reconstructed. This is NOT a database
 * backup — see docs/BACKUP_AND_RECOVERY.md.
 */
export interface ExportDataset {
  key: string;
  label: string;
  description: string;
  table: string;
  select: string;
  /** Column used for the optional from/to filter. */
  dateColumn?: string;
  /** Column filtered by ?list=<id> (call lists). */
  listColumn?: string;
  order: string;
  /** Flatten embedded relations into extra columns. */
  flatten?: (row: Record<string, unknown>) => Record<string, unknown>;
}

const person = (p: unknown) => (p && typeof p === "object" ? `${(p as { first_name: string }).first_name} ${(p as { last_name: string }).last_name}` : "");

export const EXPORT_DATASETS: ExportDataset[] = [
  {
    key: "customers",
    label: "Stranke",
    description: "Vse stranke z odgovornim klicateljem, zastopnikom in statusom",
    table: "customers",
    select: "id, first_name, last_name, phone, email, address, postal_code, city, status, last_result, responsible_caller_id, current_agent_id, created_by, created_at, updated_at, archived_at, is_demo",
    dateColumn: "created_at",
    order: "created_at",
  },
  {
    key: "appointments",
    label: "Termini / svetovanja",
    description: "Vsi termini z rezultati (A, A0, A1, B), zastopnikom in klicateljem",
    table: "appointments",
    select:
      "id, customer_id, visit_number, previous_appointment_id, scheduled_at, duration_minutes, location, postal_code, agent_id, caller_id, created_by, status, result, result_note, completed_at, completed_by, cancelled_at, cancel_reason, note, external_provider, external_event_id, sync_status, created_at, customer:customers(first_name, last_name), agent:profiles!appointments_agent_id_fkey(first_name, last_name), caller:profiles!appointments_caller_id_fkey(first_name, last_name)",
    dateColumn: "scheduled_at",
    order: "scheduled_at",
    flatten: ({ customer, agent, caller, ...r }) => ({ ...r, customer_name: person(customer), agent_name: person(agent), caller_name: person(caller) }),
  },
  {
    key: "policies",
    label: "Police",
    description: "Vse police s premijo, trajanjem, zastopnikom in klicateljem",
    table: "policies",
    select:
      "id, customer_id, appointment_id, product_id, product_name, policy_number, monthly_premium, duration_years, policy_date, agent_id, caller_id, status, note, created_by, created_at, cancelled_at, cancel_reason, cancelled_by, customer:customers(first_name, last_name), agent:profiles!policies_agent_id_fkey(first_name, last_name), caller:profiles!policies_caller_id_fkey(first_name, last_name)",
    dateColumn: "policy_date",
    order: "policy_date",
    flatten: ({ customer, agent, caller, ...r }) => ({ ...r, customer_name: person(customer), agent_name: person(agent), caller_name: person(caller) }),
  },
  {
    key: "commissions",
    label: "Knjiga provizij in izplačil",
    description: "Vsi obroki z izračunom, zapadlostjo in statusom plačila",
    table: "commission_installments",
    select:
      "id, commission_id, policy_id, beneficiary_id, beneficiary_type, kind, reverses_installment_id, installment_number, share_percent, amount, due_date, original_due_date, status, paid_at, paid_by, paid_amount, payment_note, cancelled_at, cancel_reason, created_at, commission:commissions(total_amount, base_monthly_premium, base_duration_years, rate_percent, caller_multiplier, calc_model, agent_multiplier, policy_date, rule_version, calculation), beneficiary:profiles!commission_installments_beneficiary_id_fkey(first_name, last_name), policy:policies(customer_id, product_name, policy_number)",
    dateColumn: "due_date",
    order: "due_date",
    flatten: ({ commission, beneficiary, policy, ...r }) => {
      const c = (commission ?? {}) as Record<string, unknown>;
      const p = (policy ?? {}) as Record<string, unknown>;
      return {
        ...r,
        beneficiary_name: person(beneficiary),
        customer_id: p.customer_id,
        product_name: p.product_name,
        policy_number: p.policy_number,
        commission_total: c.total_amount,
        base_monthly_premium: c.base_monthly_premium,
        base_duration_years: c.base_duration_years,
        rate_percent_at_sale: c.rate_percent,
        caller_multiplier: c.caller_multiplier,
        calc_model: c.calc_model,
        agent_multiplier: c.agent_multiplier,
        policy_date: c.policy_date,
        rule_version: c.rule_version,
        calculation: c.calculation ? (c.calculation as Record<string, unknown>).expression : "",
      };
    },
  },
  {
    key: "employees",
    label: "Zaposleni",
    description: "Zaposleni, vloge, status ter trenutne provizije z zgodovino sprememb",
    table: "profiles",
    select: "id, first_name, last_name, email, phone, role, is_active, is_demo, created_at, updated_at, rates:agent_commission_rates!agent_commission_rates_agent_id_fkey(rate_percent, effective_from), multipliers:caller_commission_rates!caller_commission_rates_caller_id_fkey(multiplier, effective_from)",
    order: "created_at",
    flatten: ({ rates, multipliers, ...r }) => {
      const list = ((rates ?? []) as { rate_percent: number; effective_from: string }[]).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
      const mult = ((multipliers ?? []) as { multiplier: number; effective_from: string }[]).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
      return {
        ...r,
        current_rate_percent: list[0]?.rate_percent ?? "",
        rate_history: list.map((x) => `${x.effective_from.slice(0, 10)}:${x.rate_percent}`).join(" | "),
        current_caller_multiplier: mult[0]?.multiplier ?? "",
        caller_multiplier_history: mult.map((x) => `${x.effective_from.slice(0, 10)}:${x.multiplier}`).join(" | "),
      };
    },
  },
  {
    key: "leads",
    label: "Klicni seznami – kontakti",
    description: "Vsi kontakti s seznamom (mapo), statusom, naslednjim klicem, komentarjem in vsemi stolpci iz uvožene datoteke",
    table: "leads",
    select:
      "id, list_id, row_number, name, phone, phone_normalized, street, postal_code, city, activity, tax_number, email, status, next_call_at, last_contacted_at, contact_count, last_comment, customer_id, existing_customer_id, created_at, extra, list:lead_lists(name), caller:profiles!leads_last_contacted_by_fkey(first_name, last_name)",
    dateColumn: "created_at",
    listColumn: "list_id",
    order: "row_number",
    flatten: ({ list, caller, extra, ...r }) => ({
      list_name: (list as { name?: string } | null)?.name ?? "",
      ...r,
      last_contacted_by_name: person(caller),
      ...((extra ?? {}) as Record<string, unknown>),
    }),
  },
  {
    key: "lead_lists",
    label: "Klicni seznami – pregled",
    description: "Uvoženi seznami (mape): datoteka, datum, klicateljica, število uvoženih in preskočenih vrstic",
    table: "lead_lists",
    select: "id, name, source_file_name, status, assigned_caller_id, total_rows, imported_count, skipped_duplicates, skipped_suppressed, skipped_invalid, imported_by, created_at",
    dateColumn: "created_at",
    order: "created_at",
  },
  {
    key: "deleted_records",
    label: "Storno in izbrisi (varnostna kopija)",
    description: "Vsi storni in izbrisi s polnim posnetkom podatkov pred spremembo",
    table: "deleted_records",
    select: "id, kind, customer_id, customer_name, policy_id, summary, reason, meta, created_by, created_at, restored_at, restored_by, snapshot",
    dateColumn: "created_at",
    order: "created_at",
  },
  {
    key: "followups",
    label: "Klici nazaj",
    description: "Vsi klici nazaj (B) in njihova razrešitev",
    table: "caller_followups",
    select: "id, customer_id, caller_id, source_appointment_id, reason, status, note, resolved_appointment_id, resolved_at, resolved_by, created_at",
    dateColumn: "created_at",
    order: "created_at",
  },
  {
    key: "activity",
    label: "Zgodovina aktivnosti",
    description: "Revizijska sled vseh pomembnih dejanj",
    table: "activity_log",
    select: "id, created_at, customer_id, entity_type, entity_id, action, actor_id, visibility, old_value, new_value, metadata",
    dateColumn: "created_at",
    order: "id",
  },
  {
    key: "documents",
    label: "Dokumenti (metapodatki)",
    description: "Seznam dokumentov (datoteke ostanejo v zasebni shrambi)",
    table: "documents",
    select: "id, customer_id, policy_id, document_type, storage_bucket, storage_path, file_name, mime_type, size_bytes, uploaded_by, created_at, deleted_at",
    dateColumn: "created_at",
    order: "created_at",
  },
];
