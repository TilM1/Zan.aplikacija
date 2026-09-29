"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { SlotFields, emptySlot, type SlotValue } from "./slot-fields";
import { useSubmit } from "@/components/shared/use-submit";
import { uploadDocument } from "@/components/shared/upload-document";
import { recordResult, type RecordResultData } from "@/server/actions/results";
import { RESULT_DESCRIPTIONS, RESULT_LABELS } from "@/lib/labels";
import { buildPolicyCommissions } from "@/lib/commission/engine";
import { formatDecimalEur, isValidMoneyInput } from "@/lib/money";
import { formatDate, formatDateTime, todayIso } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ConsultationResult } from "@/types/domain";
import type { PersonOption } from "@/server/queries/people";

export interface ResultTarget {
  id: string;
  customerId: string;
  customerName: string;
  scheduledAt: string;
  agentId: string;
  hasCaller: boolean;
  callerName?: string;
}

interface PolicyDraft {
  key: number;
  product_id: string;
  monthly_premium: string;
  duration_years: string;
  policy_date: string;
  policy_number: string;
  file: File | null;
}

const newPolicy = (key: number): PolicyDraft => ({
  key,
  product_id: "",
  monthly_premium: "",
  duration_years: "",
  policy_date: todayIso(),
  policy_number: "",
  file: null,
});

const RESULTS: ConsultationResult[] = ["A1", "A", "A0", "B"];

