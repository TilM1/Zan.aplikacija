"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { toast } from "sonner";
import { changeOwnPassword, sendOwnTestInvite, setInviteSettings, updateOwnProfile } from "@/server/actions/profile";

export function OwnProfileForm({ initial }: { initial: { first_name: string; last_name: string; phone: string } }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [v, setV] = useState(initial);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormError message={error} />
      </div>
      <Field label="Ime">
        <Input value={v.first_name} onChange={(e) => setV({ ...v, first_name: e.target.value })} />
      </Field>
      <Field label="Priimek">
        <Input value={v.last_name} onChange={(e) => setV({ ...v, last_name: e.target.value })} />
      </Field>
      <Field label="Telefon">
        <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      </Field>
      <div className="sm:col-span-2">
        <Button loading={pending} onClick={async () => (await submit(() => updateOwnProfile(v)))?.ok && router.refresh()}>
          Shrani
        </Button>
      </div>
    </div>
  );
}

export function ChangePasswordForm() {
  const { submit, pending, error, fieldErrors } = useSubmit();
  const [v, setV] = useState({ password: "", confirm: "" });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormError message={error} />
      </div>
      <Field label="Novo geslo" error={fieldErrors.password} hint="Vsaj 10 znakov, črke in številke. Ostale naprave bodo odjavljene.">
        <Input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
      </Field>
      <Field label="Ponovite geslo" error={fieldErrors.confirm}>
        <Input type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} />
      </Field>
      <div className="sm:col-span-2">
        <Button
          loading={pending}
          onClick={async () => {
            const res = await submit(() => changeOwnPassword(v));
            if (res?.ok) setV({ password: "", confirm: "" });
          }}
        >
          Spremeni geslo
        </Button>
      </div>
    </div>
  );
}

/** Calendar invitations by e-mail for the agent's own appointments. */
export function InviteSettingsForm({ initial, loginEmail, configured }: { initial: { enabled: boolean; email: string }; loginEmail: string; configured: boolean }) {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit();
  const test = useSubmit<{ to: string }>();
  const [v, setV] = useState(initial);
  const dirty = v.enabled !== initial.enabled || v.email.trim().toLowerCase() !== initial.email;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <FormError message={error ?? test.error} />
      {!configured && (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">Pošiljanje e-pošte še ni nastavljeno, zato se vabila trenutno ne pošiljajo. Nastavi ga lastnik (poštni predal v Vercel).</p>
      )}
      <label className="flex items-center gap-3">
        <input type="checkbox" className="size-5 accent-[#c6a24b]" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />
        <span className="font-medium">Pošlji mi vabilo za koledar ob vsakem novem ali spremenjenem terminu</span>
      </label>
      <Field label="E-poštni naslov za vabila" error={fieldErrors.email} hint={`Prazno = ${loginEmail}. Vpišite naslov, katerega koledar uporabljate (npr. službeni Outlook).`}>
        <Input type="email" placeholder={loginEmail} value={v.email} disabled={!v.enabled} onChange={(e) => setV({ ...v, email: e.target.value })} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button loading={pending} disabled={!dirty} onClick={async () => (await submit(() => setInviteSettings(v)))?.ok && router.refresh()}>
          Shrani
        </Button>
        <Button
          variant="secondary"
          loading={test.pending}
          disabled={dirty || !configured}
          onClick={async () => {
            const res = await test.submit(() => sendOwnTestInvite());
            if (res?.ok) toast.success(`Testno vabilo je poslano na ${res.data.to}. Preverite pošto in koledar.`);
          }}
        >
          Pošlji testno vabilo
        </Button>
      </div>
      <p className="text-xs text-ink-3">
        Dobite običajno e-poštno vabilo (kot od sodelavca). Termin se pokaže v vašem koledarju; ob spremembi ure se posodobi, ob preklicu izgine. V vaš poštni predal ali koledar se nič ne namešča in CRM do njega nima dostopa.
      </p>
    </div>
  );
}
