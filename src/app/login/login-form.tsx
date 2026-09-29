"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error ?? notice} />
      <Field label="E-pošta" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Geslo" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" loading={pending} className="mt-1 w-full">
        Prijava
      </Button>
    </form>
  );
}
