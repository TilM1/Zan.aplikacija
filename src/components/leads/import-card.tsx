"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import {
  chunkRows,
  detectMapping,
  LEAD_FIELD_LABELS,
  LEAD_FIELDS,
  toLeadRows,
  type Cell,
  type LeadField,
  type Mapping,
} from "@/lib/leads/import";
import {
  createLeadList,
  deleteLeadList,
  finalizeLeadList,
} from "@/server/actions/leads";
import type { PersonOption } from "@/server/queries/people";

interface Parsed {
  fileName: string;
  headers: string[];
  rows: Cell[][];
}

/** Parse in a Web Worker; resolves with sheet rows. The returned cancel() stops it. */
function readSheetInWorker(file: File): {
  promise: Promise<Cell[][]>;
  cancel: () => void;
} {
  const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
    type: "module",
  });
  let cancel = () => {};
  const promise = new Promise<Cell[][]>((resolve, reject) => {
    cancel = () => {
      worker.terminate();
      reject(new Error("Branje je preklicano."));
    };
    worker.onmessage = (
      e: MessageEvent<{ ok: boolean; sheet?: Cell[][]; error?: string }>,
    ) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.sheet!);
      else
        reject(
          new Error(
            `Datoteke ni bilo mogoče prebrati (${e.data.error}). Poskusite jo v Excelu shraniti kot »CSV UTF-8« in naložite to datoteko.`,
          ),
        );
    };
    worker.onerror = () => {
      worker.terminate();
      reject(
        new Error(
          "Datoteke ni bilo mogoče prebrati. Poskusite jo v Excelu shraniti kot »CSV UTF-8«.",
        ),
      );
    };
    worker.postMessage({ file });
  });
  return { promise, cancel };
}

function checkExtension(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xls")) {
    throw new Error(
      "Stara oblika .xls ni podprta. V Excelu izberite »Shrani kot« → »Excelov delovni zvezek (.xlsx)« ali »CSV UTF-8« in poskusite znova.",
    );
  }
  if (!/\.(xlsx|csv|txt)$/.test(lower))
    throw new Error("Podprte so datoteke .xlsx in .csv.");
}

function toParsed(fileName: string, sheet: Cell[][]): Parsed {
  const nonEmpty = (r: Cell[]) =>
    r.some((c) => c !== null && c !== undefined && String(c).trim() !== "");
  const headerIdx = sheet.findIndex(nonEmpty);
  if (headerIdx < 0) throw new Error("Datoteka je prazna.");
  const headers = sheet[headerIdx].map((h, i) =>
    h === null || h === undefined || String(h).trim() === ""
      ? `Stolpec ${i + 1}`
      : String(h).trim(),
  );
  const rows = sheet.slice(headerIdx + 1).filter(nonEmpty);
  if (rows.length === 0) throw new Error("V datoteki ni vrstic s podatki.");
  if (rows.length > 200_000)
    throw new Error(
      "Datoteka ima več kot 200.000 vrstic. Razdelite jo na manjše dele.",
    );
  return { fileName, headers, rows };
}

