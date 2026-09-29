/**
 * Input validation schemas, shared by client forms and server actions.
 * The server always re-validates; the client uses them for instant feedback.
 */
import { z } from "zod";
import { isValidMoneyInput } from "@/lib/money";
import { isValidIsoDate } from "@/lib/dates";

const req = (label: string) => z.string().trim().min(1, `${label} je obvezno polje.`);
const uuid = (label: string) => z.string().uuid(`Izberite ${label}.`);

export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Telefon je obvezno polje.")
  .regex(/^[+0-9 ()/-]{6,20}$/, "Vnesite veljavno telefonsko številko.");

export const emailSchema = z
  .string()
  .trim()
  .transform((v) => v.toLowerCase())
  .refine((v) => v === "" || z.email().safeParse(v).success, "Vnesite veljaven e-poštni naslov.");

export const dateSchema = z.string().refine(isValidIsoDate, "Vnesite veljaven datum.");
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Vnesite veljavno uro.");

export const customerSchema = z.object({
  first_name: req("Ime"),
  last_name: req("Priimek"),
  phone: phoneSchema,
  email: emailSchema,
  address: req("Naslov obiska"),
  postal_code: z.string().trim().regex(/^\d{4}$/, "Poštna številka ima 4 števke."),
  city: z.string().trim().optional().default(""),
});

export const appointmentSlotSchema = z.object({
  agent_id: uuid("zastopnika"),
  date: dateSchema,
  time: timeSchema,
  duration_minutes: z.coerce.number().int().min(15).max(480).default(60),
  note: z.string().trim().max(2000).optional().default(""),
});

export const newCustomerAppointmentSchema = customerSchema.extend({
  appointment: appointmentSlotSchema,
  caller_id: z.string().uuid().optional().or(z.literal("")),
  confirm_duplicate: z.boolean().optional().default(false),
});

export const scheduleAppointmentSchema = appointmentSlotSchema.extend({
  customer_id: z.string().uuid(),
});

export const updateAppointmentSchema = appointmentSlotSchema.extend({
  appointment_id: z.string().uuid(),
});

export const moneySchema = z
  .string()
  .trim()
  .refine(isValidMoneyInput, "Vnesite znesek (npr. 45,50).")
  .transform((v) => v.replace(",", "."))
  .refine((v) => Number(v) > 0, "Znesek mora biti večji od 0.");

export const policyEntrySchema = z.object({
  product_id: uuid("produkt"),
  monthly_premium: moneySchema,
  duration_years: z.coerce.number({ message: "Vnesite trajanje." }).int("Trajanje v celih letih.").min(1, "Trajanje mora biti vsaj 1 leto.").max(100),
  policy_date: dateSchema,
  policy_number: z.string().trim().max(64).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
});

export const recordResultSchema = z.discriminatedUnion("result", [
  z.object({ result: z.literal("A"), appointment_id: z.string().uuid(), note: z.string().trim().max(2000).default(""), next: appointmentSlotSchema }),
  z.object({ result: z.literal("A0"), appointment_id: z.string().uuid(), note: z.string().trim().max(2000).default("") }),
  z.object({ result: z.literal("B"), appointment_id: z.string().uuid(), note: z.string().trim().max(2000).default("") }),
  z.object({
    result: z.literal("A1"),
    appointment_id: z.string().uuid(),
    note: z.string().trim().max(2000).default(""),
    policies: z.array(policyEntrySchema).min(1, "Dodajte vsaj eno polico."),
  }),
]);

export const ratePercentSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(",", "."))
  .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) >= 0 && Number(v) <= 100, "Odstotek med 0 in 100 (npr. 10 ali 12,5).");

export const employeeSchema = z
  .object({
    first_name: req("Ime"),
    last_name: req("Priimek"),
    email: z.email("Vnesite veljaven e-poštni naslov.").transform((v) => v.toLowerCase()),
    phone: z.string().trim().optional().default(""),
    role: z.enum(["owner", "agent", "caller"]),
    rate_percent: z.string().trim().optional().default(""),
    password: z.string().min(10, "Geslo mora imeti vsaj 10 znakov."),
  })
  .superRefine((v, ctx) => {
    if (v.role !== "caller") {
      const r = ratePercentSchema.safeParse(v.rate_percent);
      if (!r.success) ctx.addIssue({ code: "custom", path: ["rate_percent"], message: "Za zastopnika vnesite odstotek provizije (0–100)." });
    }
  });

export const employeeUpdateSchema = z.object({
  user_id: z.string().uuid(),
  first_name: req("Ime"),
  last_name: req("Priimek"),
  phone: z.string().trim().optional().default(""),
  role: z.enum(["owner", "agent", "caller"]),
  is_active: z.boolean(),
});
