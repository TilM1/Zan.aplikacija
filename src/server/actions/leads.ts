"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { LEAD_FIELDS } from "@/lib/leads/import";
import { localDateTimeToIso } from "@/lib/dates";
import { dateSchema, timeSchema } from "@/lib/validation";
import { getLeadWithHistory } from "@/server/queries/leads";
import { callWorkflow, runAction, WorkflowError, type ActionResult } from "@/server/workflow";

const s = (max: number) => z.string().max(max).nullable().optional().transform((v) => v ?? null);

const importRowSchema = z.object({
  row_number: z.number().int().min(0),
  name: z.string().max(300),
  phone: z.string().max(40),
  street: s(300),
  postal_code: s(20),
  city: s(120),
  activity: s(300),
  tax_number: s(40),
  email: s(200),
  extra: z.record(z.string().max(80), z.string().max(500)).refine((o) => Object.keys(o).length <= 60, "Preveč stolpcev."),
});

// ---------------------------------------------------------------- Owner: import
export async function createLeadList(input: unknown): Promise<ActionResult<{ list_id: string }>> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z
      .object({
        name: z.string().trim().min(1, "Vnesite ime seznama.").max(120),
        file_name: z.string().max(200),
        assigned_caller_id: z.string().uuid().nullable(),
        mapping: z.record(z.enum(LEAD_FIELDS), z.string().max(120)),
        extra_columns: z.array(z.string().max(80)).max(60),
        total_rows: z.number().int().min(0).max(200_000),
      })
      .parse(input);
    const id = await callWorkflow<string>("crm_create_lead_list", {
      p_actor: userId,
      p_name: v.name,
      p_file_name: v.file_name,
      p_assigned_caller_id: v.assigned_caller_id,
      p_mapping: v.mapping,
      p_extra_columns: v.extra_columns,
      p_total_rows: v.total_rows,
    });
    return { list_id: id };
  });
}

export interface ImportChunkResult {
  inserted: number;
  duplicates: number;
  suppressed: number;
  invalid: number;
}

export async function importLeadChunk(input: unknown): Promise<ActionResult<ImportChunkResult>> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ list_id: z.string().uuid(), rows: z.array(importRowSchema).min(1).max(2000) }).parse(input);
    return callWorkflow<ImportChunkResult>("crm_import_leads", { p_actor: userId, p_list_id: v.list_id, p_rows: v.rows });
  });
}

export async function finalizeLeadList(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ list_id: z.string().uuid() }).parse(input);
    await callWorkflow("crm_finalize_lead_list", { p_actor: userId, p_list_id: v.list_id });
    revalidatePath("/export");
    revalidatePath("/leads");
    return undefined;
  });
}

export async function updateLeadList(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z
      .object({ list_id: z.string().uuid(), name: z.string().trim().min(1).max(120), assigned_caller_id: z.string().uuid().nullable(), archived: z.boolean() })
      .parse(input);
    await callWorkflow("crm_update_lead_list", {
      p_actor: userId,
      p_list_id: v.list_id,
      p_name: v.name,
      p_assigned_caller_id: v.assigned_caller_id,
      p_archived: v.archived,
    });
    revalidatePath("/export");
    revalidatePath("/leads");
    return undefined;
  }, "Seznam je posodobljen.");
}

export async function deleteLeadList(input: unknown): Promise<ActionResult<number>> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ list_id: z.string().uuid() }).parse(input);
    const n = await callWorkflow<number>("crm_delete_lead_list", { p_actor: userId, p_list_id: v.list_id });
    revalidatePath("/export");
    revalidatePath("/leads");
    return n;
  }, "Seznam je izbrisan.");
}

export async function setRecallMonths(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ months: z.coerce.number().int().min(1, "Najmanj 1 mesec.").max(60, "Največ 60 mesecev.") }).parse(input);
    await callWorkflow("crm_set_setting", { p_actor: userId, p_key: "lead_rejected_recall_months", p_value: v.months });
    revalidatePath("/settings");
    return undefined;
  }, "Nastavitev je shranjena.");
}

// ---------------------------------------------------------------- Caller: work the list
export async function setLeadStatus(input: unknown): Promise<ActionResult<{ next_call_at: string | null }>> {
  return runAction(async () => {
    const { userId } = await requireActor(["caller", "owner"]);
    const v = z
      .object({
        lead_id: z.string().uuid(),
        status: z.enum(["callback", "rejected", "do_not_call", "new"]),
        date: dateSchema.optional(),
        time: timeSchema.optional(),
        comment: z.string().trim().max(2000).optional().default(""),
      })
      .parse(input);
    if (v.status === "callback" && !v.date) throw new WorkflowError("Izberite dan ponovnega klica.");
    const next = v.status === "callback" && v.date ? localDateTimeToIso(v.date, v.time ?? "09:00") : null;
    const res = await callWorkflow<{ next_call_at: string | null }>("crm_lead_set_status", {
      p_actor: userId,
      p_lead_id: v.lead_id,
      p_status: v.status,
      p_next_call_at: next,
      p_comment: v.comment,
    });
    revalidatePath("/leads");
    return res;
  });
}

export async function addLeadComment(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["caller", "owner"]);
    const v = z.object({ lead_id: z.string().uuid(), comment: z.string().trim().min(1, "Komentar je prazen.").max(2000) }).parse(input);
    await callWorkflow("crm_lead_add_comment", { p_actor: userId, p_lead_id: v.lead_id, p_comment: v.comment });
    revalidatePath("/leads");
    return undefined;
  });
}

/** Detail + history for the lead dialog (read through RLS). */
export async function fetchLeadDetail(input: unknown) {
  return runAction(async () => {
    await requireActor(["caller", "owner"]);
    const v = z.object({ lead_id: z.string().uuid() }).parse(input);
    const res = await getLeadWithHistory(v.lead_id);
    if (!res) throw new WorkflowError("Kontakt ne obstaja ali do njega nimate dostopa.");
    return res;
  });
}
