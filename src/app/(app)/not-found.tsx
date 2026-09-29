import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-line bg-surface p-6 text-center">
      <h1 className="text-base font-semibold">Ni najdeno</h1>
      <p className="mt-1 text-sm text-ink-3">Zapis ne obstaja ali do njega nimate dostopa.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
        Na nadzorno ploščo
      </Link>
    </div>
  );
}