export function ImportCard({ callers }: { callers: PersonOption[] }) {
  const router = useRouter();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [name, setName] = useState("");
  const [callerId, setCallerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState<{
    seconds: number;
    cancel: () => void;
  } | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    etaSeconds: number | null;
  } | null>(null);
  const [customize, setCustomize] = useState(false);
  const [failedListId, setFailedListId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    inserted: number;
    duplicates: number;
    suppressed: number;
    invalid: number;
  } | null>(null);

  const preview = useMemo(
    () =>
      parsed
        ? toLeadRows(parsed.headers, parsed.rows.slice(0, 5), mapping)
        : [],
    [parsed, mapping],
  );
  const missing = (["name", "phone"] as LeadField[]).filter(
    (f) => mapping[f] === undefined,
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setSummary(null);
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      checkExtension(file.name);
      const job = readSheetInWorker(file);
      const started = Date.now();
      setParsing({ seconds: 0, cancel: job.cancel });
      timer = setInterval(
        () =>
          setParsing((p) =>
            p
              ? { ...p, seconds: Math.round((Date.now() - started) / 1000) }
              : p,
          ),
        1000,
      );
      const p = toParsed(file.name, await job.promise);
      setParsed(p);
      setMapping(detectMapping(p.headers, p.rows.slice(0, 50)));
      setName(file.name.replace(/\.(xlsx|csv|txt)$/i, ""));
    } catch (e) {
      setParsed(null);
      setError((e as Error).message);
    } finally {
      if (timer) clearInterval(timer);
      setParsing(null);
    }
  }

  async function runImport() {
    if (!parsed || missing.length) return;
    setError(null);
    const rows = toLeadRows(parsed.headers, parsed.rows, mapping);
    const chunks = chunkRows(rows, 2500, 900_000);
    const mapped = new Set(Object.values(mapping));
    const created = await createLeadList({
      name,
      file_name: parsed.fileName,
      assigned_caller_id: callerId || null,
      mapping: Object.fromEntries(
        Object.entries(mapping).map(([f, i]) => [f, parsed.headers[i!]]),
      ),
      extra_columns: parsed.headers
        .filter((_, i) => !mapped.has(i))
        .slice(0, 60),
      total_rows: rows.length,
    });
    if (!created.ok) return setError(created.error);
    const listId = created.data.list_id;

    // Chunks go straight from the browser to Supabase (owner-only RPC), 4 at a time, with retries.
    const supabase = createBrowserSupabase();
    const total = { inserted: 0, duplicates: 0, suppressed: 0, invalid: 0 };
    const startedAt = Date.now();
    setProgress({ done: 0, total: rows.length, etaSeconds: null });
    let done = 0;
    let next = 0;
    let failure: string | null = null;

    const sendChunk = async (chunk: (typeof chunks)[number]) => {
      for (let attempt = 1; ; attempt++) {
        const { data, error: rpcError } = await supabase.rpc(
          "crm_import_leads_as_owner",
          { p_list_id: listId, p_rows: chunk },
        );
        if (!rpcError) return data as typeof total;
        // Business errors (P0001) are final; network/timeouts are retried
        if (rpcError.code === "P0001" || attempt >= 4)
          throw new Error(rpcError.message);
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    };
    const worker = async () => {
      while (!failure && next < chunks.length) {
        const chunk = chunks[next++];
        try {
          const res = await sendChunk(chunk);
          total.inserted += res.inserted;
          total.duplicates += res.duplicates;
          total.suppressed += res.suppressed;
          total.invalid += res.invalid;
          done += chunk.length;
          setProgress({
            done,
            total: rows.length,
            etaSeconds: Math.max(
              1,
              Math.round(
                (((Date.now() - startedAt) / done) * (rows.length - done)) /
                  1000,
              ),
            ),
          });
        } catch (e) {
          failure = `Uvoz se je ustavil pri vrstici ${chunk[0].row_number}: ${(e as Error).message}`;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, chunks.length) }, worker),
    );
    if (failure) {
      setProgress(null);
      setFailedListId(listId);
      return setError(failure);
    }
    const fin = await finalizeLeadList({ list_id: listId });
    setProgress(null);
    if (!fin.ok) {
      setFailedListId(listId);
      return setError(fin.error);
    }
    setSummary(total);
    setParsed(null);
    toast.success(
      `Uvoženih ${total.inserted.toLocaleString("sl-SI")} kontaktov.`,
    );
    router.refresh();
  }

  async function cancelFailed() {
    if (!failedListId) return;
    const res = await deleteLeadList({ list_id: failedListId });
    if (res.ok) {
      setFailedListId(null);
      setError(null);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader
        title="Uvoz kontaktov za klicanje"
        description="Excel (.xlsx) ali CSV. Prva vrstica naj vsebuje imena stolpcev. Vsaka datoteka postane svoj klicni seznam (mapa)."
      />
      <CardBody className="flex flex-col gap-4">
        <FormError message={error} />
        {failedListId && (
          <Button
            variant="danger"
            size="sm"
            className="self-start"
            onClick={cancelFailed}
          >
            Prekliči nedokončan uvoz (izbriši že uvožene vrstice)
          </Button>
        )}
        {summary && (
          <div className="rounded-lg border border-success/25 bg-success-soft px-4 py-3 text-sm text-success">
            <b>Uvoz končan.</b> Uvoženih:{" "}
            <b>{summary.inserted.toLocaleString("sl-SI")}</b>
            {summary.duplicates > 0 && (
              <>
                {" "}
                · že obstajajo (preskočeni):{" "}
                {summary.duplicates.toLocaleString("sl-SI")}
              </>
            )}
            {summary.suppressed > 0 && (
              <>
                {" "}
                · na seznamu »Ne kliči« (preskočeni):{" "}
                {summary.suppressed.toLocaleString("sl-SI")}
              </>
            )}
            {summary.invalid > 0 && (
              <>
                {" "}
                · brez telefona ali naziva (preskočeni):{" "}
                {summary.invalid.toLocaleString("sl-SI")}
              </>
            )}
          </div>
        )}

        {parsing && (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-subtle/40 px-6 py-6">
            <p className="text-sm font-medium">
              Korak 1/2 · Berem datoteko…{" "}
              <span className="font-normal text-ink-3">
                ({parsing.seconds} s)
              </span>
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-subtle">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-gold" />
            </div>
            {parsing.seconds >= 30 && (
              <p className="text-xs text-ink-3">
                Traja dlje kot običajno. Če se ne zaključi, v Excelu izberite
                »Shrani kot« → »CSV UTF-8« in naložite CSV datoteko – ta se
                prebere v nekaj sekundah.
              </p>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={parsing.cancel}
            >
              Prekliči
            </Button>
          </div>
        )}

        {!parsed && !progress && !parsing && (
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-subtle/40 px-6 py-10 text-center hover:border-gold hover:bg-gold-soft"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files?.[0]);
            }}
          >
            <FileSpreadsheet className="size-8 text-brand" />
            <span className="font-semibold">
              Kliknite ali povlecite Excel datoteko sem
            </span>
            <span className="text-xs text-ink-3">
              .xlsx ali .csv · do 200.000 vrstic
            </span>
            <input
              type="file"
              accept=".xlsx,.csv,.txt"
              className="sr-only"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
        )}

        {progress && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              Korak 2/2 · Uvažam… {progress.done.toLocaleString("sl-SI")} /{" "}
              {progress.total.toLocaleString("sl-SI")} vrstic
              {progress.etaSeconds !== null && (
                <span className="font-normal text-ink-3">
                  {" "}
                  · še približno {progress.etaSeconds} s
                </span>
              )}
              . Ne zapirajte okna.
            </p>
            <div className="h-3 overflow-hidden rounded-full bg-subtle">
              <div
                className="h-full bg-gold transition-all"
                style={{
                  width: `${Math.round((progress.done / progress.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {parsed && !progress && (
          <>
            <p className="text-sm">
              <b>{parsed.fileName}</b> ·{" "}
              {parsed.rows.length.toLocaleString("sl-SI")} vrstic ·{" "}
              {parsed.headers.length} stolpcev
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Ime seznama (mapa)" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field
                label="Kdo kliče ta seznam?"
                hint="»Vse klicateljice« = seznam vidijo vse klicateljice."
              >
                <Select
                  value={callerId}
                  onChange={(e) => setCallerId(e.target.value)}
                >
                  <option value="">Vse klicateljice</option>
                  {callers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {missing.length === 0 && !customize ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-success/25 bg-success-soft px-4 py-3 text-sm">
                <span className="flex items-center gap-1.5 font-semibold text-success">
                  <CheckCircle2 className="size-4" /> Stolpci prepoznani
                </span>
                {LEAD_FIELDS.filter((f) => mapping[f] !== undefined).map(
                  (f) => (
                    <span key={f} className="text-ink-2">
                      {LEAD_FIELD_LABELS[f]}:{" "}
                      <b>{parsed.headers[mapping[f]!]}</b>
                    </span>
                  ),
                )}
                <button
                  type="button"
                  onClick={() => setCustomize(true)}
                  className="ml-auto text-xs font-medium text-brand underline"
                >
                  Prilagodi
                </button>
              </div>
            ) : (
              <div>
                <p className="mb-2 text-sm font-semibold">Preverite stolpce</p>
                <p className="mb-3 text-xs text-ink-3">
                  Stolpce smo prepoznali samodejno. Vsi ostali stolpci (npr.
                  boniteta, plača) se shranijo kot »ostali podatki« in so vidni
                  pri kontaktu.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {LEAD_FIELDS.map((f) => (
                    <Field
                      key={f}
                      label={LEAD_FIELD_LABELS[f]}
                      required={f === "name" || f === "phone"}
                      error={
                        missing.includes(f) ? "Izberite stolpec" : undefined
                      }
                    >
                      <Select
                        value={mapping[f] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => ({
                            ...m,
                            [f]:
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                          }))
                        }
                        aria-invalid={missing.includes(f)}
                      >
                        <option value="">— ni v datoteki —</option>
                        {parsed.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
              </div>
            )}

            <details className="group">
              <summary className="cursor-pointer text-sm font-semibold text-ink-2">
                Predogled prvih 5 vrstic
              </summary>
              <div className="mt-2">
                <div className="rounded-lg border border-line">
                  <Table>
                    <THead>
                      <tr>
                        {LEAD_FIELDS.map((f) => (
                          <TH key={f}>{LEAD_FIELD_LABELS[f]}</TH>
                        ))}
                      </tr>
                    </THead>
                    <tbody>
                      {preview.map((r) => (
                        <TR key={r.row_number}>
                          {LEAD_FIELDS.map((f) => (
                            <TD key={f} className="max-w-48 truncate text-xs">
                              {(r[f] as string | null) ?? "–"}
                            </TD>
                          ))}
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>
            </details>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setParsed(null)}>
                Izberi drugo datoteko
              </Button>
              <Button
                variant="gold"
                className="h-11 px-6 text-[15px]"
                disabled={missing.length > 0 || !name.trim()}
                onClick={runImport}
              >
                <Upload className="size-4" /> Uvozi{" "}
                {parsed.rows.length.toLocaleString("sl-SI")} kontaktov
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
