"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { changeEmployeeEmail, createEmployee, setAgentRate, setCallerMultiplier, setEmployeePassword, updateEmployee } from "@/server/actions/employees";
import { ROLE_LABELS } from "@/lib/labels";
import type { Role } from "@/types/domain";

/** 14-char temporary password with letters and digits (meets the password policy). */
function randomPassword() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  const chars = Array.from(arr, (n, i) => (i % 4 === 3 ? digits[n % digits.length] : letters[n % letters.length]));
  return chars.join("");
}

export function CreateEmployeeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const { submit, pending, error, fieldErrors } = useSubmit<{ user_id: string }>();
  const [v, setV] = useState({ first_name: "", last_name: "", email: "", phone: "", role: "caller" as Role, rate_percent: "", caller_multiplier: "1,5", password: randomPassword() });
  const set = (k: keyof typeof v, value: string) => setV((x) => ({ ...x, [k]: value }));

  const close = () => {
    setOpen(false);
    setCreated(null);
    setV({ first_name: "", last_name: "", email: "", phone: "", role: "caller", rate_percent: "", caller_multiplier: "1,5", password: randomPassword() });
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
            <p>Posredujte zaposlenemu prijavne podatke osebno ali po telefonu (ne po e-pošti ali javnih kanalih). Ob prvi prijavi mora začasno geslo obvezno zamenjati s svojim – do takrat ne vidi nobenih podatkov.</p>
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
            {v.role === "caller" && (
              <Field label="Provizija (× mesečna premija)" required error={fieldErrors.caller_multiplier} className="sm:col-span-3" hint="Enkratno na polico, npr. 1,5 = 150 € pri premiji 100 €.">
                <Input inputMode="decimal" value={v.caller_multiplier} onChange={(e) => set("caller_multiplier", e.target.value)} />
              </Field>
            )}
            {v.role !== "caller" && (
              <Field label="Odstotek provizije (%)" required error={fieldErrors.rate_percent} className="sm:col-span-3" hint="Velja za police, sklenjene od zdaj naprej.">
                <Input inputMode="decimal" value={v.rate_percent} onChange={(e) => set("rate_percent", e.target.value)} placeholder="npr. 10" />
              </Field>
            )}
            <Field label="Začasno geslo" required error={fieldErrors.password} className="sm:col-span-6" hint="Samodejno ustvarjeno. Zaposleni ga mora ob prvi prijavi zamenjati.">
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

/**
 * Change an employee's commission: agent rate (%) or caller multiplier (×).
 * Always creates a new history entry; existing policies keep the value they were sold with.
 */
export function RateForm({ employeeId, kind, current }: { employeeId: string; kind: "agent" | "caller"; current: string | null }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [value, setValue] = useState(current?.replace(".", ",") ?? "");
  const [confirming, setConfirming] = useState(false);
  const label = kind === "agent" ? "Nov odstotek (%)" : "Nov faktor (× mesečna premija)";
  const pretty = (x: string) => (kind === "agent" ? `${x} %` : `× ${x}`);
  return (
    <div className="flex flex-col gap-2">
      <FormError message={error} />
      <div className="flex items-end gap-2">
        <Field label={label} className="flex-1">
          <Input inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setConfirming(false); }} />
        </Field>
        {!confirming ? (
          <Button variant="secondary" disabled={!value.trim() || value.replace(",", ".") === current} onClick={() => setConfirming(true)}>
            Spremeni
          </Button>
        ) : (
          <Button
            loading={pending}
            onClick={async () => {
              const res = await submit(() =>
                kind === "agent" ? setAgentRate({ agent_id: employeeId, rate_percent: value }) : setCallerMultiplier({ caller_id: employeeId, multiplier: value }),
              );
              if (res?.ok) {
                setConfirming(false);
                router.refresh();
              }
            }}
          >
            Potrdi
          </Button>
        )}
      </div>
      {confirming ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          {current ? pretty(current.replace(".", ",")) : "–"} → <b>{pretty(value)}</b> velja za vse police, shranjene od zdaj naprej. Že sklenjene police in njihova izplačila ostanejo po starem.
        </p>
      ) : (
        <p className="text-xs text-ink-3">Sprememba ne vpliva za nazaj – vsaka polica ohrani provizijo, veljavno ob prodaji.</p>
      )}
    </div>
  );
}

export function PasswordReset({ userId }: { userId: string }) {
  const { submit, pending, error, fieldErrors } = useSubmit();
  const [pw, setPw] = useState("");
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <FormError message={error ?? fieldErrors.password} />
      {done && (
        <p className="rounded-md bg-success-soft px-3 py-2 text-xs text-success">
          Začasno geslo: <b className="font-mono">{done}</b> – posredujte ga zaposlenemu. Vse njegove seje so odjavljene; ob prijavi mora geslo zamenjati.
        </p>
      )}
      <div className="flex items-end gap-2">
        <Field label="Novo začasno geslo" className="flex-1">
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
            if (res?.ok) {
              setDone(pw);
              setPw("");
            }
          }}
        >
          Nastavi
        </Button>
      </div>
    </div>
  );
}

export function EmailForm({ userId, current }: { userId: string; current: string }) {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit();
  const [email, setEmail] = useState(current);
  const placeholder = current.endsWith(".invalid");
  return (
    <div className="flex flex-col gap-2">
      {placeholder && <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">Začasni naslov – vpišite pravi e-poštni naslov za prijavo.</p>}
      <FormError message={error ?? fieldErrors.email} />
      <div className="flex items-end gap-2">
        <Field label="E-pošta za prijavo" className="flex-1">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button
          variant="secondary"
          loading={pending}
          disabled={email.trim().toLowerCase() === current}
          onClick={async () => {
            const res = await submit(() => changeEmployeeEmail({ user_id: userId, email }));
            if (res?.ok) router.refresh();
          }}
        >
          Spremeni
        </Button>
      </div>
      <p className="text-xs text-ink-3">Po spremembi se zaposleni prijavlja z novim naslovom; geslo ostane isto.</p>
    </div>
  );
}
