import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Prijava" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { reason } = await searchParams;
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" tagline />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-7 shadow-[0_8px_30px_rgb(0,0,0,0.06)]">
          <h1 className="text-base font-semibold">Prijava</h1>
          <p className="mt-1 mb-6 text-sm text-ink-3">Prijavite se s službenim e-poštnim naslovom in geslom.</p>
          <LoginForm notice={reason === "noaccess" ? "Vaš račun nima aktivnega dostopa do CRM." : undefined} />
        </div>
      </div>
    </div>
  );
}