export function RecordResultDialog({
  target,
  initialResult,
  agents,
  products,
  agentRatePercent,
  onClose,
}: {
  target: ResultTarget | null;
  initialResult?: ConsultationResult;
  agents: PersonOption[];
  products: { id: string; name: string }[];
  /** Rate of the appointment's agent, if visible to the user (for the preview only). */
  agentRatePercent: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      size="lg"
      title="Rezultat svetovanja"
      description={target ? `${target.customerName} · ${formatDateTime(target.scheduledAt)}` : undefined}
    >
      {target && (
        <ResultForm
          key={`${target.id}-${initialResult ?? ""}`}
          target={target}
          initialResult={initialResult}
          agents={agents}
          products={products}
          agentRatePercent={agentRatePercent}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
}

function ResultForm({
  target,
  initialResult,
  agents,
  products,
  agentRatePercent,
  onDone,
}: {
  target: ResultTarget;
  initialResult?: ConsultationResult;
  agents: PersonOption[];
  products: { id: string; name: string }[];
  agentRatePercent: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit<RecordResultData>();
  const [result, setResult] = useState<ConsultationResult | null>(initialResult ?? null);
  const [note, setNote] = useState("");
  const [next, setNext] = useState<SlotValue>(emptySlot(target.agentId));
  const [policies, setPolicies] = useState<PolicyDraft[]>([newPolicy(1)]);
  const [uploading, setUploading] = useState(false);

  const updatePolicy = (key: number, patch: Partial<PolicyDraft>) => setPolicies((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function onSubmit() {
    if (!result) return;
    const base = { result, appointment_id: target.id, note };
    const payload =
      result === "A"
        ? { ...base, next }
        : result === "A1"
          ? {
              ...base,
              policies: policies.map((p) => ({
                product_id: p.product_id,
                monthly_premium: p.monthly_premium,
                duration_years: p.duration_years,
                policy_date: p.policy_date,
                policy_number: p.policy_number,
              })),
            }
          : base;

    const res = await submit(() => recordResult(payload));
    if (!res?.ok) return;

    if (result === "A1") {
      const withFiles = policies.map((p, i) => ({ file: p.file, policyId: res.data.policy_ids[i] })).filter((x) => x.file && x.policyId);
      if (withFiles.length) {
        setUploading(true);
        let failed = 0;
        for (const { file, policyId } of withFiles) {
          try {
            await uploadDocument(file!, { customerId: target.customerId, policyId, type: "signed_policy" });
          } catch {
            failed++;
          }
        }
        setUploading(false);
        if (failed) toast.warning(`Police so shranjene, vendar ${failed} dokument(ov) ni bilo naloženih. Naložite jih na strani police.`);
        else toast.success("Podpisane police so naložene.");
      }
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="flex flex-col gap-5">
      <FormError message={error} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {RESULTS.map((r) => {
          const meta = RESULT_LABELS[r];
          const active = result === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setResult(r)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                active ? "border-brand bg-brand-soft ring-1 ring-brand" : "border-line hover:border-line-strong hover:bg-subtle",
              )}
            >
              <span
                className={cn(
                  "inline-block rounded px-1.5 text-xs font-bold",
                  meta.tone === "success" && "bg-success-soft text-success",
                  meta.tone === "info" && "bg-info-soft text-info",
                  meta.tone === "danger" && "bg-danger-soft text-danger",
                  meta.tone === "warning" && "bg-warning-soft text-warning",
                )}
              >
                {meta.short}
              </span>
              <span className="mt-1 block text-sm font-medium">{meta.label}</span>
            </button>
          );
        })}
      </div>

      {result && <p className="-mt-2 text-sm text-ink-3">{RESULT_DESCRIPTIONS[result]}</p>}

      {result === "A" && (
        <section className="rounded-lg border border-line p-4">
          <h3 className="mb-3 text-sm font-semibold">Nov termin</h3>
          <SlotFields value={next} onChange={setNext} agents={agents} errors={fieldErrors} prefix="next." agentLabel="Zastopnik za naslednji termin" />
        </section>
      )}

      {result === "B" && (
        <div className="rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-sm text-warning">
          Stranka bo vrnjena {target.callerName ? <b>{target.callerName}</b> : "odgovornemu klicatelju"} v seznam »Klici nazaj«. Klicatelj dogovori nov termin.
        </div>
      )}

      {result === "A1" && (
        <section className="flex flex-col gap-3">
          {fieldErrors["policies"] && <FormError message={fieldErrors["policies"]} />}
          {policies.map((p, idx) => (
            <PolicyCard
              key={p.key}
              index={idx}
              draft={p}
              products={products}
              errors={fieldErrors}
              agentRatePercent={agentRatePercent}
              hasCaller={target.hasCaller}
              canRemove={policies.length > 1}
              onChange={(patch) => updatePolicy(p.key, patch)}
              onRemove={() => setPolicies((ps) => ps.filter((x) => x.key !== p.key))}
            />
          ))}
          <Button variant="secondary" onClick={() => setPolicies((ps) => [...ps, newPolicy(Math.max(...ps.map((x) => x.key)) + 1)])} className="self-start">
            <Plus className="size-4" /> Dodaj še eno polico
          </Button>
        </section>
      )}

      {result && (
        <Field label={result === "A0" ? "Razlog / opomba" : "Opomba k svetovanju"}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={pending || uploading}>
          Prekliči
        </Button>
        <Button onClick={onSubmit} disabled={!result} loading={pending || uploading}>
          {uploading ? "Nalagam dokumente…" : result === "A1" ? `Shrani ${policies.length > 1 ? `${policies.length} police` : "polico"}` : "Shrani rezultat"}
        </Button>
      </div>
    </div>
  );
}

function PolicyCard({
  index,
  draft,
  products,
  errors,
  agentRatePercent,
  hasCaller,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  draft: PolicyDraft;
  products: { id: string; name: string }[];
  errors: Record<string, string>;
  agentRatePercent: string | null;
  hasCaller: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<PolicyDraft>) => void;
  onRemove: () => void;
}) {
  const err = (k: string) => errors[`policies.${index}.${k}`];

  const preview = useMemo(() => {
    const years = Number(draft.duration_years);
    if (!agentRatePercent || !isValidMoneyInput(draft.monthly_premium) || !Number.isInteger(years) || years < 1 || !draft.policy_date) return null;
    try {
      return buildPolicyCommissions({
        monthlyPremium: draft.monthly_premium.replace(",", "."),
        durationYears: years,
        policyDate: draft.policy_date,
        agentRatePercent,
        hasCaller,
      });
    } catch {
      return null;
    }
  }, [draft.monthly_premium, draft.duration_years, draft.policy_date, agentRatePercent, hasCaller]);

  return (
    <div className="rounded-lg border border-line p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Polica {index + 1}</h3>
        {canRemove && (
          <button type="button" onClick={onRemove} className="rounded p-1 text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label="Odstrani polico">
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <Field label="Produkt" required error={err("product_id")} className="sm:col-span-3">
          <Select value={draft.product_id} onChange={(e) => onChange({ product_id: e.target.value })} aria-invalid={!!err("product_id")}>
            <option value="">Izberite produkt…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mesečna premija (€)" required error={err("monthly_premium")} className="sm:col-span-3">
          <Input inputMode="decimal" placeholder="npr. 45,00" value={draft.monthly_premium} onChange={(e) => onChange({ monthly_premium: e.target.value })} aria-invalid={!!err("monthly_premium")} />
        </Field>
        <Field label="Trajanje (let)" required error={err("duration_years")} className="sm:col-span-2">
          <Input type="number" min={1} max={100} value={draft.duration_years} onChange={(e) => onChange({ duration_years: e.target.value })} aria-invalid={!!err("duration_years")} />
        </Field>
        <Field label="Datum police" required error={err("policy_date")} className="sm:col-span-2">
          <Input type="date" value={draft.policy_date} onChange={(e) => onChange({ policy_date: e.target.value })} aria-invalid={!!err("policy_date")} />
        </Field>
        <Field label="Št. police" className="sm:col-span-2">
          <Input value={draft.policy_number} onChange={(e) => onChange({ policy_number: e.target.value })} />
        </Field>
        <div className="sm:col-span-6">
          <label className={cn("flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-3 py-2.5 text-sm", draft.file ? "border-success/40 bg-success-soft" : "border-line-strong hover:bg-subtle")}>
            <FileUp className={cn("size-4", draft.file ? "text-success" : "text-ink-3")} />
            <span className="min-w-0 flex-1 truncate">
              {draft.file ? draft.file.name : <>Naloži podpisano polico <span className="text-ink-3">(priporočeno · PDF ali slika, do 25 MB)</span></>}
            </span>
            <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => onChange({ file: e.target.files?.[0] ?? null })} />
          </label>
        </div>
      </div>
      {preview && (
        <div className="mt-3 grid gap-1 rounded-md bg-subtle px-3 py-2 text-xs text-ink-2 sm:grid-cols-2">
          <p>
            Provizija zastopnika: <b className="tabular">{formatDecimalEur(preview.agent.total_amount)}</b>{" "}
            <span className="text-ink-3">({preview.agent.calculation.expression as string})</span>
          </p>
          <p>
            1. izplačilo {formatDecimalEur(preview.agent.installments[0].amount)} dne <b>{formatDate(preview.agent.installments[0].due_date)}</b>
          </p>
          {preview.caller && (
            <p>
              Provizija klicatelja: <b className="tabular">{formatDecimalEur(preview.caller.total_amount)}</b> ({formatDate(preview.caller.installments[0].due_date)})
            </p>
          )}
        </div>
      )}
    </div>
  );
}
