"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import {
  chunkRows, detectMapping, LEAD_FIELD_LABELS, LEAD_FIELDS, toLeadRows, type Cell, type LeadField, type Mapping,
} from "@/lib/leads/import";
import { createLeadList, deleteLeadList, finalizeLeadList, importLeadChunk } from "@/server/actions/leads";
import type { PersonOption } from "@/server/queries/people";
import { cn } from "@/lib/utils";

interface Parsed {
  fileName: string;
  headers: string[];
  rows: Cell[][];
}

async function parseFile(file: File): Promise<Parsed> {
  const lower = file.name.toLowerCase();
  let sheet: Cell[][];
  if (lower.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    sheet = (await readSheet(file)) as unknown as Cell[][];
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const Papa = (await import("papaparse")).default;
    const text = await file.text();
    const res = Papa.parse<string[]>(text, { skipEmptyLines: true, delimitersToGuess: [";", ",", "\t", "|"] });
    sheet = res.data as Cell[][];
  } else if (lower.endsWith(".xls")) {
    throw new Error("Stara oblika .xls ni podprta. V Excelu izberite »Shrani kot« → »Excelov delovni zvezek (.xlsx)« in poskusite znova.");
  } else {
    throw new Error("Podprte so datoteke .xlsx in .csv.");
  }
  const nonEmpty = (r: Cell[]) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== "");
  const headerIdx = sheet.findIndex(nonEmpty);
  if (headerIdx < 0) throw new Error("Datoteka je prazna.");
  const headers = sheet[headerIdx].map((h, i) => (h === null || h === undefined || String(h).trim() === "" ? `Stolpec ${i + 1}` : String(h).trim()));
  const rows = sheet.slice(headerIdx + 1).filter(nonEmpty);
  if (rows.length === 0) throw new Error("V datoteki ni vrstic s podatki.");
  if (rows.length > 200_000) throw new Error("Datoteka ima več kot 200.000 vrstic. Razdelite jo na manjše dele.");
  return { fileName: file.name, headers, rows };
}

