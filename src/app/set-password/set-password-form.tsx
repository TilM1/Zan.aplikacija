"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { changeOwnPassword } from "@/server/actions/profile";
import { signOut } from "@/server/actions/auth";

export function SetPasswordForm() {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit();
  const [v, setV] = useState({ password: "", confirm: "" });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await submit(() => changeOwnPassword(v));
        if (res?.ok) {
          router.replace("/dashboard");
          router.refresh();
        }
      }}
    >
      <FormError message={error} />
      <Field label="Novo geslo" error={fieldErrors.password} hint="Vsaj 10 znakov, črke in številke.">
        <Input type="password" autoComplete="new-password" autoFocus value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
      </Field>
      <Field label="Ponovite geslo" error={fieldErrors.confirm}>
        <Input type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} />
      </Field>
      <Button type="submit" loading={pending} className="w-full">
        Shrani geslo in nadaljuj
      </Button>
      <button type="button" onClick={() => signOut()} className="text-center text-xs text-ink-3 hover:text-ink">
        Odjava
      </button>
    </form>
  );
}
