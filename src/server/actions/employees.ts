"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerMultiplierSchema, employeeSchema, employeeUpdateSchema, passwordSchema, ratePercentSchema } from "@/lib/validation";
import { callWorkflow, runAction, WorkflowError, type ActionResult } from "@/server/workflow";

/** Owner creates an employee: Supabase Auth user (with initial password) + CRM profile. */
export async function createEmployee(input: unknown): Promise<ActionResult<{ user_id: string }>> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = employeeSchema.parse(input);
    const admin = createAdminClient();

    const { data, error } = await admin.auth.admin.createUser({
      email: v.email,
      password: v.password,
      email_confirm: true,
      // Temporary password: the employee must set their own before seeing any data (enforced by RLS)
      app_metadata: { app: "zan_crm", must_change_password: true },
      user_metadata: { first_name: v.first_name, last_name: v.last_name },
    });
    if (error || !data.user) {
      throw new WorkflowError(error?.message?.includes("already") ? "Uporabnik s to e-pošto že obstaja." : "Uporabnika ni bilo mogoče ustvariti.");
    }

    try {
      await callWorkflow("crm_create_employee_profile", {
        p_actor: userId,
        p_user_id: data.user.id,
        p_profile: { first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone, role: v.role },
        p_rate_percent: v.role === "caller" ? null : ratePercentSchema.parse(v.rate_percent),
        p_caller_multiplier: v.role === "caller" ? callerMultiplierSchema.parse(v.caller_multiplier) : null,
      });
    } catch (e) {
      await admin.auth.admin.deleteUser(data.user.id); // roll back the orphaned auth user
      throw e;
    }
    revalidatePath("/employees");
    return { user_id: data.user.id };
  }, "Zaposleni je dodan.");
}

export async function updateEmployee(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = employeeUpdateSchema.parse(input);
    const { user_id, ...changes } = v;
    await callWorkflow("crm_update_employee", { p_actor: userId, p_user_id: user_id, p_changes: changes });
    if (!v.is_active) {
      // Revoke all sessions so a deactivated user is signed out everywhere (RLS already denies data).
      await callWorkflow("crm_revoke_sessions", { p_actor: userId, p_user_id: user_id });
    }
    revalidatePath("/employees");
    revalidatePath(`/employees/${user_id}`);
    return undefined;
  }, "Zaposleni je posodobljen.");
}

export async function setAgentRate(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ agent_id: z.string().uuid(), rate_percent: ratePercentSchema }).parse(input);
    await callWorkflow("crm_set_agent_rate", { p_actor: userId, p_agent_id: v.agent_id, p_rate_percent: v.rate_percent });
    revalidatePath(`/employees/${v.agent_id}`);
    revalidatePath("/employees");
    return undefined;
  }, "Odstotek provizije je spremenjen. Velja za nove police.");
}

/** Caller commission multiplier. Applies to policies saved from now on; history is never recalculated. */
export async function setCallerMultiplier(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ caller_id: z.string().uuid(), multiplier: callerMultiplierSchema }).parse(input);
    await callWorkflow("crm_set_caller_multiplier", { p_actor: userId, p_caller_id: v.caller_id, p_multiplier: v.multiplier });
    revalidatePath(`/employees/${v.caller_id}`);
    revalidatePath("/employees");
    return undefined;
  }, "Provizija klicatelja je spremenjena. Velja za nove police.");
}

/** Agent's own multiplier for a "premija × število" product (e.g. Specialisti). New policies only. */
export async function setAgentProductMultiplier(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z
      .object({
        agent_id: z.string().uuid(),
        product_id: z.string().uuid(),
        multiplier: z
          .string()
          .trim()
          .transform((x) => x.replace(",", "."))
          .refine((x) => /^\d{1,4}(\.\d{1,3})?$/.test(x) && Number(x) <= 1000, "Vnesite število (npr. 12 ali 10,5)."),
      })
      .parse(input);
    await callWorkflow("crm_set_agent_product_multiplier", {
      p_actor: userId,
      p_agent_id: v.agent_id,
      p_product_id: v.product_id,
      p_multiplier: v.multiplier,
    });
    revalidatePath(`/employees/${v.agent_id}`);
    revalidatePath("/employees");
    return undefined;
  }, "Provizija za produkt je spremenjena. Velja za nove police.");
}

export async function setEmployeePassword(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ user_id: z.string().uuid(), password: passwordSchema }).parse(input);
    if (v.user_id === userId) throw new WorkflowError("Svoje geslo spremenite v Profilu.");
    // New temporary password: must be changed at next login; existing sessions are revoked.
    const { error } = await createAdminClient().auth.admin.updateUserById(v.user_id, {
      password: v.password,
      app_metadata: { must_change_password: true },
    });
    if (error) throw new WorkflowError("Gesla ni bilo mogoče nastaviti.");
    await callWorkflow("crm_revoke_sessions", { p_actor: userId, p_user_id: v.user_id });
    return undefined;
  }, "Začasno geslo je nastavljeno. Zaposleni ga mora ob prijavi zamenjati.");
}

/** Change an employee's login e-mail (auth user + profile, audited). */
export async function changeEmployeeEmail(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ user_id: z.string().uuid(), email: z.email("Vnesite veljaven e-poštni naslov.").transform((e) => e.toLowerCase().trim()) }).parse(input);
    const admin = createAdminClient();
    const { data: current } = await admin.from("profiles").select("email").eq("id", v.user_id).single();
    if (!current) throw new WorkflowError("Zaposleni ne obstaja.");
    if (current.email === v.email) return undefined;

    await callWorkflow("crm_update_employee", { p_actor: userId, p_user_id: v.user_id, p_changes: { email: v.email } });
    const { error } = await admin.auth.admin.updateUserById(v.user_id, { email: v.email, email_confirm: true });
    if (error) {
      await callWorkflow("crm_update_employee", { p_actor: userId, p_user_id: v.user_id, p_changes: { email: current.email } });
      throw new WorkflowError(error.message?.includes("already") ? "Ta e-poštni naslov je že v uporabi." : "E-pošte ni bilo mogoče spremeniti.");
    }
    revalidatePath(`/employees/${v.user_id}`);
    revalidatePath("/", "layout");
    return undefined;
  }, "E-pošta za prijavo je spremenjena.");
}
