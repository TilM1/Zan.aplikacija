"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CalendarCheck, ChevronLeft, ChevronRight, Clock, Phone, ThumbsDown } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FormError, Input, Textarea } from "@/components/ui/form";
import { LEAD_STATUS_LABELS } from "@/lib/labels";
import { addDays, formatDate, formatDateTime, todayIso } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { addLeadComment, fetchLeadDetail, setLeadStatus } from "@/server/actions/leads";
import type { Lead, LeadEvent } from "@/types/domain";
import { cn } from "@/lib/utils";

type Detail = { lead: Lead & { list: { name: string } | null }; events: LeadEvent[] };
type Mode = null | "callback" | "rejected" | "do_not_call";

const QUICK_DAYS = [
  { label: "Jutri", days: 1 },
  { label: "Čez 2 dni", days: 2 },
  { label: "Čez 1 teden", days: 7 },
  { label: "Čez 2 tedna", days: 14 },
  { label: "Čez 1 mesec", days: 30 },
];

export function LeadDialog({
  leadIds,
  openId,
  onOpenChange,
  names,
  recallMonths,
}: {
  /** Order of leads on the current page (for Previous / Next). */
  leadIds: string[];
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  names: Record<string, string>;
  recallMonths: number;
}) {
  const [autoNext, setAutoNext] = useState(true);
  const index = openId ? leadIds.indexOf(openId) : -1;
  const nextId = index >= 0 && index < leadIds.length - 1 ? leadIds[index + 1] : null;
  const prevId = index > 0 ? leadIds[index - 1] : null;

  return (
    <Dialog
      open={!!openId}
      onClose={() => onOpenChange(null)}
      size="lg"
      title={index >= 0 ? `Kontakt ${index + 1} / ${leadIds.length}` : "Kontakt"}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="secondary" size="sm" disabled={!prevId} onClick={() => prevId && onOpenChange(prevId)}>
            <ChevronLeft className="size-4" /> Prejšnji
          </Button>
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" className="accent-[#c6a24b]" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} />
            Po shranjevanju odpri naslednjega
          </label>
          <Button variant="secondary" size="sm" disabled={!nextId} onClick={() => nextId && onOpenChange(nextId)}>
            Naslednji <ChevronRight className="size-4" />
          </Button>
        </div>
      }
    >
      {openId && (
        <LeadBody
          key={openId}
          id={openId}
          names={names}
          recallMonths={recallMonths}
          onSaved={() => {
            if (autoNext && nextId) onOpenChange(nextId);
            return autoNext && !!nextId;
          }}
        />
      )}
    </Dialog>
  );
}

