import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Nastavite geslo" };

/** First login with a temporary password: the user must choose their own before using the CRM. */
export default async function SetPasswordPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.mustChangePassword) redirect("/dashboard");
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" tagline />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-7 shadow-[0_8px_30px_rgb(0,0,0,0.06)]">
          <h1 className="text-base font-semibold">Nastavite svoje geslo</h1>
          <p className="mt-1 mb-5 text-sm text-ink-3">
            Pozdravljeni, {session.profile.first_name}. Prijavili ste se z začasnim geslom. Pred uporabo CRM si izberite svoje geslo, ki ga poznate samo vi.
          </p>
          <SetPasswordForm />
        </div>
      </div>
    </div>
  );
}
