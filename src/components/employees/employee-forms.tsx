"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { createEmployee, setAgentRate, setEmployeePassword, updateEmployee } from "@/server/actions/employees";
import { ROLE_LABELS } from "@/lib/labels";
import type { Role } from "@/types/domain";

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

export function CreateEmployeeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const { submit, pending, error, fieldErrors } = useSubmit<{ user_id: string }>();
  const [v, setV] = useState({ first_name: "", last_name: "", email: "", phone: "", role: "caller" as Role, rate_percent: "", password: randomPassword() });
  const set = (k: keyof typeof v, value: string) => setV((x) => ({ ...x, [k]: value }));

  const close = () => {
    setOpen(false);
    setCreated(null);
    setV({ first_name: "", last_name: "", email: "", phone: "", role: "caller", rate_percent: "", password: randomPassword() });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="size-4" /> Nov zaposleni
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={created ? "Zaposleni je dodan" : "Nov zaposleni"}
        footer={
          created ? (
            <Button onClick={close}>Zapri</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>
                Prekliči
              </Button>
              <Button
                loading={pending}
                onClick={async () => {
                  const res = await submit(() => createEmployee(v));
                  if (res?.ok) {
                    setCreated({ email: v.email, password: v.password });
                    router.refresh();
                  }
                }}
              >
                Ustvari račun
              </Button>
            </>
          )
        }
      >
        {created ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>Posredujte zaposlenemu prijavne podatke (varno, ne po javnih kanalih). Geslo lahko spremeni v svojem profilu.</p>
            <div className="rounded-md bg-subtle p-3 font-mono text-[13px]">
              <p>E-pošta: {created.email}</p>
              <p>Začetno geslo: {created.password}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <div className="sm:col-span-6">
              <FormError message={error} />
            </div>
            <Field label="Ime" required error={fieldErrors.first_name} className="sm:col-span-3">
              <Input value={v.first_name} onChange={(e) => set("first_name", e.target.value)} />
            </Field>
            <Field label="Priimek" required error={fieldErrors.last_name} className="sm:col-span-3">
              <Input value={v.last_name} onChange={(e) => set("last_name", e.target.value)} />
            </Field>
            <Field label="E-pošta (prijava)" required error={fieldErrors.email} className="sm:col-span-3">
              <Input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Telefon" className="sm:col-span-3">
              <Input value={v.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field label="Vloga" required className="sm:col-span-3">
              <Select value={v.role} onChange={(e) => set("role", e.target.value)}>
                {(["caller", "agent", "owner"] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            {v.role !== "caller" && (
              <Field label="Odstotek provizije (%)" required error={fieldErrors.rate_percent} className="sm:col-span-3" hint="Velja za police, sklenjene od zdaj naprej.">
                <Input inputMode="decimal" value={v.rate_percent} onChange={(e) => set("rate_percent", e.target.value)} placeholder="npr. 10" />
              </Field>
            )}
            <Field label="Začetno geslo" required error={fieldErrors.password} className="sm:col-span-6" hint="Samodejno ustvarjeno – lahko ga spremenite.">
              <Input value={v.password} onChange={(e) => set("password", e.target.value)} className="font-mono" />
            </Field>
          </div>
        )}
      </Dialog>
    </>
  );
}

export function EditEmployeeForm({ employee, isSelf }: { employee: { id: string; first_name: string; last_name: string; phone: string | null; role: Role; is_active: boolean }; isSelf: boolean }) {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit();
  const [v, setV] = useState({ first_name: employee.first_name, last_name: employee.last_name, phone: employee.phone ?? "", role: employee.role, is_active: employee.is_active });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
      <div className="sm:col-span-6">
        <FormError message={error} />
      </div>
      <Field label="Ime" error={fieldErrors.first_name} className="sm:col-span-3">
        <Input value={v.first_name} onChange={(e) => setV({ ...v, first_name: e.target.value })} />
      </Field>
      <Field label="Priimek" error={fieldErrors.last_name} className="sm:col-span-3">
        <Input value={v.last_name} onChange={(e) => setV({ ...v, last_name: e.target.value })} />
      </Field>
      <Field label="Telefon" className="sm:col-span-2">
        <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      </Field>
      <Field label="Vloga" className="sm:col-span-2">
        <Select value={v.role} disabled={isSelf} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>
          {(["caller", "agent", "owner"] as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Status" className="sm:col-span-2">
        <Select value={v.is_active ? "1" : "0"} disabled={isSelf} onChange={(e) => setV({ ...v, is_active: e.target.value === "1" })}>
          <option value="1">Aktiven</option>
          <option value="0">Neaktiven (brez dostopa)</option>
        </Select>
      </Field>
      <p className="text-xs text-ink-3 sm:col-span-6">Deaktivacija takoj odvzame dostop. Zgodovina, produkcija in provizije zaposlenega ostanejo.</p>
      <div className="sm:col-span-6">
        <Button
          loading={pending}
          onClick={async () => {
            const res = await submit(() => updateEmployee({ user_id: employee.id, ...v }));
            if (res?.ok) router.refresh();
          }}
        >
          Shrani
        </Button>
      </div>
    </div>
  );
}

export function RateForm({ agentId, current }: { agentId: string; current: string | null }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [rate, setRate] = useState(current ?? "");
  return (
    <div className="flex flex-col gap-2">
      <FormError message={error} />
      <div className="flex items-end gap-2">
        <Field label="Nov odstotek (%)" className="flex-1">
          <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Button
          loading={pending}
          onClick={async () => {
            const res = await submit(() => setAgentRate({ agent_id: agentId, rate_percent: rate }));
            if (res?.ok) router.refresh();
          }}
        >
          Nastavi
        </Button>
      </div>
      <p className="text-xs text-ink-3">Obstoječe police ohranijo odstotek, veljaven ob prodaji.</p>
    </div>
  );
}

export function PasswordReset({ userId }: { userId: string }) {
  const { submit, pending, error } = useSubmit();
  const [pw, setPw] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <FormError message={error} />
      <div className="flex items-end gap-2">
        <Field label="Novo geslo" className="flex-1">
          <Input value={pw} onChange={(e) => setPw(e.target.value)} className="font-mono" />
        </Field>
        <Button variant="secondary" onClick={() => setPw(randomPassword())}>
          Ustvari
        </Button>
        <Button
          loading={pending}
          disabled={pw.length < 10}
          onClick={async () => {
            const res = await submit(() => setEmployeePassword({ user_id: userId, password: pw }));
            if (res?.ok) setPw("");
          }}
        >
          Nastavi
        </Button>
      </div>
    </div>
  );
}
