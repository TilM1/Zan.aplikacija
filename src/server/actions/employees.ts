"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerMultiplierSchema, employeeSchema, employeeUpdateSchema, ratePercentSchema } from "@/lib/validation";
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
      app_metadata: { app: "zan_crm" },
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
      // Revoke refresh tokens so a deactivated user is signed out everywhere.
      await createAdminClient().auth.admin.signOut(user_id).catch(() => undefined);
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

export async function setEmployeePassword(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    await requireActor(["owner"]);
    const v = z.object({ user_id: z.string().uuid(), password: z.string().min(10, "Geslo mora imeti vsaj 10 znakov.") }).parse(input);
    const { error } = await createAdminClient().auth.admin.updateUserById(v.user_id, { password: v.password });
    if (error) throw new WorkflowError("Gesla ni bilo mogoče nastaviti.");
    return undefined;
  }, "Novo geslo je nastavljeno.");
}