function LeadBody({ id, names, recallMonths, onSaved }: { id: string; names: Record<string, string>; recallMonths: number; onSaved: () => boolean }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [comment, setComment] = useState("");
  const [date, setDate] = useState(() => addDays(todayIso(), 1));
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchLeadDetail({ lead_id: id });
    if (res.ok) setDetail(res.data as Detail);
    else setLoadError(res.error);
  }, [id]);

  useEffect(() => {
    let alive = true;
    fetchLeadDetail({ lead_id: id }).then((res) => {
      if (!alive) return;
      if (res.ok) setDetail(res.data as Detail);
      else setLoadError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const done = (msg: string) => {
    toast.success(msg);
    router.refresh();
    if (!onSaved()) {
      setMode(null);
      setComment("");
      void load();
    }
  };

  async function saveStatus(status: "callback" | "rejected" | "do_not_call") {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await setLeadStatus({ lead_id: id, status, date: status === "callback" ? date : undefined, time, comment });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    done(status === "callback" ? `Ponovni klic: ${formatDate(date)} ob ${time}` : status === "rejected" ? `Zavrnjen – ponovno čez ${recallMonths} mes.` : "Označeno: ne želi klicev");
  }

  async function saveComment() {
    if (busy || !comment.trim()) return;
    setBusy(true);
    setError(null);
    const res = await addLeadComment({ lead_id: id, comment });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setComment("");
    toast.success("Komentar je shranjen.");
    void load();
    router.refresh();
  }

  const lead = detail?.lead;
  const closed = lead?.status === "appointment" || lead?.status === "do_not_call";

  if (loadError) return <FormError message={loadError} />;
  if (!lead) return <div className="h-64 animate-pulse rounded-lg bg-subtle" />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-lg font-semibold">{lead.name}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <Badge tone={LEAD_STATUS_LABELS[lead.status].tone}>{LEAD_STATUS_LABELS[lead.status].label}</Badge>
          {lead.next_call_at && lead.status !== "appointment" && <span>Naslednji klic: {formatDateTime(lead.next_call_at)}</span>}
          <span>· Seznam: {lead.list?.name}</span>
        </p>
      </div>
      <a
        href={`tel:${lead.phone_normalized}`}
        className="flex items-center justify-center gap-3 rounded-xl bg-ink px-4 py-3.5 text-lg font-semibold text-white tabular hover:bg-black"
      >
        <Phone className="size-5 text-gold" /> {formatPhone(lead.phone_normalized)}
      </a>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Info label="Naslov" value={[lead.street, [lead.postal_code, lead.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")} />
        <Info label="Dejavnost" value={lead.activity} />
        <Info label="Davčna številka" value={lead.tax_number} />
        <Info label="E-pošta" value={lead.email} />
        <Info label="Klicano" value={lead.contact_count ? `${lead.contact_count}× · zadnjič ${formatDateTime(lead.last_contacted_at)} (${names[lead.last_contacted_by ?? ""] ?? "–"})` : "Še ne"} />
        {lead.existing_customer_id && <Info label="Opozorilo" value={<Badge tone="warning">Že obstaja kot stranka v CRM</Badge>} />}
      </dl>
      {Object.keys(lead.extra ?? {}).length > 0 && (
        <details className="rounded-lg border border-line px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-ink-2">Ostali podatki iz datoteke ({Object.keys(lead.extra).length})</summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {Object.entries(lead.extra).map(([k, v]) => (
              <Info key={k} label={k} value={v} />
            ))}
          </dl>
        </details>
      )}

      {lead.status === "appointment" ? (
        <div className="rounded-lg bg-success-soft px-4 py-3 text-sm text-success">
          Termin je dogovorjen.{" "}
          {lead.customer_id && (
            <a className="font-semibold underline" href={`/customers/${lead.customer_id}`}>
              Odpri stranko
            </a>
          )}
        </div>
      ) : lead.status === "do_not_call" ? (
        <div className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">Kontakt ne želi klicev. Številka je trajno na seznamu »Ne kliči«.</div>
      ) : (
        <>
          <div>
            <p className="mb-2 text-sm font-semibold">Kako se je končal klic?</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatusButton icon={CalendarCheck} label="Termin dogovorjen" tone="gold" onClick={() => router.push(`/appointments/new?lead=${lead.id}`)} />
              <StatusButton icon={Clock} label="Ponovni klic" active={mode === "callback"} onClick={() => setMode("callback")} />
              <StatusButton icon={ThumbsDown} label="Zavrnjen" active={mode === "rejected"} onClick={() => setMode("rejected")} />
              <StatusButton icon={Ban} label="Ne želi klicev" tone="danger" active={mode === "do_not_call"} onClick={() => setMode("do_not_call")} />
            </div>
          </div>

          {mode === "callback" && (
            <div className="rounded-lg border border-line bg-subtle/50 p-3">
              <p className="mb-2 text-sm font-medium">Kdaj pokličem ponovno?</p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {QUICK_DAYS.map((q) => {
                  const d = addDays(todayIso(), q.days);
                  return (
                    <button
                      key={q.days}
                      type="button"
                      onClick={() => setDate(d)}
                      className={cn("rounded-lg border px-3 py-1.5 text-sm", date === d ? "border-gold bg-gold-soft font-semibold" : "border-line bg-surface hover:border-gold")}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
                <Field label="Datum">
                  <Input type="date" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Ura">
                  <Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
                </Field>
              </div>
            </div>
          )}
          {mode === "rejected" && (
            <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-ink-2">
              Kontakt se bo v seznamu »Za klic« ponovno pojavil čez <b>{recallMonths} mesecev</b> (nastavi lastnik).
            </p>
          )}
          {mode === "do_not_call" && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              Oseba ne želi več klicev. Številka se trajno doda na seznam »Ne kliči« in je ne bomo več klicali – tudi če pride v novi datoteki.
            </p>
          )}
        </>
      )}

      <Field label={mode ? "Komentar (neobvezno)" : "Komentar"}>
        <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Npr. pokliči po 16h, zanima ga zavarovanje za otroke…" />
      </Field>
      <FormError message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        {!mode && !closed && (
          <Button variant="secondary" disabled={!comment.trim()} loading={busy} onClick={saveComment}>
            Shrani samo komentar
          </Button>
        )}
        {closed && (
          <Button variant="secondary" disabled={!comment.trim()} loading={busy} onClick={saveComment}>
            Shrani komentar
          </Button>
        )}
        {mode && (
          <Button variant={mode === "do_not_call" ? "danger" : "gold"} loading={busy} onClick={() => saveStatus(mode)}>
            {mode === "callback" ? `Shrani ponovni klic (${formatDate(date)})` : mode === "rejected" ? "Shrani: zavrnjen" : "Potrdi: ne želi klicev"}
          </Button>
        )}
      </div>

      {detail.events.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Zgodovina</p>
          <ol className="flex flex-col gap-2 border-l-2 border-line pl-3">
            {detail.events.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-xs text-ink-3">
                  {formatDateTime(e.created_at)} · {names[e.actor_id ?? ""] ?? "–"}
                </span>
                <p>
                  {e.action === "comment" ? (
                    "💬 "
                  ) : (
                    <Badge tone={LEAD_STATUS_LABELS[e.status_to ?? "new"].tone} className="mr-1.5">
                      {LEAD_STATUS_LABELS[e.status_to ?? "new"].label}
                    </Badge>
                  )}
                  {e.action === "status_changed" && e.status_to === "callback" && e.next_call_at && <span className="mr-1 text-ink-2">na {formatDateTime(e.next_call_at)}.</span>}
                  {e.comment}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="break-words">{value || "–"}</dd>
    </div>
  );
}

function StatusButton({
  icon: Icon,
  label,
  onClick,
  active,
  tone = "default",
}: {
  icon: typeof Clock;
  label: string;
  onClick: () => void;
  active?: boolean;
  tone?: "default" | "gold" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center text-sm font-semibold transition-colors",
        tone === "gold" && "border-gold bg-gold text-ink hover:bg-gold-hover",
        tone === "danger" && (active ? "border-danger bg-danger text-white" : "border-danger/30 text-danger hover:bg-danger-soft"),
        tone === "default" && (active ? "border-ink bg-ink text-white" : "border-line-strong bg-surface hover:border-gold hover:bg-gold-soft"),
      )}
    >
      <Icon className="size-5" />
      {label}
    </button>
  );
}
