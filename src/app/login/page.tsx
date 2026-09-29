import type { Metadata } from "next";
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
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-brand text-sm font-bold text-white">Z</span>
          <span className="text-lg font-semibold tracking-tight">ZAN CRM</span>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-base font-semibold">Prijava</h1>
          <p className="mt-1 mb-5 text-sm text-ink-3">Prijavite se s službenim e-poštnim naslovom.</p>
          <LoginForm notice={reason === "noaccess" ? "Vaš račun nima aktivnega dostopa do CRM." : undefined} />
        </div>
      </div>
    </div>
  );
}