export function ImportCard({ callers }: { callers: PersonOption[] }) {
  const router = useRouter();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [name, setName] = useState("");
  const [callerId, setCallerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failedListId, setFailedListId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ inserted: number; duplicates: number; suppressed: number; invalid: number } | null>(null);

  const preview = useMemo(() => (parsed ? toLeadRows(parsed.headers, parsed.rows.slice(0, 5), mapping) : []), [parsed, mapping]);
  const missing = (["name", "phone"] as LeadField[]).filter((f) => mapping[f] === undefined);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setSummary(null);
    setParsing(true);
    try {
      const p = await parseFile(file);
      setParsed(p);
      setMapping(detectMapping(p.headers, p.rows.slice(0, 50)));
      setName(file.name.replace(/\.(xlsx|csv|txt)$/i, ""));
    } catch (e) {
      setParsed(null);
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function runImport() {
    if (!parsed || missing.length) return;
    setError(null);
    const rows = toLeadRows(parsed.headers, parsed.rows, mapping);
    const chunks = chunkRows(rows);
    const mapped = new Set(Object.values(mapping));
    const created = await createLeadList({
      name,
      file_name: parsed.fileName,
      assigned_caller_id: callerId || null,
      mapping: Object.fromEntries(Object.entries(mapping).map(([f, i]) => [f, parsed.headers[i!]])),
      extra_columns: parsed.headers.filter((_, i) => !mapped.has(i)).slice(0, 60),
      total_rows: rows.length,
    });
    if (!created.ok) return setError(created.error);
    const listId = created.data.list_id;

    const total = { inserted: 0, duplicates: 0, suppressed: 0, invalid: 0 };
    setProgress({ done: 0, total: rows.length });
    let done = 0;
    for (const chunk of chunks) {
      const res = await importLeadChunk({ list_id: listId, rows: chunk });
      if (!res.ok) {
        setProgress(null);
        setFailedListId(listId);
        return setError(`Uvoz se je ustavil pri vrstici ${chunk[0].row_number}: ${res.error}`);
      }
      total.inserted += res.data.inserted;
      total.duplicates += res.data.duplicates;
      total.suppressed += res.data.suppressed;
      total.invalid += res.data.invalid;
      done += chunk.length;
      setProgress({ done, total: rows.length });
    }
    const fin = await finalizeLeadList({ list_id: listId });
    setProgress(null);
    if (!fin.ok) {
      setFailedListId(listId);
      return setError(fin.error);
    }
    setSummary(total);
    setParsed(null);
    toast.success(`Uvoženih ${total.inserted.toLocaleString("sl-SI")} kontaktov.`);
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
      <CardHeader title="Uvoz kontaktov za klicanje" description="Excel (.xlsx) ali CSV. Prva vrstica naj vsebuje imena stolpcev. Vsaka datoteka postane svoj klicni seznam (mapa)." />
      <CardBody className="flex flex-col gap-4">
        <FormError message={error} />
        {failedListId && (
          <Button variant="danger" size="sm" className="self-start" onClick={cancelFailed}>
            Prekliči nedokončan uvoz (izbriši že uvožene vrstice)
          </Button>
        )}
        {summary && (
          <div className="rounded-lg border border-success/25 bg-success-soft px-4 py-3 text-sm text-success">
            <b>Uvoz končan.</b> Uvoženih: <b>{summary.inserted.toLocaleString("sl-SI")}</b>
            {summary.duplicates > 0 && <> · že obstajajo (preskočeni): {summary.duplicates.toLocaleString("sl-SI")}</>}
            {summary.suppressed > 0 && <> · na seznamu »Ne kliči« (preskočeni): {summary.suppressed.toLocaleString("sl-SI")}</>}
            {summary.invalid > 0 && <> · brez telefona ali naziva (preskočeni): {summary.invalid.toLocaleString("sl-SI")}</>}
          </div>
        )}

        {!parsed && !progress && (
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-subtle/40 px-6 py-10 text-center hover:border-gold hover:bg-gold-soft",
              parsing && "pointer-events-none opacity-60",
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files?.[0]);
            }}
          >
            <FileSpreadsheet className="size-8 text-brand" />
            <span className="font-semibold">{parsing ? "Berem datoteko…" : "Kliknite ali povlecite Excel datoteko sem"}</span>
            <span className="text-xs text-ink-3">.xlsx ali .csv · do 200.000 vrstic</span>
            <input type="file" accept=".xlsx,.csv,.txt" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        )}

        {progress && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              Uvažam… {progress.done.toLocaleString("sl-SI")} / {progress.total.toLocaleString("sl-SI")} vrstic. Ne zapirajte okna.
            </p>
            <div className="h-3 overflow-hidden rounded-full bg-subtle">
              <div className="h-full bg-gold transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
          </div>
        )}

        {parsed && !progress && (
          <>
            <p className="text-sm">
              <b>{parsed.fileName}</b> · {parsed.rows.length.toLocaleString("sl-SI")} vrstic · {parsed.headers.length} stolpcev
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Ime seznama (mapa)" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Kdo kliče ta seznam?" hint="»Vse klicateljice« = seznam vidijo vse klicateljice.">
                <Select value={callerId} onChange={(e) => setCallerId(e.target.value)}>
                  <option value="">Vse klicateljice</option>
                  {callers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">Preverite stolpce</p>
              <p className="mb-3 text-xs text-ink-3">Stolpce smo prepoznali samodejno. Vsi ostali stolpci (npr. boniteta, plača) se shranijo kot »ostali podatki« in so vidni pri kontaktu.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {LEAD_FIELDS.map((f) => (
                  <Field key={f} label={LEAD_FIELD_LABELS[f]} required={f === "name" || f === "phone"} error={missing.includes(f) ? "Izberite stolpec" : undefined}>
                    <Select
                      value={mapping[f] ?? ""}
                      onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value === "" ? undefined : Number(e.target.value) }))}
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

            <div>
              <p className="mb-2 text-sm font-semibold">Predogled (prvih 5 vrstic)</p>
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

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setParsed(null)}>
                Izberi drugo datoteko
              </Button>
              <Button variant="gold" disabled={missing.length > 0 || !name.trim()} onClick={runImport}>
                <Upload className="size-4" /> Uvozi {parsed.rows.length.toLocaleString("sl-SI")} kontaktov
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
