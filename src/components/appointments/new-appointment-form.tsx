"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { SlotFields, emptySlot, type SlotValue } from "./slot-fields";
import { useSubmit } from "@/components/shared/use-submit";
import { createCustomerWithAppointment, type CreateCustomerResult, type DuplicateMatch } from "@/server/actions/appointments";
import type { PersonOption } from "@/server/queries/people";

const emptyCustomer = { first_name: "", last_name: "", phone: "", email: "", address: "", postal_code: "", city: "" };

/** Caller workflow: confirmed appointment → new customer + appointment for an agent. */
export function NewAppointmentForm({ agents, callers, isOwner }: { agents: PersonOption[]; callers: PersonOption[]; isOwner: boolean }) {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit<CreateCustomerResult>();
  const [customer, setCustomer] = useState(emptyCustomer);
  const [slot, setSlot] = useState<SlotValue>(emptySlot());
  const [callerId, setCallerId] = useState("");
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);

  const set = (k: keyof typeof emptyCustomer, v: string) => setCustomer((c) => ({ ...c, [k]: v }));
  const err = (k: string) => fieldErrors[k];

  async function save(confirmDuplicate: boolean) {
    const res = await submit(() =>
      createCustomerWithAppointment({ ...customer, appointment: slot, caller_id: callerId, confirm_duplicate: confirmDuplicate }),
    );
    if (!res?.ok) return;
    if (res.data.status === "duplicate") {
      setDuplicates(res.data.matches);
      return;
    }
    router.push(`/customers/${res.data.customer_id}?created=1`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
      className="grid gap-4 xl:grid-cols-5"
    >
      <Card className="xl:col-span-3">
        <CardHeader title={<StepTitle n={1}>Stranka</StepTitle>} description="Podatki za obisk na terenu" />
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <Field label="Ime" required error={err("first_name")} className="sm:col-span-3">
            <Input value={customer.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus aria-invalid={!!err("first_name")} />
          </Field>
          <Field label="Priimek" required error={err("last_name")} className="sm:col-span-3">
            <Input value={customer.last_name} onChange={(e) => set("last_name", e.target.value)} aria-invalid={!!err("last_name")} />
          </Field>
          <Field label="Telefon" required error={err("phone")} className="sm:col-span-3">
            <Input type="tel" value={customer.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+386 41 123 456" aria-invalid={!!err("phone")} />
          </Field>
          <Field label="E-pošta" error={err("email")} className="sm:col-span-3">
            <Input type="email" value={customer.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!err("email")} />
          </Field>
          <Field label="Naslov obiska" required error={err("address")} className="sm:col-span-6">
            <Input value={customer.address} onChange={(e) => set("address", e.target.value)} placeholder="Ulica in hišna številka" aria-invalid={!!err("address")} />
          </Field>
          <Field label="Poštna številka" required error={err("postal_code")} className="sm:col-span-2">
            <Input inputMode="numeric" maxLength={4} value={customer.postal_code} onChange={(e) => set("postal_code", e.target.value)} aria-invalid={!!err("postal_code")} />
          </Field>
          <Field label="Kraj" className="sm:col-span-4">
            <Input value={customer.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader title={<StepTitle n={2}>Termin in zastopnik</StepTitle>} description="Stranka se takoj prikaže v pipelinu in koledarju izbranega zastopnika." />
        <CardBody className="flex flex-col gap-4">
          <SlotFields value={slot} onChange={setSlot} agents={agents} errors={fieldErrors} prefix="appointment." />
          {isOwner && (
            <Field label="Klicatelj (pripis provizije)" hint="Pustite prazno, če termina ni dogovoril klicatelj.">
              <Select value={callerId} onChange={(e) => setCallerId(e.target.value)}>
                <option value="">— brez klicatelja —</option>
                {callers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-col gap-3 xl:col-span-5">
        <FormError message={error} />
        {duplicates && (
          <div className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-warning">
              <AlertTriangle className="size-4" /> Možen dvojnik – stranka s tem telefonom ali e-pošto že obstaja
            </p>
            <ul className="mt-2 list-disc pl-5 text-ink-2">
              {duplicates.map((d, i) => (
                <li key={i}>
                  {d.id ? (
                    <Link className="font-medium text-brand hover:underline" href={`/customers/${d.id}`}>
                      {d.label} – odpri stranko in dogovori nov termin tam
                    </Link>
                  ) : (
                    d.label
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDuplicates(null)}>
                Popravi podatke
              </Button>
              <Button size="sm" variant="primary" loading={pending} onClick={() => save(true)}>
                Vseeno ustvari novo stranko
              </Button>
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="gold" loading={pending} disabled={!!duplicates} className="h-11 px-6 text-[15px]">
            Shrani stranko in termin
          </Button>
        </div>
      </div>
    </form>
  );
}

function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="grid size-6 place-items-center rounded-full bg-gold text-xs font-bold text-ink">{n}</span>
      {children}
    </span>
  );
}
