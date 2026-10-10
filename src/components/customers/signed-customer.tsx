"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { uploadDocument } from "@/components/shared/upload-document";
import { PolicyCard, newPolicy, type PolicyDraft } from "@/components/appointments/record-result-dialog";
import { addSignedCustomer, type SignedCustomerResult } from "@/server/actions/results";
import type { DuplicateMatch } from "@/server/duplicates";
import type { CommissionRates, PersonOption } from "@/server/queries/people";

type Product = { id: string; name: string; commission_model?: "standard" | "agent_multiplier" };
type Props = { ownerId: string; agents: PersonOption[]; callers: PersonOption[]; products: Product[]; rates: CommissionRates };

/** Owner shortcut: customer who already signed – no appointment to type in. */
export function SignedCustomerButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <BadgeCheck className="size-4" /> Dodaj podpisano stranko
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="lg" title="Dodaj podpisano stranko" description="Za stranke, ki so že podpisale. Termina ni treba vnašati – vpišite samo stranko in polico.">
        {open && (
          <SignedCustomerForm
            key={formKey}
            {...props}
            onClose={() => setOpen(false)}
            onAnother={() => setFormKey((k) => k + 1)}
          />
        )}
      </Dialog>
    </>
  );
}

function SignedCustomerForm({ ownerId, agents, callers, products, rates, onClose, onAnother }: Props & { onClose: () => void; onAnother: () => void }) {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit<SignedCustomerResult>();
  const [c, setC] = useState({ first_name: "", last_name: "", phone: "", email: "", address: "", postal_code: "", city: "" });
  const [agentId, setAgentId] = useState(agents.some((a) => a.id === ownerId) ? ownerId : (agents[0]?.id ?? ""));
  const [callerId, setCallerId] = useState("");
  const [note, setNote] = useState("");
  const [policies, setPolicies] = useState<PolicyDraft[]>([newPolicy(1)]);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [uploading, setUploading] = useState(false);

  const set = (patch: Partial<typeof c>) => {
    setC((v) => ({ ...v, ...patch }));
    setDuplicates(null);
  };
  const updatePolicy = (key: number, patch: Partial<PolicyDraft>) => setPolicies((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function save(confirmDuplicate: boolean, another: boolean) {
    const res = await submit(() =>
      addSignedCustomer({
        ...c,
        agent_id: agentId,
        caller_id: callerId,
        note,
        confirm_duplicate: confirmDuplicate,
        policies: policies.map((p) => ({
          product_id: p.product_id,
          monthly_premium: p.monthly_premium,
          duration_years: p.duration_years,
          policy_date: p.policy_date,
          policy_number: p.policy_number,
        })),
      }),
    );
    if (!res?.ok) return;
    if (res.data.status === "duplicate") {
      setDuplicates(res.data.matches);
      return;
    }
    const { customer_id, policy_ids } = res.data;
    const withFiles = policies.map((p, i) => ({ file: p.file, policyId: policy_ids[i] })).filter((x) => x.file && x.policyId);
    if (withFiles.length) {
      setUploading(true);
      let failed = 0;
      for (const { file, policyId } of withFiles) {
        try {
          await uploadDocument(file!, { customerId: customer_id, policyId, type: "signed_policy" });
        } catch {
          failed++;
        }
      }
      setUploading(false);
      if (failed) toast.warning(`Stranka je shranjena, vendar ${failed} dokument(ov) ni bilo naloženih. Naložite jih na strani police.`);
    }
    router.refresh();
    if (another) onAnother();
    else onClose();
  }

  const busy = pending || uploading;
  return (
    <div className="flex flex-col gap-5">
      <FormError message={error} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Ime" required error={fieldErrors.first_name}>
          <Input value={c.first_name} onChange={(e) => set({ first_name: e.target.value })} autoFocus />
        </Field>
        <Field label="Priimek" required error={fieldErrors.last_name}>
          <Input value={c.last_name} onChange={(e) => set({ last_name: e.target.value })} />
        </Field>
        <Field label="Telefon" required error={fieldErrors.phone}>
          <Input type="tel" inputMode="tel" placeholder="npr. 041 123 456" value={c.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
      </section>

      <details className="rounded-lg border border-line px-3 py-2" open={!!(fieldErrors.email || fieldErrors.postal_code)}>
        <summary className="cursor-pointer text-sm font-semibold">
          Več o stranki <span className="font-normal text-ink-3">(neobvezno – e-pošta, naslov)</span>
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-6">
          <Field label="E-pošta" error={fieldErrors.email} className="sm:col-span-3">
            <Input type="email" value={c.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Naslov" className="sm:col-span-3">
            <Input value={c.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
          <Field label="Poštna št." error={fieldErrors.postal_code} className="sm:col-span-2">
            <Input inputMode="numeric" maxLength={4} value={c.postal_code} onChange={(e) => set({ postal_code: e.target.value })} />
          </Field>
          <Field label="Kraj" className="sm:col-span-4">
            <Input value={c.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
        </div>
      </details>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kdo je podpisal stranko?" required error={fieldErrors.agent_id}>
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.id === ownerId ? " (jaz)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Klicateljica" hint="Izberite samo, če ji za to stranko pripada provizija.">
          <Select value={callerId} onChange={(e) => setCallerId(e.target.value)}>
            <option value="">Brez klicateljice</option>
            {callers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        {fieldErrors["policies"] && <FormError message={fieldErrors["policies"]} />}
        {policies.map((p, idx) => (
          <PolicyCard
            key={p.key}
            index={idx}
            draft={p}
            products={products}
            errors={fieldErrors}
            agentRatePercent={rates.agents[agentId] ?? null}
            agentMultiplier={rates.agentProducts[agentId]?.[p.product_id] ?? null}
            productModel={products.find((x) => x.id === p.product_id)?.commission_model ?? "standard"}
            callerMultiplier={callerId ? (rates.callers[callerId] ?? null) : null}
            canRemove={policies.length > 1}
            onChange={(patch) => updatePolicy(p.key, patch)}
            onRemove={() => setPolicies((ps) => ps.filter((x) => x.key !== p.key))}
          />
        ))}
        <Button variant="secondary" onClick={() => setPolicies((ps) => [...ps, newPolicy(Math.max(...ps.map((x) => x.key)) + 1)])} className="self-start">
          <Plus className="size-4" /> Dodaj še eno polico
        </Button>
      </section>

      <Field label="Opomba">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {duplicates && (
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          <p className="font-semibold text-warning">Stranka s tem telefonom ali e-pošto že obstaja:</p>
          <ul className="mt-1 list-disc pl-5">
            {duplicates.map((d, i) => (
              <li key={i}>
                {d.id ? (
                  <Link href={`/customers/${d.id}`} className="font-medium underline">
                    {d.label}
                  </Link>
                ) : (
                  d.label
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDuplicates(null)}>
              Prekliči
            </Button>
            <Button size="sm" variant="gold" loading={busy} onClick={() => save(true, false)}>
              Vseeno shrani kot novo stranko
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Prekliči
        </Button>
        <Button variant="secondary" onClick={() => save(false, true)} disabled={busy || !!duplicates}>
          Shrani in dodaj naslednjo
        </Button>
        <Button variant="gold" onClick={() => save(false, false)} loading={busy} disabled={!!duplicates}>
          {uploading ? "Nalagam dokumente…" : "Shrani stranko"}
        </Button>
      </div>
    </div>
  );
}
