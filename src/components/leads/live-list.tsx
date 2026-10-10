"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Radio } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { createLiveList } from "@/server/actions/leads";
import { buildAppsScript } from "@/lib/leads/apps-script";
import type { PersonOption } from "@/server/queries/people";

export type MemberDraft = { caller_id: string; notify: boolean };

/** Per caller: sees the list? gets a notification for every new contact? */
export function MembersPicker({ callers, value, onChange, showNotify = true }: { callers: PersonOption[]; value: MemberDraft[]; onChange: (v: MemberDraft[]) => void; showNotify?: boolean }) {
  const get = (id: string) => value.find((m) => m.caller_id === id);
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, { caller_id: id, notify: false }] : value.filter((m) => m.caller_id !== id));
  const setNotify = (id: string, notify: boolean) => onChange(value.map((m) => (m.caller_id === id ? { ...m, notify } : m)));
  if (callers.length === 0) return <p className="text-sm text-ink-3">Ni aktivnih klicateljic.</p>;
  return (
    <div className="rounded-lg border border-line">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-line bg-subtle px-3 py-2 text-xs font-semibold text-ink-2">
        <span>Klicateljica</span>
        <span>Vidi seznam</span>
        {showNotify && <span>Obvestilo ob novem kontaktu</span>}
      </div>
      {callers.map((c) => {
        const m = get(c.id);
        return (
          <label key={c.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-line px-3 py-2 text-sm last:border-0">
            <span>{c.name}</span>
            <input type="checkbox" className="size-5 justify-self-center accent-[#c6a24b]" checked={!!m} onChange={(e) => toggle(c.id, e.target.checked)} aria-label={`${c.name} vidi seznam`} />
            {showNotify && (
              <input
                type="checkbox"
                className="size-5 justify-self-center accent-[#c6a24b] disabled:opacity-30"
                checked={!!m?.notify}
                disabled={!m}
                onChange={(e) => setNotify(c.id, e.target.checked)}
                aria-label={`${c.name} dobi obvestilo`}
              />
            )}
          </label>
        );
      })}
      <p className="px-3 py-2 text-xs text-ink-3">
        {value.length === 0 ? "Nobena ni izbrana → seznam vidijo vse klicateljice, obvestila ne dobi nobena." : "Seznam vidijo samo označene. Obvestilo dobi tista, ki ima kljukico v desnem stolpcu."}
      </p>
    </div>
  );
}

export function ScriptInstructions({ token, tab }: { token: string; tab: string }) {
  const [copied, setCopied] = useState(false);
  const script = buildAppsScript({ origin: typeof window === "undefined" ? "" : window.location.origin, token, tab });
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>
          Odprite Google tabelo → meni <b>Razširitve → Apps Script</b>.
        </li>
        <li>
          Izbrišite vse, kar je v oknu s kodo, in <b>prilepite spodnjo kodo</b>. Kliknite ikono diskete (Shrani).
        </li>
        <li>
          Zgoraj v spustnem seznamu izberite funkcijo <b>namesti</b> in kliknite <b>Zaženi</b>.
        </li>
        <li>
          Google vpraša za dovoljenje: izberite svoj račun → »Napredno« → »Pojdi na projekt« → <b>Dovoli</b>.
        </li>
        <li>Končano. Obstoječi kontakti se prenesejo takoj, novi pa vsako minuto. Tabela ostane nespremenjena.</li>
      </ol>
      <div className="relative">
        <pre className="max-h-64 overflow-auto rounded-lg bg-ink p-3 text-[11px] leading-relaxed text-white/90">{script}</pre>
        <Button
          size="sm"
          variant="gold"
          className="absolute top-2 right-2"
          onClick={async () => {
            await navigator.clipboard.writeText(script);
            setCopied(true);
            toast.success("Koda je kopirana.");
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Kopirano" : "Kopiraj kodo"}
        </Button>
      </div>
      <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
        Koda vsebuje skrivni ključ za povezavo – ne delite je z nikomer. Prikazana je samo zdaj; če jo izgubite, pri seznamu kliknite »Nova povezava«.
      </p>
    </div>
  );
}

export function LiveListCard({ callers }: { callers: PersonOption[] }) {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit<{ list_id: string; token: string }>();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "Specialisti – oglasi", source_label: "Facebook oglas", source_tab: "SPECIALISTI" });
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [created, setCreated] = useState<{ token: string; tab: string } | null>(null);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Radio className="size-4 text-brand" /> Live seznam iz Google Sheets
          </span>
        }
        description="Kontakti iz oglasov, ki se sami zbirajo v Google tabeli, se vsako minuto prenesejo v klicni seznam."
        actions={
          !open && !created ? (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              Nov live seznam
            </Button>
          ) : undefined
        }
      />
      {created ? (
        <CardBody className="flex flex-col gap-3">
          <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">Live seznam je ustvarjen. Še zadnji korak – povežite Google tabelo:</p>
          <ScriptInstructions token={created.token} tab={created.tab} />
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              setCreated(null);
              setOpen(false);
              router.refresh();
            }}
          >
            Končano
          </Button>
        </CardBody>
      ) : open ? (
        <CardBody className="flex flex-col gap-4">
          <FormError message={error} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Ime seznama" required error={fieldErrors.name}>
              <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            </Field>
            <Field label="Vir (prikazano pri kontaktu)">
              <Input value={v.source_label} onChange={(e) => setV({ ...v, source_label: e.target.value })} />
            </Field>
            <Field label="Ime zavihka v tabeli" required error={fieldErrors.source_tab} hint="Točno tako, kot piše spodaj v Google tabeli.">
              <Input value={v.source_tab} onChange={(e) => setV({ ...v, source_tab: e.target.value })} />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">Kdo kliče ta seznam in kdo dobi obvestilo?</p>
            <MembersPicker callers={callers} value={members} onChange={setMembers} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Prekliči
            </Button>
            <Button
              variant="gold"
              loading={pending}
              onClick={async () => {
                const res = await submit(() => createLiveList({ ...v, members }));
                if (res?.ok) setCreated({ token: res.data.token, tab: v.source_tab });
              }}
            >
              Ustvari in pokaži navodila
            </Button>
          </div>
        </CardBody>
      ) : null}
    </Card>
  );
}
