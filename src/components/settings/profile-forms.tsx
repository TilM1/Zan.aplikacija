"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { changeOwnPassword, updateOwnProfile } from "@/server/actions/profile";

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
      <Field label="Novo geslo" error={fieldErrors.password} hint="Vsaj 10 znakov">
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
